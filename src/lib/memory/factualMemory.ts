/**
 * L1 Factual Memory — 跨会话事实记忆 CRUD + 检索 + 去重 + 容量管理
 *
 * 参考：Claude Code Auto Memory Extraction（4 类分类法 + frontmatter 扫描）
 * 降级兜底：关键词规则提取（"不要/应该"→feedback，"项目/使用"→project）
 */

import type { FactualMemory, FactualMemoryType } from '../../types';
import {
  L1_MAX_ENTRIES,
  L1_MAX_SIZE_BYTES,
} from './types';

// ===== 关键词规则降级提取 =====

/** 规则化关键词 → 记忆类型映射 */
const KEYWORD_TYPE_MAP: Record<string, FactualMemoryType> = {
  // feedback 类：用户偏好、纠正、否定
  '不要': 'feedback',
  '别用': 'feedback',
  '应该': 'feedback',
  '不喜欢': 'feedback',
  '更喜欢': 'feedback',
  '避免': 'feedback',
  '务必': 'feedback',
  'never': 'feedback',
  'always': 'feedback',
  'avoid': 'feedback',
  'prefer': 'feedback',
  'preferably': 'feedback',

  // project 类：项目技术栈、约定、架构
  '项目': 'project',
  '框架': 'project',
  '技术栈': 'project',
  '使用': 'project',
  '约定': 'project',
  '架构': 'project',
  'project': 'project',
  'framework': 'project',
  'tech stack': 'project',
  'convention': 'project',
  'architecture': 'project',

  // user 类：用户个人信息、团队背景
  '团队': 'user',
  '偏好': 'user',
  '我叫': 'user',
  '我们是': 'user',
  '我的': 'user',
  'team': 'user',
  'my name': 'user',
  'we are': 'user',

  // reference 类：外部链接、文档参考
  '文档': 'reference',
  '链接': 'reference',
  '参考': 'reference',
  'doc': 'reference',
  'link': 'reference',
  'reference': 'reference',
};

/** 从文本中提取关键词集合（中文字+2字组合，英文单词） */
export function extractKeywords(text: string): string[] {
  const keywords: string[] = [];

  // 英文单词
  const englishWords = text.match(/[a-zA-Z]{2,}/g) || [];
  keywords.push(...englishWords.map(w => w.toLowerCase()));

  // 中文2字组合
  const chineseChars = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const segment of chineseChars) {
    for (let i = 0; i < segment.length - 1; i++) {
      keywords.push(segment.substring(i, i + 2));
    }
    // 单字也加入（用于短匹配）
    for (const ch of segment) {
      keywords.push(ch);
    }
  }

  return keywords;
}

/** 规则化推断记忆类型（降级兜底，当 LLM 不可用时使用） */
export function inferMemoryType(text: string): FactualMemoryType {
  let bestType: FactualMemoryType = 'reference';  // 默认
  let bestScore = 0;

  for (const [keyword, type] of Object.entries(KEYWORD_TYPE_MAP)) {
    if (text.toLowerCase().includes(keyword.toLowerCase())) {
      // 关键词越长权重越高
      const score = keyword.length;
      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }
  }

  return bestType;
}

// ===== 去重 =====

/** Jaccard 词集合相似度（复用 experienceBank 的思路） */
export function computeJaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** 检查新记忆是否与已有记忆重复（Jaccard ≥ 0.7 视为重复） */
export function isDuplicate(
  _newContent: string,
  newKeywords: string[],
  existingMemories: FactualMemory[],
  threshold = 0.7
): boolean {
  for (const existing of existingMemories) {
    const similarity = computeJaccardSimilarity(newKeywords, existing.keywords);
    if (similarity >= threshold) return true;
  }
  return false;
}

// ===== 容量管理 =====

/** 估算单条 FactualMemory 的字节大小 */
export function estimateFactualMemorySize(memory: FactualMemory): number {
  return JSON.stringify(memory).length;
}

/** 检查 L1 是否超出容量上限，需要修剪 */
export function needsCapacityTrim(memories: FactualMemory[]): boolean {
  if (memories.length > L1_MAX_ENTRIES) return true;
  const totalBytes = memories.reduce((sum, m) => sum + estimateFactualMemorySize(m), 0);
  if (totalBytes > L1_MAX_SIZE_BYTES) return true;
  return false;
}

/** 修剪 L1 容量：按 importance × recency 排序，删除最低 10% */
export function trimFactualMemoryCapacity(memories: FactualMemory[]): FactualMemory[] {
  if (!needsCapacityTrim(memories)) return memories;

  // recency = 距今天数越小越新（最大 365 天做归一化）
  const now = Date.now();
  const scored = memories.map((m) => {
    const ageDays = m.lastAccessedAt
      ? (now - new Date(m.lastAccessedAt).getTime()) / (24 * 60 * 60 * 1000)
      : (now - new Date(m.createdAt).getTime()) / (24 * 60 * 60 * 1000);
    const recency = 1 - Math.min(ageDays / 365, 1);
    const compositeScore = m.importance * 0.6 + recency * 0.4;
    return { memory: m, score: compositeScore };
  });

  // 按综合得分排序，删除最低 10%
  scored.sort((a, b) => b.score - a.score);
  const trimCount = Math.ceil(memories.length * 0.1);
  return scored.slice(0, memories.length - trimCount).map((s) => s.memory);
}

// ===== Frontmatter 扫描（粗筛候选，供 Dynamic Recall 使用） =====

/** 从所有 L1 记忆中按关键词粗筛 top N 候选 */
export function frontmatterScan(
  memories: FactualMemory[],
  query: string,
  topN = 20
): { memory: FactualMemory; score: number }[] {
  const queryKeywords = extractKeywords(query);
  const querySet = new Set(queryKeywords);

  const scored = memories.map((m) => {
    // 关键词命中数
    const memorySet = new Set(m.keywords);
    let keywordHits = 0;
    for (const kw of querySet) {
      if (memorySet.has(kw)) keywordHits++;
    }

    // Jaccard 相似度
    const jaccard = computeJaccardSimilarity(queryKeywords, m.keywords);

    // 综合得分：Jaccard(0.6) + keywordHits 加分(0.4)
    const keywordBonus = keywordHits * 0.05;
    const score = jaccard * 0.6 + Math.min(keywordBonus, 0.4) * 0.4;

    // importance 加权
    return { memory: m, score: score * (0.5 + m.importance * 0.5) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

// ===== 格式化注入（生成注入上下文字符串） =====

/** 将选中的 FactualMemory 格式化为注入上下文 */
export function formatFactualMemoryForInjection(memories: FactualMemory[]): string {
  if (memories.length === 0) return '';

  const lines = memories.map((m) => {
    const typeLabel = {
      user: '👤 用户偏好',
      feedback: '💬 用户反馈',
      project: '📋 项目信息',
      reference: '📖 参考资料',
    }[m.type];
    return `[${typeLabel}] ${m.content}`;
  });

  return `## 跨会话记忆（自动召回）\n${lines.join('\n')}`;
}
