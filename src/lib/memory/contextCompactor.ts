/**
 * Context Compactor — 上下文压缩（Handoff Summary）
 *
 * 参考：Codex Handoff Summary（95%容量触发，保留最近20K token，删除assistant回复，蒸馏更早消息）
 * 参考：Claude Code Session Memory 与 Compact 协作（优先复用 sessionMemory 的 context_summary）
 *
 * 降级兜底：模板拼接（角色+前100字符）
 */

import type { ChatMessage, HandoffSummary } from '../../types';
import {
  COMPACT_TRIGGER_RATIO,
  COMPACT_PRESERVED_TOKENS,
} from './types';
import type { SessionMemory } from '../../types';
import { estimateConversationTokens, estimateTokens } from './sessionMemory';

// ===== 触发判断 =====

/** 判断是否需要触发上下文压缩 */
export function shouldCompactMessages(
  messages: ChatMessage[],
  maxTokens: number
): boolean {
  const currentTokens = estimateConversationTokens(messages);
  return currentTokens >= maxTokens * COMPACT_TRIGGER_RATIO;
}

// ===== 消息分割 =====

/** 将消息分为"保留区"(最近)和"压缩区"(更早) */
export function splitMessagesForCompact(
  messages: ChatMessage[],
  maxTokens: number
): { preserved: ChatMessage[]; toCompact: ChatMessage[] } {
  // 从尾部倒推保留区 token
  let preservedTokens = 0;
  let preservedStartIndex = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(messages[i].content);
    preservedTokens += msgTokens;
    if (preservedTokens >= COMPACT_PRESERVED_TOKENS || preservedTokens >= maxTokens * 0.3) {
      preservedStartIndex = i;
      break;
    }
  }

  // 至少保留最近 5 条消息
  preservedStartIndex = Math.min(preservedStartIndex, messages.length - 5);

  return {
    preserved: messages.slice(preservedStartIndex),
    toCompact: messages.slice(0, preservedStartIndex),
  };
}

// ===== 快路径：复用 Session Memory context_summary =====

/** 快路径压缩：复用 sessionMemory 的 context_summary section（零额外 LLM 调用） */
export function compactWithSessionSummary(
  toCompact: ChatMessage[],
  sessionMemory: SessionMemory
): { summary: string; method: 'session_summary' | 'template' } {
  const contextSummary = sessionMemory.sections.context_summary;

  if (contextSummary && contextSummary !== '压缩后的历史对话要点') {
    // 已有 context_summary — 直接复用
    return { summary: contextSummary, method: 'session_summary' };
  }

  // 降级：模板拼接
  return compactWithTemplate(toCompact);
}

// ===== 降级兜底：模板拼接 =====

/** 降级压缩：模板拼接（角色+前100字符），无 LLM 调用 */
export function compactWithTemplate(
  toCompact: ChatMessage[]
): { summary: string; method: 'template' } {
  const lines = toCompact.map((m) => {
    const roleLabel = {
      user: '用户',
      assistant: '助手',
      system: '系统',
      tool: `工具(${m.toolName || '?'})`,
    }[m.role];
    const snippet = m.content.slice(0, 100);
    return `${roleLabel}: ${snippet}`;
  });

  const summary = `## 历史对话摘要（模板压缩）\n${lines.join('\n')}`;
  return { summary, method: 'template' };
}

// ===== LLM 压缩（Phase 2 实现，MVP 暂不启用） =====

// TODO: Phase 2 实现 LLM 驱动的 Handoff Summary 生成
// async function compactWithLLM(toCompact: ChatMessage[]): Promise<string> {
//   使用 routedChatLLM 生成摘要
// }

// ===== 完整压缩流程 =====

/** 执行完整的上下文压缩流程 */
export function compactConversation(
  messages: ChatMessage[],
  maxTokens: number,
  sessionMemory?: SessionMemory,
  sessionId?: string
): {
  compactedMessages: ChatMessage[];
  handoffSummary: HandoffSummary;
  method: 'session_summary' | 'template';
} {
  const { preserved, toCompact } = splitMessagesForCompact(messages, maxTokens);

  // 优先复用 Session Memory 快路径
  let result: { summary: string; method: 'session_summary' | 'template' };
  if (sessionMemory) {
    result = compactWithSessionSummary(toCompact, sessionMemory);
  } else {
    result = compactWithTemplate(toCompact);
  }

  // 构造压缩后的消息列表：summary 作为 system 消息 + preserved 消息
  const summaryMessage: ChatMessage = {
    id: `compact-${Date.now()}`,
    role: 'system',
    content: result.summary,
    timestamp: new Date().toISOString(),
    messageType: 'text',
  };

  const compactedMessages = [summaryMessage, ...preserved];

  // 生成 HandoffSummary 记录
  const handoffSummary: HandoffSummary = {
    id: `hs-${Date.now()}`,
    timestamp: new Date().toISOString(),
    sessionId: sessionId || 'unknown',
    summary: result.summary,
    preservedMessageCount: preserved.length,
    compactedMessageCount: toCompact.length,
    triggerTokenCount: estimateConversationTokens(messages),
  };

  return { compactedMessages, handoffSummary, method: result.method };
}
