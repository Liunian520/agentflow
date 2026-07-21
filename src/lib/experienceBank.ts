/**
 * Experience Memory Bank — 执行轨迹记录与经验检索
 * Phase 2 基础设施：为 Meta-Agent 提供历史经验参考
 * 
 * 存储每次编排的执行轨迹（成功/失败），支持：
 * - 检索相关历史经验（基于输入相似度）
 * - 为 Meta-Agent 提供参考上下文
 * - 为 Selective Reflection 提供对比分析材料
 */

import type { ExecutionTrace, OrchestrationPlan } from '../types';
import { generateId } from './utils';

// ===== 记录执行轨迹 =====

export function recordExecutionTrace(
  userInput: string,
  plan: OrchestrationPlan,
  outcome: 'success' | 'partial' | 'failure',
  resultData: Record<string, any>,
  failureModes?: string[],
): ExecutionTrace {
  return {
    id: generateId(),
    timestamp: new Date().toISOString(),
    userInput,
    plan,
    outcome,
    resultData,
    failureModes,
    duration: resultData.duration || undefined,
  };
}

// ===== 检索相关历史经验 =====
// 简单关键词相似度匹配 → 后续可升级为向量检索

export function findRelevantExperience(
  userInput: string,
  bank: ExecutionTrace[],
  maxResults: number = 3,
): ExecutionTrace[] {
  // 只检索成功案例作为正面参考
  const successTraces = bank.filter(t => t.outcome === 'success');

  if (successTraces.length === 0) return [];

  // 计算每个成功案例与当前输入的相似度
  const scored = successTraces.map(trace => ({
    trace,
    score: computeSimilarity(userInput, trace.userInput),
  }));

  // 按相似度降序排列，返回最相关的
  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter(s => s.score > 0.3) // 至少 30% 相似才有参考价值
    .slice(0, maxResults)
    .map(s => s.trace);
}

// ===== 检索失败案例（用于 Selective Reflection） =====

export function findFailureTraces(
  bank: ExecutionTrace[],
  maxResults: number = 5,
): ExecutionTrace[] {
  return bank
    .filter(t => t.outcome === 'failure')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, maxResults);
}

// ===== 失败模式聚类（Adaptive Elbow Truncation 简化版） =====
// 统计失败模式出现频次，返回最常见的若干模式，用于判断是否有"值得反思"的系统性问题

export function clusterFailureModes(
  failures: ExecutionTrace[],
): { mode: string; count: number }[] {
  const modeCount: Record<string, number> = {};
  failures.forEach(t => {
    (t.failureModes && t.failureModes.length > 0 ? t.failureModes : ['未知错误'])
      .forEach(m => { modeCount[m] = (modeCount[m] || 0) + 1; });
  });
  return Object.entries(modeCount)
    .map(([mode, count]) => ({ mode, count }))
    .sort((a, b) => b.count - a.count);
}

// ===== 构建反思对比上下文（失败 vs 成功） =====
// 供 reflectAndEvolve 调用 LLM 做对比分析

export function buildReflectionContext(
  failedTraces: ExecutionTrace[],
  successTraces: ExecutionTrace[],
  currentStrategy: string,
): string {
  const failedBlock = failedTraces.map(t => {
    const summary = t.plan.source === 'meta_agent'
      ? `Agent×${t.plan.agents.length}, 工作流:${t.plan.workflow ? t.plan.workflow.nodes.length + '节点' : '无'}`
      : `意图:${t.plan.intent}`;
    const modes = (t.failureModes || []).join('; ') || '未知';
    return `- 输入:"${t.userInput}" | 方案:${summary} | 失败模式:${modes}`;
  }).join('\n');

  const successBlock = successTraces.map(t => {
    const summary = t.plan.source === 'meta_agent'
      ? `Agent×${t.plan.agents.length}, 工作流:${t.plan.workflow ? t.plan.workflow.nodes.length + '节点' : '无'}`
      : `意图:${t.plan.intent}`;
    return `- 输入:"${t.userInput}" | 方案:${summary}`;
  }).join('\n');

  return `## 当前三层策略
${currentStrategy}

## 失败案例（${failedTraces.length}）
${failedBlock || '（无）'}

## 成功案例（${successTraces.length}）
${successBlock || '（无）'}

## 任务
请做对比分析（within-task + cross-task），找出导致失败的系统性模式，并提炼 1-4 条可迁移的、策略级的改进原则，分别归入 decomposition / engineering / orchestration 三层。不要针对单次错误打补丁，要提炼通用原则。`;
}

// ===== 构建经验上下文注入 Meta-Agent =====
// 将检索到的相关经验格式化为 LLM 可理解的自然语言

export function buildExperienceContext(relevantTraces: ExecutionTrace[]): string {
  if (relevantTraces.length === 0) return '';

  const entries = relevantTraces.map(trace => {
    const planSummary = trace.plan.source === 'meta_agent'
      ? `Generated ${trace.plan.agents.length} agent(s), ${trace.plan.workflow ? `${trace.plan.workflow.nodes.length}-node workflow` : 'no workflow'}`
      : `Intent: ${trace.plan.intent}, params: ${JSON.stringify(trace.plan.subTasks[0]?.params || {}).slice(0, 100)}`;

    return `- Input: "${trace.userInput}" -> Outcome: ${trace.outcome}
  Plan: ${planSummary}`;
  });

  return `\n## Relevant Past Experience (for reference)\n${entries.join('\n')}\n\nUse these successful cases as patterns when designing the current orchestration plan.`;
}

// ===== 简单文本相似度计算 =====
// 基于 Jaccard 词集合相似度 + 关键词命中加分

function computeSimilarity(textA: string, textB: string): number {
  const wordsA = tokenize(textA);
  const wordsB = tokenize(textB);

  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  // Jaccard 相似度
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = new Set([...setA].filter(w => setB.has(w)));
  const union = new Set([...setA, ...setB]);

  const jaccard = intersection.size / union.size;

  // 关键词命中加分（中文关键词特别加分）
  const keyTerms = ['agent', '工作流', 'workflow', '创建', 'create', '列表', 'list', '运行', 'run', '搜索', '代码', '数据', '审核', '翻译'];
  const keyHits = keyTerms.filter(k => textA.includes(k) && textB.includes(k)).length;
  const keyBonus = keyHits * 0.1;

  return Math.min(jaccard + keyBonus, 1.0);
}

// ===== 中文+英文文本分词 =====

function tokenize(text: string): string[] {
  // 英文单词
  const englishWords = text.toLowerCase().match(/[a-z]+/g) || [];

  // 中文字符（每个字作为 token，也尝试2字组合）
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
  const chinesePairs = text.match(/[\u4e00-\u9fa5]{2}/g) || [];

  return [...englishWords, ...chineseChars, ...chinesePairs];
}
