import type { ScheduledTask } from '../types';
import type { AgentRuntimeRegistry } from './agentRuntime';
import { generateId } from './utils';

const PRIORITY_ORDER: Record<string, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

/**
 * Dynamic Agent Scheduler — 动态 Agent 调度器
 *
 * 职责：
 * - 接收任务，按能力匹配空闲 Agent
 * - 优先级队列：high > normal > low
 * - 负载感知：优先选成功率高、延迟低的 Agent
 * - Agent 忙碌时排队，空闲时自动分配
 */
export class AgentScheduler {
  private tasks = new Map<string, ScheduledTask>();
  private queue: string[] = []; // 待分配任务 ID 列表

  constructor(private registry: AgentRuntimeRegistry) {}

  /** 入队一个任务，尝试立即分配 */
  enqueue(task: {
    input: string;
    requiredCapabilities: string[];
    preferredModel: string | null;
    priority: 'low' | 'normal' | 'high';
  }): string {
    const id = generateId();
    const scheduledTask: ScheduledTask = {
      id,
      input: task.input,
      requiredCapabilities: task.requiredCapabilities,
      preferredModel: task.preferredModel,
      priority: task.priority,
      status: 'queued',
      assignedAgentId: null,
      result: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
    };
    this.tasks.set(id, scheduledTask);

    // 尝试立即分配
    this.tryAssignTask(id);
    return id;
  }

  /** 尝试分配所有排队中的任务 */
  tryAssignQueuedTasks(): void {
    // 按优先级排序队列
    this.queue.sort((a, b) => {
      const taskA = this.tasks.get(a);
      const taskB = this.tasks.get(b);
      if (!taskA || !taskB) return 0;
      return PRIORITY_ORDER[taskA.priority] - PRIORITY_ORDER[taskB.priority];
    });

    const stillQueued: string[] = [];
    for (const taskId of this.queue) {
      if (this.tryAssignTask(taskId)) {
        // 分配成功
      } else {
        stillQueued.push(taskId);
      }
    }
    this.queue = stillQueued;
  }

  /** 尝试为单个任务分配 Agent */
  private tryAssignTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'queued') return false;

    const candidates = this.registry.findIdleAgents(task.requiredCapabilities);
    if (candidates.length === 0) {
      // 没有可用 Agent，加入队列
      if (!this.queue.includes(taskId)) {
        this.queue.push(taskId);
      }
      return false;
    }

    // 选择最优 Agent：成功率优先，延迟其次
    candidates.sort((a, b) => {
      if (b.successRate !== a.successRate) {
        return b.successRate - a.successRate;
      }
      return a.avgLatencyMs - b.avgLatencyMs;
    });

    const agent = candidates[0];
    task.assignedAgentId = agent.agentId;
    task.status = 'assigned';
    task.startedAt = Date.now();
    this.registry.setBusy(agent.agentId, taskId);

    // 从队列中移除
    this.queue = this.queue.filter((id) => id !== taskId);
    return true;
  }

  /** 标记任务完成 */
  completeTask(taskId: string, result: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'done';
    task.result = result;
    task.finishedAt = Date.now();

    if (task.assignedAgentId) {
      const latency = task.finishedAt - (task.startedAt || task.createdAt);
      this.registry.recordTaskResult(task.assignedAgentId, true, latency);
      this.registry.setIdle(task.assignedAgentId);
    }

    // 分配队列中的下一个任务
    this.tryAssignQueuedTasks();
  }

  /** 标记任务失败 */
  failTask(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'failed';
    task.result = error;
    task.finishedAt = Date.now();

    if (task.assignedAgentId) {
      const latency = task.finishedAt - (task.startedAt || task.createdAt);
      this.registry.recordTaskResult(task.assignedAgentId, false, latency);
      this.registry.setError(task.assignedAgentId);
      // 错误状态后恢复为 idle
      this.registry.setIdle(task.assignedAgentId);
    }

    this.tryAssignQueuedTasks();
  }

  getTask(taskId: string): ScheduledTask | undefined {
    return this.tasks.get(taskId);
  }

  getQueuedTasks(): ScheduledTask[] {
    return this.queue
      .map((id) => this.tasks.get(id))
      .filter((t): t is ScheduledTask => !!t);
  }

  getAssignedTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === 'assigned' || t.status === 'running');
  }
}

/** 全局单例 */
let globalScheduler: AgentScheduler | null = null;

export function getAgentScheduler(registry?: AgentRuntimeRegistry): AgentScheduler {
  if (!globalScheduler) {
    // 动态导入避免循环依赖
    const { getAgentRuntimeRegistry } = require('./agentRuntime');
    globalScheduler = new AgentScheduler(registry || getAgentRuntimeRegistry());
  }
  return globalScheduler;
}
