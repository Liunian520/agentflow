/**
 * Dynamic Recall — 动态按需召回（tengu_moth_copse）
 *
 * 参考：Claude Code tengu_moth_copse（frontmatter扫描→Sonnet从200个候选挑≤5→注入user message）
 * Phase 1 MVP：关键词版（frontmatterScan + Jaccard 粗筛 top5）
 * Phase 2 增强：加 LLM 挑选层（LLM 从候选池中精选 ≤5 条）
 *
 * 降级兜底：Jaccard + 关键词加分 top5
 */

import type { FactualMemory, RecallResult, ExecutionTrace } from '../../types';
import { RECALL_MAX_SELECTED, RECALL_CANDIDATE_POOL } from './types';
import {
  frontmatterScan,
  formatFactualMemoryForInjection,
} from './factualMemory';
import { computeSimilarity } from '../experienceBank';
import { routedChatLLM } from '../../api/llmApi';
import { extractTaskFeatures } from '../modelRouter';

// ===== LLM 挑选系统提示词 =====

const RECALL_SELECT_SYSTEM_PROMPT = `你是一个记忆召回筛选引擎。你的任务是从候选记忆条目中挑选出最相关的 ≤5 条，以帮助回答当前用户查询。

规则：
- 挑选与用户查询最直接相关的条目
- 优先选择重要性高（importance）的条目
- 去除重复或过于相似的条目
- 如果候选条目都不相关，返回空数组
- 每条选中条目需要给出简要理由（1句话）

输出格式（纯 JSON）：
{
  "selected_indices": [0, 3, 7],
  "reasons": [
    "直接回答了用户的技术栈问题",
    "包含用户明确表达的偏好"
  ]
}

其中 indices 是候选列表中的位置索引（从0开始）。`;

// ===== L1 Factual Memory 召回 — 关键词版（降级兜底） =====

/** Dynamic Recall — 关键词版（降级兜底，当 LLM 挑选不可用时） */
export function dynamicRecallFactualFallback(
  query: string,
  factualMemories: FactualMemory[]
): RecallResult {
  if (factualMemories.length === 0) {
    return {
      candidates: [],
      selected: [],
      injectedContext: '',
    };
  }

  // Phase 1: frontmatter 粗筛 top RECALL_CANDIDATE_POOL
  const candidates = frontmatterScan(
    factualMemories,
    query,
    RECALL_CANDIDATE_POOL
  );

  // 直接取得分最高的 top 5（无 LLM 挑选）
  const selected = candidates
    .filter((c) => c.score > 0.05)  // 过滤得分太低的
    .slice(0, RECALL_MAX_SELECTED)
    .map((c) => c.memory);

  // 生成注入上下文
  const injectedContext = formatFactualMemoryForInjection(selected);

  return {
    candidates: candidates.map((c) => ({ memory: c.memory, score: c.score, reason: `score=${c.score.toFixed(3)}, type=${c.memory.type}` })),
    selected,
    injectedContext,
  };
}

// ===== L1 Factual Memory 召回 — LLM 挑选版 =====

/** Dynamic Recall — LLM 挑选版（Phase 2 增强） */
export async function dynamicRecallFactualWithLLM(
  query: string,
  factualMemories: FactualMemory[]
): Promise<RecallResult> {
  if (factualMemories.length === 0) {
    return {
      candidates: [],
      selected: [],
      injectedContext: '',
    };
  }

  // Phase 1: frontmatter 粗筛 top RECALL_CANDIDATE_POOL
  const candidates = frontmatterScan(
    factualMemories,
    query,
    RECALL_CANDIDATE_POOL
  );

  // 候选太少时直接返回，无需 LLM 挑选
  if (candidates.length <= RECALL_MAX_SELECTED) {
    const selected = candidates
      .filter((c) => c.score > 0.05)
      .map((c) => c.memory);

    const injectedContext = formatFactualMemoryForInjection(selected);

    return {
      candidates: candidates.map((c) => ({ memory: c.memory, score: c.score, reason: `score=${c.score.toFixed(3)}, type=${c.memory.type}` })),
      selected,
      injectedContext,
    };
  }

  // Phase 2: LLM 挑选层 — 从候选池中精选 ≤ RECALL_MAX_SELECTED 条
  try {
    const candidateDescriptions = candidates.map((c, i) =>
      `[${i}] type=${c.memory.type}, importance=${c.memory.importance}, content="${c.memory.content.slice(0, 150)}"`
    ).join('\n');

    const taskFeatures = extractTaskFeatures(query);

    const result = await routedChatLLM(
      {
        messages: [
          { role: 'system', content: RECALL_SELECT_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `用户查询: "${query}"\n\n候选记忆条目:\n${candidateDescriptions}`,
          },
        ],
        temperature: 0.1, // 极低温度保证稳定筛选
        maxTokens: 500,
      },
      { ...taskFeatures, category: 'recall_select' }
    );

    if (!result.success || !result.content) {
      // LLM 失败 → 降级
      return dynamicRecallFactualFallback(query, factualMemories);
    }

    // 解析 LLM 输出
    let selectedIndices: number[];
    let reasons: string[];

    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        selectedIndices = parsed.selected_indices || [];
        reasons = parsed.reasons || [];
      } else {
        return dynamicRecallFactualFallback(query, factualMemories);
      }
    } catch {
      return dynamicRecallFactualFallback(query, factualMemories);
    }

    // 从候选池中按索引取条目
    const selected = selectedIndices
      .filter((i) => i >= 0 && i < candidates.length)
      .slice(0, RECALL_MAX_SELECTED)
      .map((i) => candidates[i].memory);

    // 生成注入上下文
    const injectedContext = formatFactualMemoryForInjection(selected);

    return {
      candidates: candidates.map((c, i) => ({
        memory: c.memory,
        score: c.score,
        reason: selectedIndices.includes(i)
          ? reasons[selectedIndices.indexOf(i)] || `LLM selected, score=${c.score.toFixed(3)}`
          : `score=${c.score.toFixed(3)}, type=${c.memory.type}`,
      })),
      selected,
      injectedContext,
    };
  } catch {
    // LLM 异常 → 降级
    return dynamicRecallFactualFallback(query, factualMemories);
  }
}

