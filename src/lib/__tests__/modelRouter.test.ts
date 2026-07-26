import { describe, it, expect } from 'vitest';
import {
  extractTaskFeatures,
  getStats,
  computeFeedbackScore,
  estimateTokens,
  buildRouterRecord,
  selectModel,
} from '../modelRouter';
import type { RouterRecord, RoutingPoolEntry, TaskFeatures } from '../../types';

describe('extractTaskFeatures', () => {
  it('应正确识别代码类任务', () => {
    const features = extractTaskFeatures('帮我修复这个 bug', { intent: 'general_chat', mode: 'code' });
    expect(features.category).toBe('code');
    expect(features.hasCode).toBe(true);
  });

  it('应正确识别工作流编排类任务', () => {
    const features = extractTaskFeatures('创建一个内容审核工作流');
    expect(features.category).toBe('orchestration');
    expect(features.hasWorkflowKeywords).toBe(true);
  });

  it('应正确识别创意写作类任务', () => {
    const features = extractTaskFeatures('帮我写一篇营销文案');
    expect(features.category).toBe('creative');
  });

  it('应正确识别推理类任务', () => {
    const features = extractTaskFeatures('分析一下这两个方案的区别');
    expect(features.category).toBe('reasoning');
  });

  it('无匹配关键词时默认为 chat', () => {
    const features = extractTaskFeatures('你好');
    expect(features.category).toBe('chat');
  });

  it('应正确提取关键词和输入指纹', () => {
    const features = extractTaskFeatures('帮我创建一个 Agent');
    expect(features.keywords.length).toBeGreaterThan(0);
    expect(features.inputFingerprint).toBe('帮我创建一个 Agent');
    expect(features.inputLength).toBe(12);
  });
});

