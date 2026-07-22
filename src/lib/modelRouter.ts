/**
 * ACRouter 自进化模型路由引擎 — 基于 Agent-as-a-Router 论文 (arXiv:2606.22902)
 *
 * C-A-F 闭环：Context(任务特征) → Action(选模型) → Feedback(执行反馈) → 回写 Memory → 越用越准
 *
 * 三大模块映射：
 * - Orchestrator：冷启动先验 + 统计先验 + kNN历史检索 + 成本项 + ε-greedy 探索
 * - Verifier：outcome + 延迟 + 估算token成本 → composite 评分
 * - Memory：routerMemory 记录每次 (任务, 模型, 分数, 成本, 延迟)，随使用增长
 */

import type {
  TaskFeatures, RouterCategory, RoutingPoolEntry, RoutingDecision,
  RouterRecord, ModelPerfStats, AgentMode,
} from '../types';
import { generateId } from './utils';

// ===== 常量 =====
const MIN_SAMPLES = 3;          // 统计先验生效的最小样本数
const KNN_K = 5;                // kNN 检索数量
const MEMORY_CAP = 1000;        // routerMemory 上限（调大以保留更多历史经验）
const COMPACT_BATCH = 200;      // 压缩时丢弃的最旧记录数
const MAX_LATENCY = 30000;      // 延迟上限(ms)，用于归一化
const MAX_TOKENS = 8000;        // token 上限（调大以适配长输出模型），用于归一化

// 融合权重
const W_STAT = 0.50;
const W_KNN = 0.35;
const W_COST = 0.15;

// ===== 文本相似度（复用 experienceBank 的 Jaccard + 关键词加分逻辑） =====

function tokenize(text: string): string[] {
  const englishWords = text.toLowerCase().match(/[a-z]+/g) || [];
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
  const chinesePairs = text.match(/[\u4e00-\u9fa5]{2}/g) || [];
  return [...englishWords, ...chineseChars, ...chinesePairs];
}

function computeSimilarity(textA: string, textB: string): number {
  const wordsA = tokenize(textA);
  const wordsB = tokenize(textB);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = new Set([...setA].filter((w) => setB.has(w)));
  const union = new Set([...setA, ...setB]);
  const jaccard = intersection.size / union.size;

  const keyTerms = ['agent', '工作流', 'workflow', '创建', 'create', '列表', 'list', '运行', 'run', '搜索', '代码', '数据', '审核', '翻译', '调试', 'bug', '分析'];
  const keyHits = keyTerms.filter((k) => textA.includes(k) && textB.includes(k)).length;
  return Math.min(jaccard + keyHits * 0.1, 1.0);
}

// ===== (C) Context — 任务特征提取 =====

const CATEGORY_KEYWORDS: Record<RouterCategory, string[]> = {
  code: ['代码', 'code', '函数', 'function', '调试', 'debug', 'bug', '错误', 'error', '编程', 'program', '修复', 'fix', '重构', 'refactor'],
  orchestration: ['创建', '编排', '工作流', 'workflow', '流程', 'pipeline', 'agent', '节点', '助手', '智能体'],
  multilingual: ['翻译', 'translate', '多语言', '英文', '中文', 'english', 'chinese', '日语', '韩语'],
  creative: ['写作', '文案', '创意', 'write', 'story', '文章', '诗歌', '营销', '文案', '内容'],
  reasoning: ['分析', '推理', '数学', '计算', 'logic', 'reason', 'solve', '解决', '对比', '评估', '算法'],
  chat: [],
  extraction: ['提取', 'extract', '记忆', '事实', '偏好', 'feedback'],
  recall_select: ['召回', 'recall', '搜索', '记忆', '检索', 'context'],
  dream_consolidation: ['整合', 'dream', '合并', '蒸馏', '反思', 'reflection'],
};

