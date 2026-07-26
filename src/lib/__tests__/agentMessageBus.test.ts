import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentMessageBus } from '../agentMessageBus';

describe('AgentMessageBus', () => {
  let bus: AgentMessageBus;

  beforeEach(() => {
    bus = new AgentMessageBus();
  });

  it('should deliver direct message to recipient', () => {
    const callback = vi.fn();
    bus.subscribe('agent-1', callback);
    bus.send({
      fromAgentId: 'agent-2',
      toAgentId: 'agent-1',
      type: 'request',
      content: '分析这段代码',
      metadata: {},
    });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      fromAgentId: 'agent-2',
      content: '分析这段代码',
    }));
  });

  it('should deliver broadcast to all subscribers', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();
    bus.subscribe('agent-1', cb1);
    bus.subscribe('agent-2', cb2);
    bus.subscribe('agent-3', cb3);
    bus.broadcast('agent-1', '全体注意：新任务到达');
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(cb3).toHaveBeenCalledTimes(1);
    expect(cb1).not.toHaveBeenCalled(); // 广播者不收到自己的消息
  });

  it('should support request-response pattern', async () => {
    bus.subscribe('agent-2', (msg) => {
      if (msg.type === 'request') {
        bus.send({
          fromAgentId: 'agent-2',
          toAgentId: 'agent-1',
          type: 'response',
          content: '分析完成：无 bug',
          metadata: {},
          replyTo: msg.id,
        });
      }
    });

    const response = await bus.request('agent-1', 'agent-2', '分析这段代码', 5000);
    expect(response).toBeDefined();
    expect(response!.content).toBe('分析完成：无 bug');
  });

  it('should timeout when no response', async () => {
    const response = await bus.request('agent-1', 'agent-2', '分析这段代码', 100);
    expect(response).toBeNull();
  });

  it('should unsubscribe a callback', () => {
    const callback = vi.fn();
    bus.subscribe('agent-1', callback);
    bus.unsubscribe('agent-1');
    bus.send({
      fromAgentId: 'agent-2',
      toAgentId: 'agent-1',
      type: 'notify',
      content: 'hello',
      metadata: {},
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it('should keep message history', () => {
    bus.subscribe('agent-1', vi.fn());
    bus.send({ fromAgentId: 'agent-2', toAgentId: 'agent-1', type: 'request', content: 'msg1', metadata: {} });
    bus.send({ fromAgentId: 'agent-2', toAgentId: 'agent-1', type: 'request', content: 'msg2', metadata: {} });
    const history = bus.getHistory('agent-1');
    expect(history).toHaveLength(2);
  });
});
