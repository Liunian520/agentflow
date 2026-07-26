import type { AgentMessage } from '../types';
import { generateId } from './utils';

type MessageCallback = (msg: AgentMessage) => void;

/**
 * Agent Message Bus — Agent 间直接通信的消息总线
 *
 * 支持三种通信模式：
 * - Direct: agent A → agent B（点对点）
 * - Broadcast: agent A → all agents（广播）
 * - Request-Response: agent A 请求 → agent B 响应（带超时）
 *
 * 内部 Agent 通过此总线直接通信，无需经过工作流变量中转。
 */
export class AgentMessageBus {
  private subscribers = new Map<string, Set<MessageCallback>>();
  private messageHistory = new Map<string, AgentMessage[]>();
  private pendingRequests = new Map<string, {
    resolve: (msg: AgentMessage | null) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private maxHistoryPerAgent = 100;

  subscribe(agentId: string, callback: MessageCallback): void {
    if (!this.subscribers.has(agentId)) {
      this.subscribers.set(agentId, new Set());
    }
    this.subscribers.get(agentId)!.add(callback);
  }

  unsubscribe(agentId: string): void {
    this.subscribers.delete(agentId);
  }

  /** 发送直接消息 */
  send(message: Omit<AgentMessage, 'id' | 'timestamp'>): string {
    const fullMessage: AgentMessage = {
      ...message,
      id: generateId(),
      timestamp: Date.now(),
    };

    // 检查是否是某个 pending request 的响应
    if (message.type === 'response' && message.replyTo) {
      const pending = this.pendingRequests.get(message.replyTo);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.replyTo);
        pending.resolve(fullMessage);
      }
    }

    // 投递给目标
    const callbacks = this.subscribers.get(message.toAgentId || '');
    if (callbacks) {
      callbacks.forEach((cb) => cb(fullMessage));
    }

    // 记录历史
    this.recordHistory(message.toAgentId || '', fullMessage);
    if (message.fromAgentId) {
      this.recordHistory(message.fromAgentId, fullMessage);
    }

    return fullMessage.id;
  }

  /** 广播消息给所有订阅者（除了发送者自己） */
  broadcast(fromAgentId: string, content: string, metadata: Record<string, any> = {}): void {
    const message: AgentMessage = {
      id: generateId(),
      fromAgentId,
      toAgentId: null,
      type: 'broadcast',
      content,
      metadata,
      timestamp: Date.now(),
      replyTo: null,
    };

    for (const [agentId, callbacks] of this.subscribers) {
      if (agentId === fromAgentId) continue;
      callbacks.forEach((cb) => cb(message));
      this.recordHistory(agentId, message);
    }
  }

  /** 请求-响应模式：发送请求并等待响应 */
  request(
    fromAgentId: string,
    toAgentId: string,
    content: string,
    timeoutMs: number = 30000,
    metadata: Record<string, any> = {},
  ): Promise<AgentMessage | null> {
    return new Promise((resolve) => {
      const requestId = generateId();

      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve(null);
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, timer });

      // 直接构造消息投递，使用我们生成的 requestId
      const message: AgentMessage = {
        id: requestId,
        fromAgentId,
        toAgentId,
        type: 'request',
        content,
        metadata,
        timestamp: Date.now(),
        replyTo: null,
      };

      const callbacks = this.subscribers.get(toAgentId);
      if (callbacks) {
        callbacks.forEach((cb) => cb(message));
      }
      this.recordHistory(toAgentId, message);
      this.recordHistory(fromAgentId, message);
    });
  }

  /** 获取某个 Agent 的消息历史 */
  getHistory(agentId: string): AgentMessage[] {
    return this.messageHistory.get(agentId) || [];
  }

  /** 清空历史 */
  clearHistory(agentId?: string): void {
    if (agentId) {
      this.messageHistory.delete(agentId);
    } else {
      this.messageHistory.clear();
    }
  }

  private recordHistory(agentId: string, message: AgentMessage): void {
    if (!this.messageHistory.has(agentId)) {
      this.messageHistory.set(agentId, []);
    }
    const history = this.messageHistory.get(agentId)!;
    history.push(message);
    if (history.length > this.maxHistoryPerAgent) {
      history.shift();
    }
  }
}

/** 全局单例 */
let globalBus: AgentMessageBus | null = null;

export function getAgentMessageBus(): AgentMessageBus {
  if (!globalBus) {
    globalBus = new AgentMessageBus();
  }
  return globalBus;
}
