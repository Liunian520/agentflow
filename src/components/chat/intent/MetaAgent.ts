/**
 * Meta-Agent 编排器 — Skill-MAS 论文核心实现
 * 
 * 架构：双层路由
 * - 快速层：IntentParser 关键词匹配（高置信度 >= 0.7 时直接执行）
 * - 深度层：LLM Meta-Agent（低置信度 < 0.7 或复杂需求时调用）
 * 
 * Meta-Agent 使用三层 Meta-Skill 文档引导 LLM 生成结构化编排计划
 */

import type {
  ParsedIntent, OrchestrationPlan, MetaSkill,
  PlannedAgent, PlannedWorkflow,
  IntentAction, NodeType, ActionResult,
} from '../../../types';
import { getAvailableChannelFromStore, routedChatLLM } from '../../../api/llmApi';
import { extractTaskFeatures } from '../../../lib/modelRouter';
import { buildMetaAgentSystemPrompt, INITIAL_META_SKILL } from '../../../lib/metaSkill';
import { generateId } from '../../../lib/utils';

// ===== 置信度阈值 =====
// IntentParser 置信度 >= 此值时走快速层，低于此值走 Meta-Agent
const META_AGENT_THRESHOLD = 0.7;

// ===== 双层路由决策 =====
export function shouldUseMetaAgent(intent: ParsedIntent): boolean {
  // general_chat 永远走 handleLLMStream 流式对话（即便置信度低），
  // 让 LLM 自行决定是否调用工具，避免低置信度闲聊被误派到 MetaAgent
  if (intent.action === 'general_chat') return false;

  // 低置信度 → Meta-Agent
  if (intent.confidence < META_AGENT_THRESHOLD) return true;

  // 有追问提示（置信度不够明确，且非纯对话）→ Meta-Agent
  if (intent.clarification) return true;

  // 其余高置信度意图走 IntentParser 快速层
  return false;
}

// ===== Meta-Agent 核心编排调用 =====
export interface MetaAgentOptions {
  experienceContext?: string;  // 注入的相关历史经验（Phase 2）
  recalledMemoryContext?: string; // Phase 10: Dynamic Recall 召回的跨会话记忆
  sessionMemoryContext?: string;  // Phase 10: Session Memory 会话工作记忆
  temperature?: number;       // 采样温度（Phase 4 多轨迹用）
}

export async function metaAgentOrchestrate(
  userInput: string,
  metaSkill: MetaSkill = INITIAL_META_SKILL,
  options: MetaAgentOptions = {},
): Promise<OrchestrationPlan> {

  const channelInfo = await getAvailableChannelFromStore();

  if (!channelInfo) {
    // 无可用 LLM 渠道，降级为模板回复；同时读取 store 给出更精确的诊断
    const { useStore } = await import('../../../store/useStore');
    const channels = useStore.getState().channels || [];
    let reason: FallbackReason = 'none';
    if (channels.length > 0) {
      const anyEnabled = channels.some((c) => c.enabled);
      reason = anyEnabled ? 'no_key' : 'disabled';
    }
    return createFallbackPlan(reason);
  }

  // 构建系统提示词（注入 Meta-Skill 三层策略 + Session Memory 固定前缀）
  const sessionPrefix = options.sessionMemoryContext ? `${options.sessionMemoryContext}\n\n` : '';
  const systemPrompt = `${sessionPrefix}${buildMetaAgentSystemPrompt(metaSkill)}`;

  // 构建用户消息（包含当前系统上下文 + 历史经验）
  const { useStore } = await import('../../../store/useStore');
  const store = useStore.getState();
  const contextInfo = `
Current system context:
- Number of agents: ${store.agents.length}
- Number of workflows: ${store.workflows.length}
- Available models: ${channelInfo.models.map(m => m.displayName).join(', ')}
- Available node types: start, end, llm, agent, code, http, condition, loop, variable, database, host, knowledge, template, human_in_loop, subworkflow, subagent, a2a
- 当任务需要多个角色协作且可并行时，优先使用 subagent 节点（并行 Agent 团队），其 config 形如：{ "agents": [{"id":"sub-1","name":"研究员","model":"GPT-4o","systemPrompt":"...","tools":[]}], "aggregatorPrompt":"整合为最终交付物", "outputVariable":"subagent_result", "parallel": true }
- 当任务需要调用外部 Agent（其他系统提供的 A2A Agent，跨平台互操作）时，使用 a2a 节点，其 config 形如：{ "agentUrl":"https://external-agent.example.com", "message":"请分析以下内容：{{input}}", "streaming":true, "outputVariable":"a2a_result" }

User request: ${userInput}${options.experienceContext ? '\n' + options.experienceContext : ''}${options.recalledMemoryContext ? '\n' + options.recalledMemoryContext : ''}${options.sessionMemoryContext ? '\n' + options.sessionMemoryContext : ''}`;

  // ACRouter 路由：自动选最优模型（C-A-F 闭环）
  const taskFeatures = extractTaskFeatures(userInput, { intent: 'smart_orchestrate' });
  try {
    const result = await routedChatLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: contextInfo },
      ],
      temperature: options.temperature ?? 0.5, // 较低温度确保结构化输出稳定
      maxTokens: 2048,
    }, taskFeatures);

    if (result.success && result.content) {
      return parseOrchestrationPlan(result.content);
    }

    // LLM 返回失败
    return createFallbackPlan();
  } catch (error) {
    console.error('[MetaAgent] LLM call failed:', error);
    return createFallbackPlan();
  }
}