export function extractTaskFeatures(
  input: string,
  ctx?: { intent?: string; mode?: AgentMode },
): TaskFeatures {
  const lower = input.toLowerCase();
  const hasCode = /\b(code|function|bug|debug|error|代码|函数|调试|报错)\b/i.test(input);
  const hasWorkflowKeywords = /工作流|workflow|编排|流程|pipeline|创建.*agent|节点/i.test(input);

  // category 推断：按优先级匹配
  let category: RouterCategory = 'chat';
  const categoryOrder: RouterCategory[] = ['code', 'orchestration', 'multilingual', 'creative', 'reasoning', 'chat'];
  for (const cat of categoryOrder) {
    const kws = CATEGORY_KEYWORDS[cat];
    if (kws.length > 0 && kws.some((k) => lower.includes(k.toLowerCase()) || input.includes(k))) {
      category = cat;
      break;
    }
  }

  return {
    intent: ctx?.intent || 'general_chat',
    mode: ctx?.mode,
    category,
    keywords: tokenize(input).slice(0, 30),
    inputLength: input.length,
    hasCode,
    hasWorkflowKeywords,
    inputFingerprint: input.slice(0, 200),
  };
}

// ===== 路由池 =====

export async function getRoutingPool(): Promise<RoutingPoolEntry[]> {
  const { useStore } = await import('../store/useStore');
  const store = useStore.getState();
  const enabledChannels = store.channels.filter((c) => c.enabled && c.apiKey);

  const pool: RoutingPoolEntry[] = [];
  const seen = new Set<string>();
  for (const channel of enabledChannels) {
    for (const model of channel.models) {
      const key = `${channel.provider}:${model.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push({
        channelId: channel.id,
        provider: channel.provider,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        modelName: model.name,
        displayName: model.displayName || model.name,
      });
    }
  }
  return pool;
}

// ===== 模型家族识别 + 冷启动启发式先验 =====

function modelFamily(modelName: string): string {
  const lower = modelName.toLowerCase();
  if (/gpt|o\d|turbo/.test(lower)) return 'gpt';
  if (/claude|sonnet|opus|haiku/.test(lower)) return 'claude';
  if (/deepseek/.test(lower)) return 'deepseek';
  if (/gemini/.test(lower)) return 'gemini';
  if (/qwen|通义/.test(lower)) return 'qwen';
  if (/glm|chatglm|智谱/.test(lower)) return 'glm';
  if (/kimi|moonshot/.test(lower)) return 'kimi';
  if (/doubao|豆包/.test(lower)) return 'doubao';
  if (/hunyuan|混元/.test(lower)) return 'hunyuan';
  if (/spark|星火/.test(lower)) return 'spark';
  return 'other';
}

// 冷启动先验：按 category → 模型家族偏好（来自 metaSkill engineering 策略）
const COLD_START_PREFERENCE: Record<RouterCategory, string[]> = {
  creative: ['claude', 'gpt'],
  reasoning: ['deepseek', 'gpt', 'claude'],
  code: ['deepseek', 'gpt', 'claude'],
  multilingual: ['gemini', 'gpt', 'claude'],
  orchestration: ['gpt', 'claude', 'deepseek'],
  chat: ['deepseek', 'qwen', 'gpt', 'glm'],
  extraction: ['deepseek', 'gpt', 'claude'],
  recall_select: ['claude', 'gpt', 'deepseek'],
  dream_consolidation: ['claude', 'gpt', 'deepseek'],
};

function coldStartPrior(modelName: string, category: RouterCategory): number {
  const family = modelFamily(modelName);
  const prefs = COLD_START_PREFERENCE[category];
  const idx = prefs.indexOf(family);
  if (idx === -1) return 0.4; // 未列入偏好的家族给中低分
  // 第1偏好 0.8，第2偏好 0.65，第3偏好 0.55，递减
  return Math.max(0.5, 0.8 - idx * 0.15);
}

// ===== 统计先验 =====

function modelKey(provider: string, modelName: string): string {
  return `${provider}:${modelName}`;
}

export function getStats(
  memory: RouterRecord[],
  mKey: string,
  category: RouterCategory,
): ModelPerfStats {
  const records = memory.filter(
    (r) => modelKey(r.provider, r.modelName) === mKey && r.taskFeatures.category === category,
  );
  const n = records.length;
  if (n === 0) {
    return { modelKey: mKey, category, samples: 0, avgScore: 0, successRate: 0, avgLatency: 0, avgCost: 0 };
  }
  const sum = records.reduce(
    (acc, r) => ({
      score: acc.score + r.score,
      success: acc.success + (r.outcome === 'success' ? 1 : 0),
      latency: acc.latency + r.latencyMs,
      cost: acc.cost + r.estTokens,
    }),
    { score: 0, success: 0, latency: 0, cost: 0 },
  );
  return {
    modelKey: mKey,
    category,
    samples: n,
    avgScore: sum.score / n,
    successRate: sum.success / n,
    avgLatency: sum.latency / n,
    avgCost: sum.cost / n,
  };
}

function statPrior(memory: RouterRecord[], mKey: string, category: RouterCategory): number | null {
  const stats = getStats(memory, mKey, category);
  if (stats.samples < MIN_SAMPLES) return null;
  return stats.avgScore;
}

// ===== kNN 历史检索 =====

function knnScore(
  memory: RouterRecord[],
  features: TaskFeatures,
  mKey: string,
): number | null {
  // 取与当前任务指纹相似的历史记录
  const scored = memory
    .map((r) => ({
      record: r,
      sim: computeSimilarity(features.inputFingerprint, r.taskFeatures.inputFingerprint),
    }))
    .filter((s) => s.sim > 0.2)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, KNN_K);

  // 只看用了该模型的记录
  const relevant = scored.filter((s) => modelKey(s.record.provider, s.record.modelName) === mKey);
  if (relevant.length === 0) return null;

  const simSum = relevant.reduce((acc, s) => acc + s.sim, 0);
  if (simSum === 0) return null;
  const weightedScore = relevant.reduce((acc, s) => acc + s.sim * s.record.score, 0) / simSum;
  return weightedScore;
}

// ===== (A) Action — Orchestrator 决策 =====

export function selectModel(
  features: TaskFeatures,
  pool: RoutingPoolEntry[],
  memory: RouterRecord[],
): RoutingDecision | null {
  if (pool.length === 0) return null;
  // 单模型池：直接选它（仍记录反馈）
  if (pool.length === 1) {
    const e = pool[0];
    return {
      channelId: e.channelId,
      modelName: e.modelName,
      modelDisplayName: e.displayName || e.modelName,
      provider: e.provider,
      baseUrl: e.baseUrl,
      apiKey: e.apiKey,
      reasoning: '路由池仅一个模型，直接选用',
      alternatives: [],
      explored: false,
      strategy: 'only_one',
    };
  }

  // 为每个候选模型计算融合得分
  const candidates = pool.map((entry) => {
    const mKey = modelKey(entry.provider, entry.modelName);
    const stat = statPrior(memory, mKey, features.category);
    const statOrCold = stat !== null ? stat : coldStartPrior(entry.modelName, features.category);
    const knn = knnScore(memory, features, mKey);
    const knnVal = knn !== null ? knn : statOrCold; // 无 kNN 数据回落先验

    // 成本效率：用该模型历史均成本，无数据用中性 0.5
    const costStats = getStats(memory, mKey, features.category);
    const costEff = costStats.samples > 0
      ? Math.max(0, 1 - costStats.avgCost / MAX_TOKENS)
      : 0.5;

    const finalScore = W_STAT * statOrCold + W_KNN * knnVal + W_COST * costEff;
    return { entry, mKey, finalScore, statOrCold, knnVal, costEff };
  });

  candidates.sort((a, b) => b.finalScore - a.finalScore);

  // ε-greedy 探索：样本越多探索越少
  const totalSamples = memory.length;
  const epsilon = 0.1 * (1 - Math.min(totalSamples / 200, 0.8));
  const explored = Math.random() < epsilon && candidates.length > 1;

  let chosen = candidates[0];
  if (explored) {
    // 探索：在非最优候选中随机选一个，采集反馈
    const others = candidates.slice(1);
    chosen = others[Math.floor(Math.random() * others.length)];
  }

  const alternatives = candidates.slice(0, Math.min(4, candidates.length)).map((c) => ({
    modelName: c.entry.modelName,
    score: Number(c.finalScore.toFixed(3)),
  }));

  const reasonParts: string[] = [];
  reasonParts.push(`${chosen.statOrCold >= 0.7 ? '统计/先验表现优' : '先验匹配'}`);
  if (chosen.knnVal !== chosen.statOrCold) reasonParts.push(`kNN相似任务均分${chosen.knnVal.toFixed(2)}`);
  reasonParts.push(`成本效率${chosen.costEff.toFixed(2)}`);

  return {
    channelId: chosen.entry.channelId,
    modelName: chosen.entry.modelName,
    modelDisplayName: chosen.entry.displayName || chosen.entry.modelName,
    provider: chosen.entry.provider,
    baseUrl: chosen.entry.baseUrl,
    apiKey: chosen.entry.apiKey,
    reasoning: `${explored ? '[探索] ' : ''}融合得分${chosen.finalScore.toFixed(3)}（${reasonParts.join(' · ')}）`,
    alternatives,
    explored,
    strategy: explored ? 'explore' : 'score',
  };
}

// ===== (F) Feedback — Verifier 评分 =====

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function computeFeedbackScore(
  outcome: 'success' | 'partial' | 'failure',
  latencyMs: number,
  estTokens: number,
): number {
  const outcomeScore = outcome === 'success' ? 1.0 : outcome === 'partial' ? 0.5 : 0.0;
  const speedScore = Math.max(0, Math.min(1, 1 - latencyMs / MAX_LATENCY));
  const costScore = Math.max(0, Math.min(1, 1 - estTokens / MAX_TOKENS));
  return 0.6 * outcomeScore + 0.25 * speedScore + 0.15 * costScore;
}

// ===== 回写 Memory =====

export function buildRouterRecord(
  features: TaskFeatures,
  decision: RoutingDecision,
  outcome: 'success' | 'partial' | 'failure',
  latencyMs: number,
  estTokens: number,
): RouterRecord {
  return {
    id: generateId(),
    timestamp: new Date().toISOString(),
    taskFeatures: features,
    channelId: decision.channelId,
    modelName: decision.modelName,
    provider: decision.provider,
    outcome,
    score: computeFeedbackScore(outcome, latencyMs, estTokens),
    latencyMs,
    estTokens,
  };
}

export async function recordRouterFeedback(record: RouterRecord): Promise<void> {
  const { useStore } = await import('../store/useStore');
  useStore.getState().addRouterRecord(record);
}

// ===== 聚合统计（供仪表盘） =====

export function getRouterStats(memory: RouterRecord[]): ModelPerfStats[] {
  const groups = new Map<string, { mKey: string; category: RouterCategory }>();
  for (const r of memory) {
    const mKey = modelKey(r.provider, r.modelName);
    const key = `${mKey}::${r.taskFeatures.category}`;
    if (!groups.has(key)) groups.set(key, { mKey, category: r.taskFeatures.category });
  }
  return Array.from(groups.values()).map((g) => getStats(memory, g.mKey, g.category));
}

// ===== Memory 压缩（保持有界） =====

export function compactMemory(memory: RouterRecord[]): RouterRecord[] {
  if (memory.length <= MEMORY_CAP) return memory;
  // 保留最新 (MEMORY_CAP - COMPACT_BATCH) 条 + 压缩最旧 COMPACT_BATCH 条
  // 压缩后的统计已通过 getStats 体现，这里直接丢弃原始记录
  return memory.slice(COMPACT_BATCH);
}

// ===== 从 Store 触发压缩 =====
export async function maybeCompactRouterMemory(): Promise<void> {
  const { useStore } = await import('../store/useStore');
  const store = useStore.getState();
  if (store.routerMemory.length > MEMORY_CAP) {
    store.setRouterMemory(compactMemory(store.routerMemory));
  }
}
