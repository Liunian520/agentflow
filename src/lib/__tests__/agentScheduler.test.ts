import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentScheduler } from '../agentScheduler';
import { AgentRuntimeRegistry } from '../agentRuntime';

describe('AgentScheduler', () => {
  let registry: AgentRuntimeRegistry;
  let scheduler: AgentScheduler;

  beforeEach(() => {
    registry = new AgentRuntimeRegistry();
    scheduler = new AgentScheduler(registry);
  });

  it('should queue a task and assign to idle agent', () => {
    registry.register('agent-1', ['code']);
    const taskId = scheduler.enqueue({
      input: '修复 bug',
      requiredCapabilities: ['code'],
      preferredModel: null,
      priority: 'normal',
    });
    const task = scheduler.getTask(taskId);
    expect(task).toBeDefined();
    expect(task!.status).toBe('assigned');
    expect(task!.assignedAgentId).toBe('agent-1');
  });

  it('should queue task when no capable agent available', () => {
    registry.register('agent-1', ['writing']);
    const taskId = scheduler.enqueue({
      input: '修复 bug',
      requiredCapabilities: ['code'],
      preferredModel: null,
      priority: 'normal',
    });
    const task = scheduler.getTask(taskId);
    expect(task!.status).toBe('queued');
    expect(task!.assignedAgentId).toBeNull();
  });

  it('should assign queued task when agent becomes available', () => {
    registry.register('agent-1', ['code']);
    registry.setBusy('agent-1', 'other-task');

    const taskId = scheduler.enqueue({
      input: '修复 bug',
      requiredCapabilities: ['code'],
      preferredModel: null,
      priority: 'normal',
    });
    expect(scheduler.getTask(taskId)!.status).toBe('queued');

    // agent 空闲后，任务应被分配
    registry.setIdle('agent-1');
    scheduler.tryAssignQueuedTasks();
    expect(scheduler.getTask(taskId)!.status).toBe('assigned');
    expect(scheduler.getTask(taskId)!.assignedAgentId).toBe('agent-1');
  });

  it('should prefer agent with better success rate', () => {
    registry.register('agent-1', ['code']);
    registry.register('agent-2', ['code']);
    registry.recordTaskResult('agent-1', false, 5000);
    registry.recordTaskResult('agent-2', true, 1000);

    const taskId = scheduler.enqueue({
      input: '修复 bug',
      requiredCapabilities: ['code'],
      preferredModel: null,
      priority: 'normal',
    });
    expect(scheduler.getTask(taskId)!.assignedAgentId).toBe('agent-2');
  });

  it('should process high priority tasks first', () => {
    registry.register('agent-1', ['code']);
    registry.setBusy('agent-1', 'other');

    const lowId = scheduler.enqueue({ input: 'low', requiredCapabilities: ['code'], preferredModel: null, priority: 'low' });
    const highId = scheduler.enqueue({ input: 'high', requiredCapabilities: ['code'], preferredModel: null, priority: 'high' });
    const normalId = scheduler.enqueue({ input: 'normal', requiredCapabilities: ['code'], preferredModel: null, priority: 'normal' });

    registry.setIdle('agent-1');
    scheduler.tryAssignQueuedTasks();

    // high 应该先被分配
    expect(scheduler.getTask(highId)!.status).toBe('assigned');
    expect(scheduler.getTask(normalId)!.status).toBe('queued');
    expect(scheduler.getTask(lowId)!.status).toBe('queued');
  });

  it('should mark task done with result', () => {
    registry.register('agent-1', ['code']);
    const taskId = scheduler.enqueue({
      input: '修复 bug',
      requiredCapabilities: ['code'],
      preferredModel: null,
      priority: 'normal',
    });
    scheduler.completeTask(taskId, 'bug 已修复');
    expect(scheduler.getTask(taskId)!.status).toBe('done');
    expect(scheduler.getTask(taskId)!.result).toBe('bug 已修复');
  });

  it('should fail task with error', () => {
    registry.register('agent-1', ['code']);
    const taskId = scheduler.enqueue({
      input: '修复 bug',
      requiredCapabilities: ['code'],
      preferredModel: null,
      priority: 'normal',
    });
    scheduler.failTask(taskId, 'Agent 执行超时');
    expect(scheduler.getTask(taskId)!.status).toBe('failed');
  });
});