// ===== 解析 LLM 输出的编排计划 =====
function parseOrchestrationPlan(llmOutput: string): OrchestrationPlan {
  // 尝试从 LLM 输出中提取 JSON
  let jsonStr: string | null = null;

  // 方法1：直接解析整个输出
  try {
    JSON.parse(llmOutput);
    jsonStr = llmOutput;
  } catch {
    // 方法2：提取 ```json ... ``` 包裹的内容
    const jsonMatch = llmOutput.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    } else {
      // 方法3：找到第一个 { 到最后一个 } 之间的内容
      const firstBrace = llmOutput.indexOf('{');
      const lastBrace = llmOutput.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        jsonStr = llmOutput.slice(firstBrace, lastBrace + 1);
      }
    }
  }

  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);

      // 验证并规范化结构
      return normalizePlan(parsed);
    } catch {
      // JSON 解析失败，降级为文本回复
    }
  }

  // 无法解析为 JSON，创建纯对话计划
  return {
    intent: 'general_chat',
    confidence: 0.5,
    subTasks: [],
    agents: [],
    workflow: null,
    clarifications: [],
    reasoning: llmOutput,
    source: 'meta_agent',
  };
}

// ===== 规范化编排计划结构 =====
function normalizePlan(raw: any): OrchestrationPlan {
  // 确保 intent 是合法的 IntentAction
  const validActions: IntentAction[] = [
    'create_agent', 'update_agent', 'delete_agent', 'list_agents',
    'create_workflow', 'update_workflow', 'delete_workflow', 'list_workflows',
    'add_node', 'connect_nodes', 'configure_node', 'run_workflow',
    'ssh_command', 'query_status', 'general_chat', 'unknown',
  ];

  const intent: IntentAction = validActions.includes(raw.intent)
    ? raw.intent
    : 'smart_orchestrate';

  // 规范化 agents
  const agents: PlannedAgent[] = (raw.agents || []).map((a: any) => ({
    name: a.name || 'AI助手',
    description: a.description || '',
    model: a.model || 'GPT-4o',
    systemPrompt: a.systemPrompt || '你是一个专业的AI助手。',
    tools: (a.tools || []).filter((t: any) => typeof t === 'string'),
    temperature: typeof a.temperature === 'number' ? a.temperature : 0.7,
    avatar: a.avatar || '🤖',
  }));

  // 规范化 workflow
  let workflow: PlannedWorkflow | null = null;
  if (raw.workflow && raw.workflow.nodes && raw.workflow.nodes.length > 0) {
    const validNodeTypes: NodeType[] = [
      'start', 'end', 'llm', 'agent', 'code', 'http',
      'condition', 'loop', 'variable', 'database', 'host',
      'knowledge', 'template', 'human_in_loop', 'subworkflow', 'subagent', 'a2a',
    ];

    workflow = {
      name: raw.workflow.name || '新工作流',
      description: raw.workflow.description || '',
      nodes: raw.workflow.nodes.map((n: any) => ({
        type: validNodeTypes.includes(n.type) ? n.type : 'llm',
        name: n.name || n.type,
        description: n.description || '',
        config: n.config || undefined,
      })),
      edges: (raw.workflow.edges || []).map((e: any) => ({
        sourceIndex: typeof e.sourceIndex === 'number' ? e.sourceIndex : 0,
        targetIndex: typeof e.targetIndex === 'number' ? e.targetIndex : 1,
        label: e.label || undefined,
      })),
    };

    // 确保 workflow 以 start 开始，以 end 结束
    if (workflow.nodes[0]?.type !== 'start') {
      workflow.nodes.unshift({ type: 'start', name: '开始', description: '工作流入口' });
      // 修正 edges 的索引偏移
      workflow.edges = workflow.edges.map(e => ({
        ...e,
        sourceIndex: e.sourceIndex + 1,
        targetIndex: e.targetIndex + 1,
      }));
    }
    if (workflow.nodes[workflow.nodes.length - 1]?.type !== 'end') {
      workflow.nodes.push({ type: 'end', name: '结束', description: '工作流出口' });
    }

    // 自动补全缺失的连线（线性连接相邻节点）
    if (workflow.edges.length === 0 && workflow.nodes.length > 1) {
      for (let i = 0; i < workflow.nodes.length - 1; i++) {
        workflow.edges.push({
          sourceIndex: i,
          targetIndex: i + 1,
        });
      }
    }
  }

  // 规范化 subTasks
  const subTasks = (raw.subTasks || []).map((t: any) => ({
    id: t.id || generateId(),
    action: validActions.includes(t.action) ? t.action : 'general_chat',
    params: t.params || {},
    status: 'pending' as const,
  }));

  return {
    intent,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.8,
    subTasks,
    agents,
    workflow,
    clarifications: (raw.clarifications || []).filter((c: any) => typeof c === 'string'),
    reasoning: raw.reasoning || '',
    source: 'meta_agent',
  };
}

