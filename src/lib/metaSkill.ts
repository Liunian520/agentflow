/**
 * Meta-Skill 三层编排策略 — 基于 Skill-MAS 论文方法论
 * 将 Meta-Agent 的编排能力建模为可进化的策略文档
 * 三层结构：Task Decomposition / Agent Engineering / Workflow Orchestration
 */

import type { MetaSkill } from '../types';

// ===== 初始种子策略（v1） =====
// 这些策略是 Meta-Agent 编排的"初始知识"，后续会通过 Selective Reflection 进化

export const INITIAL_META_SKILL: MetaSkill = {
  decomposition: `## Task Decomposition Strategy

1. Identify the core goal from user input:
   - Creation (new agent/workflow/node)
   - Modification (update existing configurations)
   - Query (list/view/status check)
   - Execution (run workflow, SSH command)
   - Complex compound tasks need decomposition into sub-tasks

2. For compound requests, split into independent sub-tasks:
   Example: "Create a copywriter agent with search tool" -> 
   SubTask 1: Create agent (copywriter role)
   SubTask 2: Configure search tool for the agent

3. For ambiguous requests, generate clarification options rather than guessing:
   - If model preference unclear -> suggest top 3 options
   - If tool requirements vague -> ask about specific capabilities needed
   - If workflow topology ambiguous -> offer 2-3 common patterns

4. Prioritize user's stated preferences over defaults:
   - Explicit model choice -> use exactly that model
   - Named tools -> include those tools
   - Described workflow pattern -> follow that pattern`,

  engineering: `## Agent Engineering Strategy

1. Model selection by task type:
   - Creative/writing tasks -> Claude 3.5 Sonnet or GPT-4o (high creativity)
   - Reasoning/analysis tasks -> DeepSeek V3 or GPT-4o (strong logic)
   - Multilingual tasks -> Gemini 1.5 Pro (cross-language)
   - Cost-sensitive tasks -> DeepSeek V3 or GPT-3.5 Turbo (affordable)
   - Default fallback -> GPT-4o (balanced)

2. System prompt generation rules:
   - Start with role definition: "You are a [role] specializing in [domain]"
   - Include behavior boundaries: what to do and what NOT to do
   - Specify output format: structured/markdown/concise/detailed
   - Add quality constraints: accuracy requirements, tone guidelines
   - Keep prompts under 500 chars for efficiency, use references for complex roles

3. Tool selection driven by task need (not stacking):
   - Web search -> for information gathering, fact-checking
   - Code execution -> for computation, data processing, automation
   - SSH/host -> for system operations, DevOps tasks
   - Database -> for data queries, reporting
   - Only add tools the agent actually NEEDS for its role

4. Temperature tuning by task nature:
   - Creative generation -> 0.8-0.9 (diverse outputs)
   - Balanced conversation -> 0.7 (default)
   - Analytical/reasoning -> 0.3-0.5 (focused, deterministic)
   - Code generation -> 0.2 (precise, minimal variation)`,

  orchestration: `## Workflow Orchestration Strategy

1. Simple single-step tasks -> Single agent, no workflow needed:
   - "Translate this text" -> just call the agent directly
   - "Answer a question" -> single LLM call
   Only create workflow when there are genuine multi-step dependencies

2. Linear pipeline for sequential dependencies:
   Pattern: Input -> Process -> Output
   Common patterns:
   - Content creation: Start -> LLM(generate) -> End
   - Data processing: Start -> Code(extract) -> LLM(analyze) -> End
   - Research: Start -> HTTP(fetch) -> LLM(summarize) -> End

3. Conditional branching for decision-making:
   Pattern: Input -> Decision -> [Path A | Path B] -> Merge -> Output
   Common patterns:
   - Review workflow: LLM(analyze) -> Condition(approve/reject) -> [publish|revise]
   - Error handling: Execute -> Condition(success/fail) -> [continue|retry]

4. Parallel execution for independent sub-tasks:
   Pattern: Start -> [Task A + Task B + Task C] -> Merge -> End
   Use when sub-tasks don't depend on each other's outputs
   PREFER the **subagent** node for multi-agent parallel collaboration:
   - It runs multiple sub-agents concurrently via Promise.all
   - Each sub-agent has its own model + systemPrompt + optional inputVariable + tools
   - An optional aggregatorPrompt synthesizes all sub-agent outputs into a final result
   - Example: "research + write + review in parallel" -> one subagent node with 3 sub-agents + aggregator
   - Only fall back to separate parallel agent nodes when sub-agents need distinct downstream wiring

5. Loop/iteration for repetitive processing:
   Pattern: Start -> Loop(iterate over items) -> End
   Use for batch processing, iterative refinement, or data collection

6. Node configuration defaults:
   - LLM nodes: include relevant systemPrompt from context
   - HTTP nodes: set reasonable timeout (10s), add error handling
   - Code nodes: specify language explicitly, add input/output variables
   - Condition nodes: define clear boolean expressions
   - Always include Start and End nodes`,

  version: 1,
  updatedAt: new Date().toISOString(),
};

