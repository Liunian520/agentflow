import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRuntimeRegistry } from '../agentRuntime';
import { AgentMessageBus } from '../agentMessageBus';
import { AgentScheduler } from '../agentScheduler';
import { RouterEvolver } from '../routerEvolver';

describe('Multi-Agent Orchestration Integration', () => {
  let registry: AgentRuntimeRegistry;
  let bus: AgentMessageBus;
  let scheduler: AgentScheduler;
  let evolver: RouterEvolver;

  beforeEach(() => {
    registry = new AgentRuntimeRegistry();
    bus = new AgentMessageBus();
    scheduler = new AgentScheduler(registry);
    evolver = new RouterEvolver();
  });

  it('should auto-register agents, schedule tasks, and track results', () => {
    // 1. 注册两个 Agent
    registry.register('coder', ['code']);
    registry.register('writer', ['writing']);

    // 2. 提交一个需要 code 能力的任务
    const taskId = scheduler.enqueue({
      input: '修复 auth.ts 的 bug',
      requiredCapabilities: ['code'],
      preferredModel: null,
      priority: 'high',
    });

    // 3. 任务应被分配给 coder
    const task = scheduler.getTask(taskId);
    expect(task!.status).toBe('assigned');
    expect(task!.assignedAgentId).toBe('coder');

    // 4. coder 应处于 busy 状态
    expect(registry.getAgentState('coder')!.status).toBe('busy');

    // 5. 完成任务
    scheduler.completeTask(taskId, 'bug 已修复');

    // 6. coder 应恢复 idle
    expect(registry.getAgentState('coder')!.status).toBe('idle');
    expect(registry.getAgentState('coder')!.successRate).toBe(1);
  });

  it('should queue task when agent is busy and assign when free', () => {
    registry.register('agent-1', ['code']);
    registry.setBusy('agent-1', 'task-0');

    const t1 = scheduler.enqueue({
      input: 'task 1',
      requiredCapabilities: ['code'],
      preferredModel: null,
      priority: 'normal',
    });
    expect(scheduler.getTask(t1)!.status).toBe('queued');

    registry.setIdle('agent-1');
    scheduler.tryAssignQueuedTasks();
    expect(scheduler.getTask(t1)!.status).toBe('assigned');
  });

  it('should allow agents to communicate via message bus', async () => {
    const receivedMessages: string[] = [];

    bus.subscribe('researcher', (msg) => {
      receivedMessages.push(msg.content);
      if (msg.type === 'request') {
        bus.send({
          fromAgentId: 'researcher',
          toAgentId: 'writer',
          type: 'response',
          content: '调研结果：React 19 支持并发渲染',
          metadata: {},
          replyTo: msg.id,
        });
      }
    });

    const response = await bus.request('writer', 'researcher', '请调研 React 19 的新特性', 5000);
    expect(response).toBeDefined();
    expect(response!.content).toContain('React 19');
    expect(receivedMessages).toHaveLength(1);
  });

  it('should evolve router weights based on prediction accuracy', () => {
    // 模拟 20 条路由记录
    for (let i = 0; i < 20; i++) {
      evolver.recordPrediction({
        statCorrect: i < 16,  // 80%
        knnCorrect: i < 8,    // 40%
        costCorrect: i < 4,   // 20%
      });
    }

    const oldWeights = evolver.getWeights();
    evolver.evolve();
    const newWeights = evolver.getWeights();

    // stat 准确率最高，权重应增加
    expect(newWeights.stat).toBeGreaterThan(oldWeights.stat);
    // cost 准确率最低，权重应减少
    expect(newWeights.cost).toBeLessThan(oldWeights.cost);
    // 权重之和应为 1
    expect(newWeights.stat + newWeights.knn + newWeights.cost).toBeCloseTo(1.0, 2);
  });

  it('should handle full orchestration cycle: detect → schedule → communicate → execute', () => {
    // 1. 注册一个多能力 Agent
    registry.register('fullstack', ['code', 'writing', 'reasoning']);

    // 2. 提交一个需要多能力的任务
    const taskId = scheduler.enqueue({
      input: '分析代码并写报告',
      requiredCapabilities: ['code', 'writing'],
      preferredModel: null,
      priority: 'high',
    });

    // 3. 任务应被分配
    expect(scheduler.getTask(taskId)!.status).toBe('assigned');

    // 4. 模拟执行过程中 Agent 间通信
    bus.subscribe('fullstack', (msg) => {
      if (msg.type === 'notify') {
        // 记录通知
      }
    });
    bus.broadcast('system', '任务已分配给 fullstack agent');

    // 5. 完成任务
    scheduler.completeTask(taskId, '分析完成，报告已生成');

    // 6. 验证状态
    expect(registry.getAgentState('fullstack')!.status).toBe('idle');
    expect(registry.getAgentState('fullstack')!.totalTasks).toBe(1);
    expect(registry.getAgentState('fullstack')!.successRate).toBe(1);
  });
});
