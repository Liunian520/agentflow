import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRuntimeRegistry } from '../agentRuntime';

describe('AgentRuntimeRegistry', () => {
  let registry: AgentRuntimeRegistry;

  beforeEach(() => {
    registry = new AgentRuntimeRegistry();
  });

  it('should register an agent with idle status', () => {
    registry.register('agent-1', ['code', 'reasoning']);
    const state = registry.getAgentState('agent-1');
    expect(state).toBeDefined();
    expect(state!.status).toBe('idle');
    expect(state!.capabilities).toEqual(['code', 'reasoning']);
    expect(state!.maxConcurrent).toBe(1);
  });

  it('should transition status from idle to busy and back', () => {
    registry.register('agent-1', ['code']);
    registry.setBusy('agent-1', 'task-1');
    expect(registry.getAgentState('agent-1')!.status).toBe('busy');
    expect(registry.getAgentState('agent-1')!.currentTaskId).toBe('task-1');
    registry.setIdle('agent-1');
    expect(registry.getAgentState('agent-1')!.status).toBe('idle');
    expect(registry.getAgentState('agent-1')!.currentTaskId).toBeNull();
  });

  it('should find idle agents by capability', () => {
    registry.register('agent-1', ['code', 'reasoning']);
    registry.register('agent-2', ['writing']);
    registry.register('agent-3', ['code', 'writing']);
    registry.setBusy('agent-1', 'task-x');

    const codeAgents = registry.findIdleAgents(['code']);
    expect(codeAgents).toHaveLength(1);
    expect(codeAgents[0].agentId).toBe('agent-3');
  });

  it('should track success rate and avg latency', () => {
    registry.register('agent-1', ['code']);
    registry.recordTaskResult('agent-1', true, 1000);
    registry.recordTaskResult('agent-1', false, 3000);
    const state = registry.getAgentState('agent-1')!;
    expect(state.totalTasks).toBe(2);
    expect(state.successRate).toBeCloseTo(0.5);
    expect(state.avgLatencyMs).toBe(2000);
  });

  it('should unregister an agent', () => {
    registry.register('agent-1', ['code']);
    registry.unregister('agent-1');
    expect(registry.getAgentState('agent-1')).toBeUndefined();
  });

  it('should list all agents with their states', () => {
    registry.register('agent-1', ['code']);
    registry.register('agent-2', ['writing']);
    const all = registry.getAllAgents();
    expect(all).toHaveLength(2);
  });
});