// ===== Meta-Skill 合并进化方法 =====
// 当 Selective Reflection 提炼出新的策略原则时，合并进现有 Meta-Skill
// 保留三层框架结构，只更新各层的策略内容，并记录进化事件

export function mergeMetaSkillUpdate(
  currentSkill: MetaSkill,
  update: {
    decompositionAdditions?: string[];
    engineeringAdditions?: string[];
    orchestrationAdditions?: string[];
  },
  trigger: string = 'auto-reflection',
  summary: string = '策略已更新',
  basedOnTraces: number = 0,
): MetaSkill {
  const appendSection = (existing: string, additions: string[]): string => {
    if (additions.length === 0) return existing;
    const newRules = additions.map((a, i) => `${i + 1}. ${a}`).join('\n   ');
    return existing + '\n\n' + newRules;
  };

  const newVersion = currentSkill.version + 1;
  const evolution = {
    version: newVersion,
    timestamp: new Date().toISOString(),
    trigger,
    summary,
    changes: {
      decomposition: update.decompositionAdditions || [],
      engineering: update.engineeringAdditions || [],
      orchestration: update.orchestrationAdditions || [],
    },
    basedOnTraces,
  };

  return {
    decomposition: appendSection(currentSkill.decomposition, update.decompositionAdditions || []),
    engineering: appendSection(currentSkill.engineering, update.engineeringAdditions || []),
    orchestration: appendSection(currentSkill.orchestration, update.orchestrationAdditions || []),
    version: newVersion,
    updatedAt: new Date().toISOString(),
    evolutions: [...(currentSkill.evolutions || []), evolution].slice(-20),
  };
}

// ===== 策略扰动（用于 Multi-Trajectory Rollout） =====
// 在不破坏三层框架的前提下，为不同 rollout 注入轻微的策略侧重，
// 使多个候选编排方案产生有意义的差异（而非单纯温度噪声）

const PERTURBATION_HINTS = [
  '本次优先考虑最简方案，能用单 Agent 解决的不要建工作流。',
  '本次可适度丰富工具链，优先保证输出质量而非极简。',
  '本次优先考虑可并行/可复用的结构，倾向多 Agent 协作拆分。',
];

export function varyMetaSkill(skill: MetaSkill, seed: number): MetaSkill {
  const hint = PERTURBATION_HINTS[seed % PERTURBATION_HINTS.length];
  return {
    ...skill,
    orchestration: `${skill.orchestration}\n\n[Rollout 侧重 #${seed + 1}] ${hint}`,
  };
}

// ===== 构建 Meta-Agent 系统提示词 =====
// 将三层 Meta-Skill 注入 LLM 的 system prompt

export function buildMetaAgentSystemPrompt(metaSkill: MetaSkill): string {
  return `You are the Meta-Agent of AgentFlow, an intelligent orchestrator that creates and manages multi-agent systems.

You follow a three-layer orchestration methodology (Skill-MAS):
${metaSkill.decomposition}

${metaSkill.engineering}

${metaSkill.orchestration}

IMPORTANT RULES:
1. Always output structured JSON for orchestration plans (never free-form text)
2. When ambiguous, list clarification questions rather than guessing
3. For simple requests (list, query, status), use simple intent actions
4. For complex requests, generate full OrchestrationPlan with sub-tasks
5. Match user's stated preferences exactly — don't override with defaults
6. Keep agent system prompts concise and role-specific
7. Only create workflows for genuine multi-step dependencies`;
}