// ===== 无 LLM 渠道时的降级方案 =====
type FallbackReason = 'none' | 'disabled' | 'no_key';
function createFallbackPlan(reason: FallbackReason = 'none'): OrchestrationPlan {
  let reasoning: string;
  if (reason === 'disabled') {
    reasoning = `⚠️ 已检测到 LLM 渠道，但全部处于禁用状态，Meta-Agent 无法进行智能编排。\n\n请在「渠道设置」中找到对应渠道，打开「启用渠道」开关后再试。`;
  } else if (reason === 'no_key') {
    reasoning = `⚠️ 已检测到启用的 LLM 渠道，但缺少 API Key，Meta-Agent 无法进行智能编排。\n\n请在「渠道设置」中编辑该渠道，填写 API Key 并保存后再试。`;
  } else {
    reasoning = `⚠️ 当前未配置 LLM 渠道，Meta-Agent 无法进行智能编排。\n\n请在「渠道设置」中添加并启用一个渠道（填写 API Key、选择模型、打开启用开关）。\n\n目前你仍可使用关键词命令（如"创建Agent"、"查看列表"）进行基本操作。`;
  }
  return {
    intent: 'general_chat',
    confidence: 0.3,
    subTasks: [],
    agents: [],
    workflow: null,
    clarifications: [],
    reasoning,
    source: 'meta_agent',
  };
}

