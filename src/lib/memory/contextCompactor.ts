/**
 * Context Compactor — 上下文压缩（Handoff Summary）
 *
 * 参考：Codex Handoff Summary（95%容量触发，保留最近20K token，删除assistant回复，蒸馏更早消息）
 * 参考：Claude Code Session Memory 与 Compact 协作（优先复用 sessionMemory 的 context_summary）
 * 参考：Headroom AI — 智能上下文压缩层（60-95% token 节省，CCR 可逆压缩）
 *
 * 压缩优先级：
 * 1. Headroom AI（如果 proxy 可用） — 最高质量，支持 CCR 可逆压缩
 * 2. Session Memory context_summary — 快路径复用已有摘要
 * 3. 模板拼接 — 降级兜底
 */

import type { ChatMessage, HandoffSummary } from '../../types';
import {
  COMPACT_TRIGGER_RATIO,
  COMPACT_PRESERVED_TOKENS,
} from './types';
import type { SessionMemory } from '../../types';
import { estimateConversationTokens, estimateTokens } from './sessionMemory';
import { compressWithHeadroom } from '../../api/pluginApi';

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

// ===== Headroom 压缩（最高质量） =====

/** Headroom 压缩：通过后端 Headroom proxy 进行智能上下文压缩 */
export async function compactWithHeadroom(
  toCompact: ChatMessage[]
): Promise<{ summary: string; method: 'headroom'; ccrHashes?: string[] } | null> {
  try {
    // 转换为 OpenAI 格式消息
    const openaiMessages = toCompact.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system' | 'tool',
      content: m.content,
    }));

    const result = await compressWithHeadroom(openaiMessages);

    if (result && result.compressed && result.messages) {
      // 提取压缩后的文本摘要
      const compressedContent = result.messages
        .map((m: any) => {
          const role = m.role || '?';
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          return `${role}: ${content}`;
        })
        .join('\n');

      return {
        summary: `## 历史对话摘要（Headroom 智能压缩，节省 ${result.tokensSaved || 0} tokens）\n${compressedContent}`,
        method: 'headroom',
        ccrHashes: result.ccrHashes || [],
      };
    }

    return null;
  } catch {
    // Headroom 不可用时降级到其他压缩方式
    return null;
  }
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
  // 优先提取工作流相关消息
  const workflowMessages = toCompact.filter(m =>
    m.messageType === 'workflow_preview' ||
    m.content.includes('工作流') ||
    m.content.includes('Workflow') ||
    m.metadata?.workflow ||
    m.metadata?.workflowId
  );

  const roleLabel = (m: ChatMessage) => ({
    user: '用户',
    assistant: '助手',
    system: '系统',
    tool: `工具(${m.toolName || '?'})`,
  }[m.role]);

  const lines: string[] = ['## 历史对话摘要（模板压缩）'];

  if (workflowMessages.length > 0) {
    lines.push('\n【工作流相关】');
    workflowMessages.forEach((m, i) => {
      lines.push(`${i + 1}. ${roleLabel(m)}: ${m.content.slice(0, 150)}`);
    });
  }

  // 保留最近3条非工作流消息
  const otherMessages = toCompact.filter(m => !workflowMessages.includes(m)).slice(-3);
  if (otherMessages.length > 0) {
    lines.push('\n【近期消息】');
    otherMessages.forEach((m, i) => {
      lines.push(`${i + 1}. ${roleLabel(m)}: ${m.content.slice(0, 100)}`);
    });
  }

  const summary = lines.join('\n');
  return { summary, method: 'template' };
}

// ===== LLM 压缩（Phase 2 实现，MVP 暂不启用） =====

// TODO: Phase 2 实现 LLM 驱动的 Handoff Summary 生成
// async function compactWithLLM(toCompact: ChatMessage[]): Promise<string> {
//   使用 routedChatLLM 生成摘要
// }

// ===== 完整压缩流程 =====

/** 执行完整的上下文压缩流程（异步，支持 Headroom 压缩） */
export async function compactConversationAsync(
  messages: ChatMessage[],
  maxTokens: number,
  sessionMemory?: SessionMemory,
  sessionId?: string
): Promise<{
  compactedMessages: ChatMessage[];
  handoffSummary: HandoffSummary;
  method: 'headroom' | 'session_summary' | 'template';
}> {
  const { preserved, toCompact } = splitMessagesForCompact(messages, maxTokens);

  // 优先尝试 Headroom 压缩（异步）
  let headroomResult = await compactWithHeadroom(toCompact);

  let result: { summary: string; method: 'headroom' | 'session_summary' | 'template' };
  let ccrHashes: string[] = [];

  if (headroomResult) {
    result = headroomResult;
    ccrHashes = headroomResult.ccrHashes || [];
  } else if (sessionMemory) {
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
    metadata: ccrHashes.length > 0 ? { headroomCcrHashes: ccrHashes } : undefined,
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

/** 同步版压缩流程（不使用 Headroom，用于兼容旧调用） */
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