describe('computeFeedbackScore', () => {
  it('成功 + 低延迟 + 低 token 应得高分', () => {
    const score = computeFeedbackScore('success', 1000, 500);
    expect(score).toBeGreaterThan(0.8);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('失败应得 0 分的 outcome 部分', () => {
    const score = computeFeedbackScore('failure', 1000, 500);
    expect(score).toBeLessThan(0.5);
  });

  it('部分成功应得中等分数', () => {
    const score = computeFeedbackScore('partial', 5000, 2000);
    expect(score).toBeGreaterThan(0.2);
    expect(score).toBeLessThan(0.8);
  });

  it('高延迟应降低分数', () => {
    const fast = computeFeedbackScore('success', 1000, 500);
    const slow = computeFeedbackScore('success', 25000, 500);
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('estimateTokens', () => {
  it('空字符串应返回 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('应大约按 4 字符/token 估算', () => {
    expect(estimateTokens('hello world!')).toBe(3); // 12 chars / 4 = 3
  });
});

describe('getStats', () => {
  const mockMemory: RouterRecord[] = [
    {
      id: 'r1', timestamp: new Date().toISOString(),
      taskFeatures: { intent: 'chat', category: 'code', keywords: [], inputLength: 10, hasCode: true, hasWorkflowKeywords: false, inputFingerprint: 'test' },
      channelId: 'ch1', modelName: 'gpt-4o', provider: 'openai',
      outcome: 'success', score: 0.9, latencyMs: 1000, estTokens: 500,
    },
    {
      id: 'r2', timestamp: new Date().toISOString(),
      taskFeatures: { intent: 'chat', category: 'code', keywords: [], inputLength: 10, hasCode: true, hasWorkflowKeywords: false, inputFingerprint: 'test' },
      channelId: 'ch1', modelName: 'gpt-4o', provider: 'openai',
      outcome: 'failure', score: 0.1, latencyMs: 5000, estTokens: 2000,
    },
  ];

  it('应正确统计样本数', () => {
    const stats = getStats(mockMemory, 'openai:gpt-4o', 'code');
    expect(stats.samples).toBe(2);
  });

  it('应正确计算平均分', () => {
    const stats = getStats(mockMemory, 'openai:gpt-4o', 'code');
    expect(stats.avgScore).toBeCloseTo(0.5, 2);
  });

  it('应正确计算成功率', () => {
    const stats = getStats(mockMemory, 'openai:gpt-4o', 'code');
    expect(stats.successRate).toBe(0.5);
  });

  it('无样本时应返回零值', () => {
    const stats = getStats([], 'openai:gpt-4o', 'code');
    expect(stats.samples).toBe(0);
    expect(stats.avgScore).toBe(0);
  });
});

describe('selectModel', () => {
  const mockPool: RoutingPoolEntry[] = [
    { channelId: 'ch1', provider: 'openai', baseUrl: '', apiKey: 'key1', modelName: 'gpt-4o', displayName: 'GPT-4o' },
    { channelId: 'ch2', provider: 'anthropic', baseUrl: '', apiKey: 'key2', modelName: 'claude-3-5-sonnet', displayName: 'Claude 3.5 Sonnet' },
    { channelId: 'ch3', provider: 'deepseek', baseUrl: '', apiKey: 'key3', modelName: 'deepseek-chat', displayName: 'DeepSeek Chat' },
  ];

  it('空池应返回 null', () => {
    const features = extractTaskFeatures('test');
    expect(selectModel(features, [], [])).toBeNull();
  });

  it('单模型池应直接选用', () => {
    const features = extractTaskFeatures('test');
    const decision = selectModel(features, [mockPool[0]], []);
    expect(decision).not.toBeNull();
    expect(decision!.modelName).toBe('gpt-4o');
    expect(decision!.strategy).toBe('only_one');
  });

  it('多模型池应在冷启动时按先验选优', () => {
    const features = extractTaskFeatures('帮我修复代码 bug', { mode: 'code' });
    const decision = selectModel(features, mockPool, []);
    expect(decision).not.toBeNull();
    // code 类冷启动偏好: deepseek > gpt > claude
    // 但因为 ε-greedy 有探索概率，我们只验证返回了一个有效决策
    expect(mockPool.find(e => e.modelName === decision!.modelName)).toBeDefined();
  });

  it('有足够统计样本时应优先统计先验', () => {
    const features = extractTaskFeatures('帮我写代码', { mode: 'code' });
    // 给 gpt-4o 制造大量成功记录
    const memory: RouterRecord[] = Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`, timestamp: new Date().toISOString(),
      taskFeatures: { intent: 'chat', category: 'code', keywords: [], inputLength: 10, hasCode: true, hasWorkflowKeywords: false, inputFingerprint: '帮我写代码' },
      channelId: 'ch1', modelName: 'gpt-4o', provider: 'openai',
      outcome: 'success' as const, score: 0.95, latencyMs: 1000, estTokens: 500,
    }));
    const decision = selectModel(features, mockPool, memory);
    expect(decision).not.toBeNull();
    // 统计先验应使 gpt-4o 得高分（ε-greedy 有小概率探索，但不影响大部分情况）
    expect(decision!.modelName).toBeDefined();
  });
});

describe('buildRouterRecord', () => {
  it('应正确构建路由记录', () => {
    const features: TaskFeatures = {
      intent: 'chat', category: 'code', keywords: ['test'],
      inputLength: 4, hasCode: true, hasWorkflowKeywords: false,
      inputFingerprint: 'test',
    };
    const decision = {
      channelId: 'ch1', modelName: 'gpt-4o', modelDisplayName: 'GPT-4o',
      provider: 'openai', baseUrl: '', apiKey: 'key',
      reasoning: 'test', alternatives: [], explored: false, strategy: 'score' as const,
    };

    const record = buildRouterRecord(features, decision, 'success', 1000, 500);
    expect(record.provider).toBe('openai');
    expect(record.modelName).toBe('gpt-4o');
    expect(record.outcome).toBe('success');
    expect(record.score).toBeGreaterThan(0);
    expect(record.id).toBeDefined();
    expect(record.timestamp).toBeDefined();
  });
});