// ===== 执行编排计划（将 PlannedAgent/PlannedWorkflow 落地到 Store） =====
export async function executeOrchestrationPlan(
  plan: OrchestrationPlan,
  onProgress?: (progress: { currentIndex: number; total: number; currentAction: string }) => void
): Promise<ActionResult[]> {
  const { useStore } = await import('../../../store/useStore');
  const store = useStore.getState();
  const results: ActionResult[] = [];
  const totalSteps = plan.agents.length + (plan.workflow ? 1 : 0);
  let currentIndex = 0;

  // 1. 创建 PlannedAgent
  for (const plannedAgent of plan.agents) {
    onProgress?.({ currentIndex, total: totalSteps, currentAction: `创建 Agent: ${plannedAgent.name}` });
    try {
      await store.createAgent({
        name: plannedAgent.name,
        description: plannedAgent.description,
        model: plannedAgent.model,
        systemPrompt: plannedAgent.systemPrompt,
        tools: plannedAgent.tools,
        temperature: plannedAgent.temperature,
        avatar: plannedAgent.avatar,
      });

      const newAgent = useStore.getState().agents[useStore.getState().agents.length - 1];
      // 自动注册到 Runtime Registry
      const { getAgentRuntimeRegistry } = await import('../../../lib/agentRuntime');
      const registry = getAgentRuntimeRegistry();
      const capabilities = [...(plannedAgent.tools || [])];
      if (plannedAgent.description) {
        const desc = plannedAgent.description.toLowerCase();
        if (desc.includes('代码') || desc.includes('code')) capabilities.push('code');
        if (desc.includes('写') || desc.includes('write')) capabilities.push('writing');
        if (desc.includes('分析') || desc.includes('analyze')) capabilities.push('reasoning');
      }
      registry.register(newAgent.id, capabilities);
      results.push({
        success: true,
        type: 'agent_created',
        data: { agentId: newAgent.id, agent: newAgent },
      });
      currentIndex++;
    } catch (error: any) {
      results.push({
        success: false,
        type: 'agent_created',
        error: error.message,
      });
    }
  }

  // 2. 创建 PlannedWorkflow
  if (plan.workflow) {
    onProgress?.({ currentIndex, total: totalSteps, currentAction: `创建工作流: ${plan.workflow.name}` });
    try {
      const wfId = await store.createWorkflow(plan.workflow.name);
      const templates = store.nodeTemplates;

      const createdNodeIds: string[] = [];
      for (const plannedNode of plan.workflow.nodes) {
        const template = templates.find((t: any) => t.type === plannedNode.type);
        if (template) {
          const nodeId = `node-${generateId()}`;
          const newNode = {
            id: nodeId,
            type: template.type,
            name: plannedNode.name || template.name,
            description: plannedNode.description || template.description,
            icon: template.icon,
            color: template.color,
            category: template.category,
            defaultData: template.defaultData ? { ...template.defaultData } : undefined,
          };

          // 如果 PlannedNode 有 config，合并进 defaultData
          if (plannedNode.config) {
            newNode.defaultData = { ...newNode.defaultData, ...plannedNode.config };
          }

          await store.updateWorkflow(wfId, {
            nodes: [
              ...(useStore.getState().workflows.find((w: any) => w.id === wfId)?.nodes || []),
              newNode,
            ],
          });
          createdNodeIds.push(nodeId);
        }
      }

      // 创建连线
      for (const plannedEdge of plan.workflow.edges) {
        if (
          plannedEdge.sourceIndex < createdNodeIds.length &&
          plannedEdge.targetIndex < createdNodeIds.length
        ) {
          store.addWorkflowEdge(wfId, {
            id: `edge-${generateId()}`,
            source: createdNodeIds[plannedEdge.sourceIndex],
            target: createdNodeIds[plannedEdge.targetIndex],
            label: plannedEdge.label,
          });
        }
      }

      const newWorkflow = useStore.getState().workflows.find((w: any) => w.id === wfId);
      results.push({
        success: true,
        type: 'workflow_created',
        data: { workflowId: wfId, workflow: newWorkflow },
      });
    } catch (error: any) {
      results.push({
        success: false,
        type: 'workflow_created',
        error: error.message,
      });
    }
  }

  // 3. 处理简单查询类意图（不创建对象）
  if (plan.intent === 'list_agents') {
    results.push({
      success: true,
      type: 'agents_listed',
      data: { agents: store.agents },
    });
  } else if (plan.intent === 'list_workflows') {
    results.push({
      success: true,
      type: 'workflows_listed',
      data: { workflows: store.workflows },
    });
  } else if (plan.intent === 'query_status') {
    results.push({
      success: true,
      type: 'status_queried',
      data: {
        executionState: store.executionState,
        agents: store.agents.length,
        workflows: store.workflows.length,
      },
    });
  }

  return results;
}

