/**
 * Multi-Trajectory Rollout — Skill-MAS 论文 Phase 4
 *
 * 为复杂需求生成多个候选编排方案（通过温度变化 + 策略扰动产生有意义的差异），
 * 再用 LLM 快速评估各方案质量，选出最优方案。
 *
 * 设计取舍：评估阶段不实际执行各方案（避免多次真实调用/创建工作流），
 * 仅用 LLM 预判"完整性 / 合理性 / 贴合需求 / 是否过度设计"。
 */

import type { MetaSkill, OrchestrationPlan } from '../types';
import { getAvailableChannelFromStore, routedChatLLM } from '../api/llmApi';
import { metaAgentOrchestrate } from '../components/chat/intent/MetaAgent';
import { varyMetaSkill } from './metaSkill';
import { extractTaskFeatures } from './modelRouter';

// 各 rollout 采样温度（制造多样性）
const ROLLOUT_TEMPERATURES = [0.4, 0.7, 0.9];

// ===== 生成多个候选编排方案 =====
export async function rolloutMultiplePlans(
  userInput: string,
  metaSkill: MetaSkill,
  experienceContext: string = '',
  numRollouts: number = 3,
): Promise<OrchestrationPlan[]> {
  const plans: OrchestrationPlan[] = [];

  for (let i = 0; i < numRollouts; i++) {
    try {
      const skill = varyMetaSkill(metaSkill, i);
      const plan = await metaAgentOrchestrate(userInput, skill, {
        experienceContext,
        temperature: ROLLOUT_TEMPERATURES[i % ROLLOUT_TEMPERATURES.length],
      });
      plans.push(plan);
    } catch (error) {
      console.error(`[Rollout] plan ${i + 1} failed:`, error);
    }
  }

  return plans;
}

// ===== 解析 LLM 评分输出 =====
function parseScores(raw: string, count: number): number[] {
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
      if (Array.isArray(p.scores)) {
        const scores = p.scores.slice(0, count).map((s: any) => Number(s) || 0);
        while (scores.length < count) scores.push(0);
        return scores;
      }
    } catch {
      // 解析失败，走兜底
    }
  }

  // 兜底：无法解析时给默认分（首方案略高）
  return Array.from({ length: count }, (_, i) => 10 - i * 1.5);
}

// ===== 评估各方案质量，返回得分与最优索引 =====
export async function evaluatePlansQuality(
  plans: OrchestrationPlan[],
  userInput: string,
): Promise<{ scores: number[]; bestIndex: number }> {
  if (plans.length === 0) return { scores: [], bestIndex: -1 };
  if (plans.length === 1) return { scores: [10], bestIndex: 0 };

  const channelInfo = await getAvailableChannelFromStore();
  if (!channelInfo) {
    // 无 LLM：默认取第一个
    return { scores: plans.map((_, i) => 10 - i), bestIndex: 0 };
  }

  const candidates = plans.map((p, i) => {
    const agentInfo = p.agents.length > 0
      ? p.agents.map(a => `${a.name}(${a.model})`).join('、')
      : '无';
    const wfInfo = p.workflow
      ? `${p.workflow.name}: ${p.workflow.nodes.map(n => n.name).join('→')}`
      : '无';
    return `方案${i + 1}：
  推理: ${p.reasoning.slice(0, 120) || '（无）'}
  Agent: ${agentInfo}
  工作流: ${wfInfo}`;
  }).join('\n\n');

  const prompt = `用户需求：${userInput}

以下是 ${plans.length} 个候选编排方案。请为每个方案打分（0-10），评估维度：
- 完整性（是否覆盖用户需求）
- 合理性（Agent/工具/拓扑是否恰当）
- 贴合度（是否理解用户真实意图）
- 简洁性（是否过度设计）

${candidates}

请只输出 JSON：{"scores": [编号对应分数...], "bestIndex": 最优方案序号(从1开始)}`;

  try {
    const result = await routedChatLLM({
      messages: [
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      maxTokens: 600,
    }, extractTaskFeatures(userInput, { intent: 'plan_evaluation' }));

    if (result.success && result.content) {
      const scores = parseScores(result.content, plans.length);
      const bestIndex = scores.indexOf(Math.max(...scores));
      return { scores, bestIndex };
    }
  } catch (error) {
    console.error('[Rollout] evaluation failed:', error);
  }

  return { scores: plans.map((_, i) => 10 - i), bestIndex: 0 };
}
