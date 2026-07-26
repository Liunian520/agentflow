/**
 * L0 Working Memory — 会话工作记忆管理器
 *
 * 参考：Claude Code Session Memory（10 section 模板 + token ≥10K + 工具 ≥3 触发）
 * MVP：10section 模板 + 追加 worklog + 手动触发更新
 * Phase 2：forked LLM 就地编辑各 section（尚未实现）
 */

import type { SessionMemory, SessionSectionKey, ChatMessage } from '../../types';
import {
  DEFAULT_SESSION_SECTIONS,
  L0_COMPACT_TOOL_THRESHOLD,
  L0_MAX_TOKEN_ESTIMATE,
} from './types';

// ===== 创建 Session Memory =====

/** 创建一个新的空白 Session Memory */
export function createSessionMemory(sessionId: string): SessionMemory {
  return {
    sessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tokenEstimate: 0,
    toolCallCount: 0,
    sections: {
      current_state: DEFAULT_SESSION_SECTIONS.current_state,
      task_spec: DEFAULT_SESSION_SECTIONS.task_spec,
      files: DEFAULT_SESSION_SECTIONS.files,
      workflow: DEFAULT_SESSION_SECTIONS.workflow,
      errors: DEFAULT_SESSION_SECTIONS.errors,
      learnings: DEFAULT_SESSION_SECTIONS.learnings,
      key_results: DEFAULT_SESSION_SECTIONS.key_results,
      worklog: DEFAULT_SESSION_SECTIONS.worklog,
      pending: DEFAULT_SESSION_SECTIONS.pending,
      context_summary: DEFAULT_SESSION_SECTIONS.context_summary,
    },
  };
}

// ===== 更新 Section =====

/** 更新指定 section 的内容 */
export function updateSessionSection(
  memory: SessionMemory,
  key: SessionSectionKey,
  content: string
): SessionMemory {
  return {
    ...memory,
    sections: { ...memory.sections, [key]: content },
    updatedAt: new Date().toISOString(),
  };
}

// ===== 追加 Worklog =====

/** 追加一条 worklog 条目 */
export function appendWorklog(
  memory: SessionMemory,
  entry: string
): SessionMemory {
  const currentWorklog = memory.sections.worklog;
  const newWorklog = currentWorklog
    ? `${currentWorklog}\n- ${entry}`
    : `- ${entry}`;
  return {
    ...memory,
    sections: { ...memory.sections, worklog: newWorklog },
    updatedAt: new Date().toISOString(),
  };
}

// ===== 工具调用计数 =====

/** 递增工具调用计数 */
export function incrementToolCallCount(memory: SessionMemory): SessionMemory {
  return {
    ...memory,
    toolCallCount: memory.toolCallCount + 1,
    updatedAt: new Date().toISOString(),
  };
}

// ===== Token 估算 =====

/** 简单 token 估算：4 字符 ≈ 1 token（中文约 2 字符 ≈ 1 token） */
export function estimateTokens(text: string): number {
  // 中文字符数
  const chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  // 其他字符
  const otherCount = text.length - chineseCount;
  return Math.ceil(chineseCount / 2 + otherCount / 4);
}

/** 估算整条 Session Memory 的总 token 数 */
export function estimateSessionMemoryTokens(memory: SessionMemory): number {
  let total = 0;
  for (const content of Object.values(memory.sections)) {
    total += estimateTokens(content);
  }
  return total;
}

// ===== 是否触发 Compact =====

/** 判断是否需要触发上下文压缩（token ≥ 上限 85% 或 工具调用 ≥ 3） */
export function shouldCompactSession(memory: SessionMemory): boolean {
  const tokens = estimateSessionMemoryTokens(memory);
  if (tokens >= L0_MAX_TOKEN_ESTIMATE * 0.85) return true;
  if (memory.toolCallCount >= L0_COMPACT_TOOL_THRESHOLD) return true;
  return false;
}

// ===== 快路径：从最近消息快速更新 section =====

/** 从最近 3 条消息快速生成摘要（无需 LLM 调用的快路径） */
export function quickUpdateFromMessages(
  memory: SessionMemory,
  messages: ChatMessage[]
): SessionMemory {
  // 提取工作流相关消息（不限于最近3条）
  const workflowMessages = messages.filter(m =>
    m.messageType === 'workflow_preview' ||
    m.content.includes('工作流') ||
    m.content.includes('Workflow') ||
    m.metadata?.workflow ||
    m.metadata?.workflowId
  );

  // 更新 workflow section
  if (workflowMessages.length > 0) {
    const latestWorkflow = workflowMessages[workflowMessages.length - 1];
    const wfName = latestWorkflow.metadata?.workflow?.name || latestWorkflow.metadata?.workflowName || '未命名';
    memory = updateSessionSection(
      memory,
      'workflow',
      `当前工作流: ${wfName}\n描述: ${latestWorkflow.content.slice(0, 200)}`
    );
  }

  // 更新 task_spec section
  const taskMessages = messages.filter(m =>
    m.content.includes('任务') ||
    m.content.includes('需求') ||
    m.content.includes('帮我') ||
    m.content.includes('设计') ||
    m.content.includes('创建')
  );
  if (taskMessages.length > 0) {
    memory = updateSessionSection(
      memory,
      'task_spec',
      taskMessages[taskMessages.length - 1].content.slice(0, 300)
    );
  }

  const recentMessages = messages.slice(-3);

  // 更新 current_state：取最后一条 assistant 消息的内容摘要
  const lastAssistant = recentMessages.filter(m => m.role === 'assistant').pop();
  if (lastAssistant) {
    const summary = lastAssistant.content.slice(0, 200);
    memory = updateSessionSection(memory, 'current_state', summary);
  }

  // 更新 worklog：追加最近消息的关键信息
  for (const msg of recentMessages) {
    if (msg.role === 'user') {
      memory = appendWorklog(memory, `用户: ${msg.content.slice(0, 100)}`);
    } else if (msg.role === 'assistant') {
      memory = appendWorklog(memory, `助手: ${msg.content.slice(0, 100)}`);
    } else if (msg.role === 'tool') {
      memory = appendWorklog(memory, `工具(${msg.toolName || '?'}): 执行完成`);
      memory = incrementToolCallCount(memory);
    }
  }

  // 更新 token 估算
  memory = {
    ...memory,
    tokenEstimate: estimateSessionMemoryTokens(memory),
    updatedAt: new Date().toISOString(),
  };

  return memory;
}

// ===== 格式化注入（生成系统提示最前面的固定前缀） =====

/** 将 Session Memory 格式化为注入上下文（固定前缀优化：放在 system 最前） */
export function formatSessionMemoryForInjection(memory: SessionMemory): string {
  const lines: string[] = ['## 会话工作记忆'];

  for (const [key, content] of Object.entries(memory.sections)) {
    if (!content || content === DEFAULT_SESSION_SECTIONS[key as SessionSectionKey]) continue;
    const label: Record<SessionSectionKey, string> = {
      current_state: '📌 当前状态',
      task_spec: '🎯 任务规格',
      files: '📁 相关文件',
      workflow: '🔄 工作流',
      errors: '❌ 错误记录',
      learnings: '💡 学习记录',
      key_results: '✅ 关键成果',
      worklog: '📝 操作日志',
      pending: '⏳ 待完成',
      context_summary: '📊 上下文摘要',
    };
    lines.push(`${label[key as SessionSectionKey]}: ${content}`);
  }

  return lines.join('\n');
}

// ===== 从 ChatMessage 列表估算对话总 token =====

/** 估算 ChatMessage 列表的总 token 数 */
export function estimateConversationTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}