/**
 * 自动编排检测：根据用户输入和当前系统状态，判断是否需要自动触发多 Agent 编排
 *
 * 触发条件（满足任一）：
 * 1. 任务涉及多个不同领域（如"分析代码并写报告"）
 * 2. 任务复杂度高（输入长度 > 200 字）
 * 3. 已有 Agent 中没有匹配能力的（需要创建新 Agent）
 * 4. 用户明确要求多角色协作
 */
export function shouldAutoOrchestrate(
  userInput: string,
  existingAgents: Array<{ capabilities: string[]; name: string }>,
): { shouldOrchestrate: boolean; reason: string; requiredCapabilities: string[] } {
  const input = userInput.toLowerCase();
  const requiredCapabilities: string[] = [];

  const domainKeywords: Record<string, string[]> = {
    code: ['代码', '编程', 'bug', '函数', 'debug', 'code', '程序', '脚本', 'api'],
    writing: ['写', '文案', '报告', '文章', '摘要', '翻译', 'write', 'draft'],
    reasoning: ['分析', '推理', '诊断', '评估', '比较', 'analyze', 'reason'],
    search: ['搜索', '查找', '调研', '检索', 'search', 'find', 'research'],
    data: ['数据', '统计', '图表', '数据库', 'data', 'query', 'sql'],
  };

  for (const [cap, keywords] of Object.entries(domainKeywords)) {
    if (keywords.some((kw) => input.includes(kw))) {
      requiredCapabilities.push(cap);
    }
  }

  if (requiredCapabilities.length >= 2) {
    return {
      shouldOrchestrate: true,
      reason: `任务涉及 ${requiredCapabilities.length} 个领域：${requiredCapabilities.join(', ')}`,
      requiredCapabilities,
    };
  }

  // 长文本触发编排的前提是包含至少一个领域关键词，避免纯闲聊（如长篇吐槽）被误编排
  if (userInput.length > 200 && requiredCapabilities.length > 0) {
    return {
      shouldOrchestrate: true,
      reason: '任务描述较长且涉及具体领域，可能需要多步骤协作',
      requiredCapabilities,
    };
  }

  if (requiredCapabilities.length === 1) {
    // 仅当已有 agent 且都缺该能力时才编排；全新项目（无任何 agent）时
    // 让用户走 IntentParser 快速层直接创建，避免过度编排阻断首次引导卡片
    if (existingAgents.length > 0) {
      const hasCapableAgent = existingAgents.some((a) =>
        requiredCapabilities.every((cap) => a.capabilities.includes(cap)),
      );
      if (!hasCapableAgent) {
        return {
          shouldOrchestrate: true,
          reason: `没有具备 ${requiredCapabilities.join(', ')} 能力的 Agent，需要创建`,
          requiredCapabilities,
        };
      }
    }
  }

  const collabKeywords = ['多个agent', '多agent', '协作', '并行', '团队', '分工', '协同'];
  if (collabKeywords.some((kw) => input.includes(kw))) {
    return {
      shouldOrchestrate: true,
      reason: '用户要求多角色协作',
      requiredCapabilities,
    };
  }

  return {
    shouldOrchestrate: false,
    reason: '',
    requiredCapabilities,
  };
}
