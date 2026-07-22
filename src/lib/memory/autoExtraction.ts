/**
 * Auto Extraction — L0→L1 自动事实提取管道
 *
 * 参考：Claude Code Auto Memory Extraction（光标追踪 + forked agent + 主Agent互斥 + 权限沙箱）
 *
 * Phase 2 增强：
 * - LLM 提取：使用 routedChatLLM 从 assistant 回复中提取 4 类事实
 * - 光标追踪：extractionCursors 记录上次处理到的 messageId
 * - 主Agent 互斥：如果用户在当轮手动调用 memory_save，则跳过该段提取
 * - 降级兜底：关键词规则提取（inferMemoryType + extractKeywords）
 */

import type {
  ChatMessage,
  ExtractionResult,
  FactualMemory,
  FactualMemoryType,
} from '../../types';
import { useStore } from '../../store/useStore';
import { routedChatLLM } from '../../api/llmApi';
import { extractTaskFeatures } from '../modelRouter';
import {
  extractKeywords,
  inferMemoryType,
  isDuplicate,
} from './factualMemory';
import { L1_MAX_ENTRIES } from './types';

// ===== 光标追踪 =====

/** 获取上次提取处理到的光标位置（messageId） */
export function getExtractionCursor(sessionId: string): string | undefined {
  const store = useStore.getState();
  return store.extractionCursors[sessionId];
}

/** 更新提取光标 */
export function updateExtractionCursor(sessionId: string, messageId: string): void {
  const store = useStore.getState();
  store.setExtractionCursor(sessionId, messageId);
}

// ===== 提取 LLM 系统提示词 =====

const EXTRACTION_SYSTEM_PROMPT = `你是一个事实提取引擎。你的唯一任务是从对话内容中提取事实信息，输出 JSON 数组。

你可以提取以下 4 类事实：
1. **user** — 用户个人信息、团队背景、身份
2. **feedback** — 用户偏好、纠正、否定、明确指示（"不要"、"应该"、"避免"、"务必"等）
3. **project** — 项目技术栈、约定、架构、配置
4. **reference** — 外部链接、文档参考、资源引用

每条事实格式：
{
  "type": "user" | "feedback" | "project" | "reference",
  "content": "简明事实描述（≤200字）",
  "importance": 0.0-1.0（对用户的重要程度）
}

规则：
- 只提取明确陈述的事实，不要推断
- 合并相似事实（同一主题的多条信息合并为一条）
- 忽略临时性/情境性内容（如"帮我查一下当前状态"）
- 忽略纯操作指令（如"创建一个 agent"），除非其中包含偏好信息
- 重要性评估：用户明确强调的=0.8-1.0，自然提及的=0.5-0.7，间接暗示的=0.2-0.4
- 最多提取 5 条事实
- 如果没有可提取的事实，返回空数组 []

输出格式：纯 JSON 数组，不要添加任何其他文字。`;

// ===== LLM 提取 =====

