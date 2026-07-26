import type { AgentRuntimeState } from '../types';
import { generateId } from './utils';

/**
 * Agent Runtime Registry — 运行时 Agent 状态机与注册中心
 *
 * 职责：
 * - 跟踪每个 Agent 的运行时状态（idle/busy/queued/error）
 * - 基于 capabilities 查找可用 Agent
 * - 记录执行指标（成功率、平均延迟）
 */
export class AgentRuntimeRegistry {
  private agents = new Map<string, AgentRuntimeState>();

  register(agentId: string, capabilities: string[] = [], maxConcurrent = 1): void {
    if (this.agents.has(agentId)) {
      // 已注册，仅更新 capabilities
      const existing = this.agents.get(agentId)!;
      existing.capabilities = capabilities;
      existing.maxConcurrent = maxConcurrent;
      return;
    }
    this.agents.set(agentId, {
      agentId,
      status: 'idle',
      currentTaskId: null,
      lastActiveAt: Date.now(),
      totalTasks: 0,
      successRate: 1.0,
      avgLatencyMs: 0,
      capabilities,
      maxConcurrent,
      activeConcurrent: 0,
    });
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
  }

  getAgentState(agentId: string): AgentRuntimeState | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentRuntimeState[] {
    return Array.from(this.agents.values());
  }

  setBusy(agentId: string, taskId: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;
    state.status = 'busy';
    state.currentTaskId = taskId;
    state.activeConcurrent++;
    state.lastActiveAt = Date.now();
  }

  setIdle(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;
    state.activeConcurrent = Math.max(0, state.activeConcurrent - 1);
    if (state.activeConcurrent === 0) {
      state.status = 'idle';
      state.currentTaskId = null;
    }
    state.lastActiveAt = Date.now();
  }

  setError(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;
    state.status = 'error';
    state.activeConcurrent = Math.max(0, state.activeConcurrent - 1);
    state.currentTaskId = null;
    state.lastActiveAt = Date.now();
  }

  findIdleAgents(requiredCapabilities: string[]): AgentRuntimeState[] {
    return Array.from(this.agents.values()).filter((agent) => {
      if (agent.status === 'error' || agent.status === 'offline') return false;
      if (agent.activeConcurrent >= agent.maxConcurrent) return false;
      if (requiredCapabilities.length === 0) return true;
      return requiredCapabilities.every((cap) => agent.capabilities.includes(cap));
    });
  }

  recordTaskResult(agentId: string, success: boolean, latencyMs: number): void {
    const state = this.agents.get(agentId);
    if (!state) return;
    const prevTotal = state.totalTasks;
    state.totalTasks = prevTotal + 1;
    // 增量平均：new_avg = (old_avg * n + new_val) / (n + 1)
    state.avgLatencyMs = Math.round((state.avgLatencyMs * prevTotal + latencyMs) / state.totalTasks);
    state.successRate = (state.successRate * prevTotal + (success ? 1 : 0)) / state.totalTasks;
  }

  /** 自动清理长时间未活动的 Agent */
  cleanupStale(maxIdleMs: number = 30 * 60 * 1000): string[] {
    const now = Date.now();
    const removed: string[] = [];
    for (const [id, state] of this.agents) {
      if (state.status === 'idle' && now - state.lastActiveAt > maxIdleMs) {
        this.agents.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }
}

/** 全局单例 */
let globalRegistry: AgentRuntimeRegistry | null = null;

export function getAgentRuntimeRegistry(): AgentRuntimeRegistry {
  if (!globalRegistry) {
    globalRegistry = new AgentRuntimeRegistry();
  }
  return globalRegistry;
}