// ===== L2-A Traces 召回 =====

/** 从 Experience Bank 中召回相关执行轨迹 */
export function dynamicRecallTraces(
  query: string,
  traces: ExecutionTrace[],
  maxResults = 3
): { traces: ExecutionTrace[]; context: string } {
  if (traces.length === 0) {
    return { traces: [], context: '' };
  }

  // 使用现有 experienceBank 的 computeSimilarity
  const scored = traces.map((t) => ({
    trace: t,
    score: computeSimilarity(query, t.userInput),
  }));

  scored.sort((a, b) => b.score - a.score);

  const selected = scored
    .filter((s) => s.score > 0.3)
    .slice(0, maxResults)
    .map((s) => s.trace);

  if (selected.length === 0) {
    return { traces: [], context: '' };
  }

  const context = selected.map((t) => {
    const outcomeLabel = {
      success: '✅ 成功',
      partial: '⚠️ 部分',
      failure: '❌ 失败',
    }[t.outcome];
    return `[${outcomeLabel}] 用户输入: "${t.userInput.slice(0, 50)}" → 结果: ${t.outcome}`;
  }).join('\n');

  return { traces: selected, context: `## 相关历史经验\n${context}` };
}

// ===== 综合召回入口 =====

/** 综合召回：L1 Factual + L2-A Traces，统一生成注入上下文（同步降级版） */
export function dynamicRecallAll(
  query: string,
  factualMemories: FactualMemory[],
  traces: ExecutionTrace[]
): {
  recalledContext: string;
  factualResult: RecallResult;
  traceResult: { traces: ExecutionTrace[]; context: string };
} {
  // L1 Factual Memory 召回（降级兜底版，同步调用）
  const factualResult = dynamicRecallFactualFallback(query, factualMemories);

  // L2-A Traces 召回
  const traceResult = dynamicRecallTraces(query, traces);

  // 合并注入上下文
  const parts: string[] = [];
  if (factualResult.injectedContext) parts.push(factualResult.injectedContext);
  if (traceResult.context) parts.push(traceResult.context);

  const recalledContext = parts.join('\n\n');

  return { recalledContext, factualResult, traceResult };
}

/** 综合召回：L1 Factual + L2-A Traces（LLM 挑选版，异步调用） */
export async function dynamicRecallAllWithLLM(
  query: string,
  factualMemories: FactualMemory[],
  traces: ExecutionTrace[]
): Promise<{
  recalledContext: string;
  factualResult: RecallResult;
  traceResult: { traces: ExecutionTrace[]; context: string };
}> {
  // L1 Factual Memory 召回（LLM 挑选版，异步）
  const factualResult = await dynamicRecallFactualWithLLM(query, factualMemories);

  // L2-A Traces 召回（不需要 LLM，同步）
  const traceResult = dynamicRecallTraces(query, traces);

  // 合并注入上下文
  const parts: string[] = [];
  if (factualResult.injectedContext) parts.push(factualResult.injectedContext);
  if (traceResult.context) parts.push(traceResult.context);

  const recalledContext = parts.join('\n\n');

  return { recalledContext, factualResult, traceResult };
}

// ===== 固定前缀布局 =====

/**
 * 固定前缀优化（参考 Claude Code KV 缓存命中率优化）：
 * - L0 Session Memory → system message 最前（固定）
 * - L2-C Strategies (MetaSkill) → system message 中间（半固定）
 * - L1/L2-A/B → user message（动态）
 */

/** 格式化注入上下文放置位置建议 */
export function getInjectionLayout(
  sessionMemoryContext: string,
  metaSkillContext: string,
  recalledContext: string
): {
  systemPrefix: string;   // L0 Session Memory（固定前缀）
  systemMiddle: string;   // L2-C Meta-Skill 策略（半固定）
  userPrefix: string;     // L1/L2-A/B 动态召回（动态前缀）
} {
  return {
    systemPrefix: sessionMemoryContext,
    systemMiddle: metaSkillContext,
    userPrefix: recalledContext,
  };
}
