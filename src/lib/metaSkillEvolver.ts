/**
 * Meta-Skill 进化器 — Skill-MAS 论文 Phase 3：Selective Reflection
 *
 * 核心思想（来自论文）：不是每次失败都反思，而是
 * 1. 评估"是否值得反思"（失败样本是否累积到阈值 / 是否出现系统性失败模式）
 * 2. 用 LLM 做"失败 vs 成功"对比分析（within-task + cross-task）
 * 3. 提炼策略级（而非补丁级）改进原则，合并进三层 Meta-Skill
 *
 * 本模块保持"纯函数"：不直接读写 Store，由调用方（ChatWorkspacePage）负责落地。
 */

import type { MetaSkill, ExecutionTrace } from '../types';
import { chatLLM, getAvailableChannelFromStore } from '../api/llmApi';
import { buildMetaAgentSystemPrompt, mergeMetaSkillUpdate } from './metaSkill';
import { findFailureTraces, clusterFailureModes, buildReflectionContext } from './experienceBank';

// 反思触发阈值：累积失败达到此数量才触发（避免单次失败就浪费 LLM 调用）
const FAILURE_TRIGGER_THRESHOLD = 3;

// ===== 评估是否值得反思（Adaptive Elbow Truncation 简化版） =====
export function evaluateReflectionPriority(bank: ExecutionTrace[]): {
  shouldReflect: boolean;
  reason: string;
  failedTraces: ExecutionTrace[];
  successTraces: ExecutionTrace[];
} {
  const failedTraces = findFailureTraces(bank, 20);

  if (failedTraces.length < FAILURE_TRIGGER_THRESHOLD) {
    return {
      shouldReflect: false,
      reason: `失败样本不足（${failedTraces.length}/${FAILURE_TRIGGER_THRESHOLD}），暂不反思`,
      failedTraces,
      successTraces: [],
    };
  }

  // 聚类失败模式，找出系统性问题
  const clustered = clusterFailureModes(failedTraces).slice(0, 3);
  const successTraces = bank
    .filter(t => t.outcome === 'success')
    .slice(-5);

  return {
    shouldReflect: true,
    reason: `累积 ${failedTraces.length} 次失败，主要模式：${clustered.map(c => `${c.mode}(×${c.count})`).join('、') || '通用'}`,
    failedTraces,
    successTraces,
  };
}

// ===== 解析 LLM 反思输出 =====
function parseReflectionOutput(raw: string): {
  summary: string;
  decomposition: string[];
  engineering: string[];
  orchestration: string[];
} {
  // 尝试提取 JSON
  let jsonStr: string | null = null;
  try {
    JSON.parse(raw);
    jsonStr = raw;
  } catch {
    const m = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (m) jsonStr = m[1];
    else {
      const fb = raw.indexOf('{'), lb = raw.lastIndexOf('}');
      if (fb >= 0 && lb > fb) jsonStr = raw.slice(fb, lb + 1);
    }
  }

  if (jsonStr) {
    try {
      const p = JSON.parse(jsonStr);
      return {
        summary: typeof p.summary === 'string' ? p.summary : '策略已更新',
        decomposition: Array.isArray(p.decomposition) ? p.decomposition.map(String) : [],
        engineering: Array.isArray(p.engineering) ? p.engineering.map(String) : [],
        orchestration: Array.isArray(p.orchestration) ? p.orchestration.map(String) : [],
      };
    } catch {
      // 解析失败，尝试从文本中提取要点
    }
  }

  // 文本兜底：按行提取，过滤空行
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  return { summary: raw.slice(0, 200), decomposition: [], engineering: [], orchestration: lines };
}

// ===== LLM 对比分析 → 提炼策略改进 =====
async function reflectAndEvolve(params: {
  failedTraces: ExecutionTrace[];
  successTraces: ExecutionTrace[];
  currentSkill: MetaSkill;
}): Promise<{ newSkill: MetaSkill; summary: string }> {
  const channelInfo = await getAvailableChannelFromStore();

  if (!channelInfo) {
    return { newSkill: params.currentSkill, summary: '⚠️ 无可用 LLM 渠道，跳过反思进化。' };
  }

  const systemPrompt = `${buildMetaAgentSystemPrompt(params.currentSkill)}

你现在执行 Selective Reflection：对比失败与成功案例，提炼可迁移的、策略级的改进原则。只输出 JSON：
{
  "summary": "本次改进的简要说明",
  "decomposition": ["任务分解层改进原则1", "..."],
  "engineering": ["Agent 工程层改进原则1", "..."],
  "orchestration": ["工作流编排层改进原则1", "..."]
}`;

  const userContent = buildReflectionContext(
    params.failedTraces,
    params.successTraces,
    `${params.currentSkill.decomposition}\n\n${params.currentSkill.engineering}\n\n${params.currentSkill.orchestration}`,
  );

  try {
    const result = await chatLLM({
      channelId: channelInfo.channelId,
      provider: channelInfo.provider as any,
      baseUrl: channelInfo.baseUrl,
      apiKey: channelInfo.apiKey,
      model: channelInfo.models[0]?.name || 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.4,
      maxTokens: 1500,
    });

    if (!result.success || !result.content) {
      return { newSkill: params.currentSkill, summary: '反思调用失败，策略未变更。' };
    }

    const parsed = parseReflectionOutput(result.content);
    const newSkill = mergeMetaSkillUpdate(
      params.currentSkill,
      {
        decompositionAdditions: parsed.decomposition,
        engineeringAdditions: parsed.engineering,
        orchestrationAdditions: parsed.orchestration,
      },
      'auto-reflection',
      parsed.summary,
      params.failedTraces.length,
    );

    return { newSkill, summary: parsed.summary };
  } catch (error) {
    console.error('[MetaSkillEvolver] reflection failed:', error);
    return { newSkill: params.currentSkill, summary: '反思过程出错，策略未变更。' };
  }
}

// ===== 统一入口：评估 + 反思 + 返回结果（不读写 Store） =====
export async function runReflection(
  bank: ExecutionTrace[],
  currentSkill: MetaSkill,
): Promise<{
  evolved: boolean;
  newSkill: MetaSkill;
  summary: string;
  reason: string;
}> {
  const evalResult = evaluateReflectionPriority(bank);

  if (!evalResult.shouldReflect) {
    return { evolved: false, newSkill: currentSkill, summary: evalResult.reason, reason: evalResult.reason };
  }

  const { newSkill, summary } = await reflectAndEvolve({
    failedTraces: evalResult.failedTraces,
    successTraces: evalResult.successTraces,
    currentSkill,
  });

  return {
    evolved: newSkill.version > currentSkill.version,
    newSkill,
    summary,
    reason: evalResult.reason,
  };
}