/** 使用 LLM 从对话中提取事实 */
export async function extractFactsWithLLM(
  messages: ChatMessage[],
  sessionId: string
): Promise<ExtractionResult> {
  // 1. 光标追踪：只处理上次光标之后的新消息
  const cursor = getExtractionCursor(sessionId);
  const startIndex = cursor
    ? messages.findIndex((m) => m.id === cursor) + 1
    : 0;

  // 取最近 10 条消息作为提取窗口（避免过长）
  const windowMessages = messages.slice(
    Math.max(startIndex, messages.length - 10),
    messages.length
  );

  // 过滤掉 tool/system 消息，只保留 user 和 assistant
  const candidateMessages = windowMessages.filter(
    (m) => m.role === 'user' || m.role === 'assistant'
  );

  if (candidateMessages.length === 0) {
    return { extracted: [], method: 'llm', cursorUpdated: false };
  }

  // 2. 检查主Agent互斥：如果本轮中有 memory_save 工具调用，跳过提取
  const hasSelfEditCall = windowMessages.some(
    (m) => m.role === 'tool' && m.toolName?.startsWith('memory_')
  );
  if (hasSelfEditCall) {
    return { extracted: [], method: 'skipped_self_edit', cursorUpdated: false };
  }

  // 3. 构造 LLM 提取请求
  const extractionMessages = [
    { role: 'system' as const, content: EXTRACTION_SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: `从以下对话中提取事实信息：\n\n${candidateMessages
        .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
        .join('\n')}`,
    },
  ];

  try {
    const taskFeatures = extractTaskFeatures(
      candidateMessages.map((m) => m.content).join(' ')
    );
    const result = await routedChatLLM(
      {
        messages: extractionMessages,
        temperature: 0.2, // 低温度保证 JSON 稳定
        maxTokens: 2000,
      },
      { ...taskFeatures, category: 'extraction' }
    );

    if (!result.success || !result.content) {
      // LLM 失败 → 降级到关键词规则
      return fallbackKeywordExtraction(candidateMessages, sessionId);
    }

    // 4. 解析 LLM 输出的 JSON
    let facts: Array<{
      type: FactualMemoryType;
      content: string;
      importance: number;
    }>;

    try {
      // 尝试直接解析
      facts = JSON.parse(result.content);
    } catch {
      // 尝试从文本中提取 JSON 数组
      const jsonMatch = result.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        facts = JSON.parse(jsonMatch[0]);
      } else {
        // 解析失败 → 降级
        return fallbackKeywordExtraction(candidateMessages, sessionId);
      }
    }

    // 5. 转换为 FactualMemory 并去重
    const store = useStore.getState();
    const extracted: FactualMemory[] = [];

    for (const fact of facts) {
      if (!fact.type || !fact.content) continue;
      if (fact.content.length > 200) continue; // 过滤过长的

      const keywords = extractKeywords(fact.content);

      // 去重检查
      if (isDuplicate(fact.content, keywords, store.factualMemory)) continue;

      // 容量检查
      if (store.factualMemory.length + extracted.length >= L1_MAX_ENTRIES) break;

      const memory: FactualMemory = {
        id: `fm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: fact.type as FactualMemoryType,
        content: fact.content,
        tags: [],
        keywords,
        importance: Math.max(0, Math.min(1, fact.importance || 0.5)),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        accessCount: 0,
        lastAccessedAt: new Date().toISOString(),
        source: 'auto_extraction',
        sessionId,
      };

      extracted.push(memory);
    }

    // 6. 更新光标
    const lastMessageId = candidateMessages[candidateMessages.length - 1]?.id;
    if (lastMessageId) {
      updateExtractionCursor(sessionId, lastMessageId);
    }

    // 7. 写入 Store
    if (extracted.length > 0) {
      store.setFactualMemory([...store.factualMemory, ...extracted]);
      store.addMemoryAudit({
        layer: 'L1',
        action: 'create',
        targetId: extracted.map((m) => m.id).join(','),
        targetType: 'FactualMemory',
        after: `extracted ${extracted.length} facts via LLM`,
        source: 'extraction',
      });
    }

    return { extracted, method: 'llm', cursorUpdated: !!lastMessageId };
  } catch (error: any) {
    // LLM 调用异常 → 降级到关键词规则
    return fallbackKeywordExtraction(candidateMessages, sessionId);
  }
}

// ===== 降级兜底：关键词规则提取 =====

/** 关键词规则降级提取（当 LLM 不可用时） */
export function fallbackKeywordExtraction(
  messages: ChatMessage[],
  sessionId: string
): ExtractionResult {
  const store = useStore.getState();
  const extracted: FactualMemory[] = [];

  // 只处理 user 消息（assistant 回复不含用户偏好）
  const userMessages = messages.filter((m) => m.role === 'user');

  for (const msg of userMessages) {
    const content = msg.content;
    const keywords = extractKeywords(content);

    // 关键词推断类型
    const type = inferMemoryType(content);

    // 只提取有明确信号的消息（关键词命中数 ≥ 2）
    const keywordHits = keywords.filter((kw) =>
      Object.keys({
        '不要': 'feedback',
        '应该': 'feedback',
        '项目': 'project',
        '框架': 'project',
        '团队': 'user',
        '文档': 'reference',
      }).includes(kw)
    ).length;

    if (keywordHits < 2) continue;

    // 去重检查
    if (isDuplicate(content, keywords, store.factualMemory)) continue;

    // 容量检查
    if (store.factualMemory.length + extracted.length >= L1_MAX_ENTRIES) break;

    const memory: FactualMemory = {
      id: `fm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      content: content.slice(0, 200),
      tags: [],
      keywords,
      importance: keywordHits >= 4 ? 0.8 : keywordHits >= 2 ? 0.5 : 0.3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accessCount: 0,
      lastAccessedAt: new Date().toISOString(),
      source: 'auto_extraction_fallback',
      sessionId,
    };

    extracted.push(memory);
  }

  // 写入 Store
  if (extracted.length > 0) {
    store.setFactualMemory([...store.factualMemory, ...extracted]);
    store.addMemoryAudit({
      layer: 'L1',
      action: 'create',
      targetId: extracted.map((m) => m.id).join(','),
      targetType: 'FactualMemory',
      after: `extracted ${extracted.length} facts via keyword fallback`,
      source: 'auto',
    });
  }

  return { extracted, method: 'keyword_fallback', cursorUpdated: false };
}

// ===== 手动触发入口 =====

/** 手动触发 Auto Extraction（用于 /extract 斜杠命令或调试） */
export async function runAutoExtraction(
  sessionId: string,
  messages: ChatMessage[]
): Promise<ExtractionResult> {
  return extractFactsWithLLM(messages, sessionId);
}
