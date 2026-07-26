import { useState, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { generateId } from '../lib/utils';
import type {
  ChatMessage, ParsedIntent, ActionResult, Agent, Workflow as WorkflowType,
  AgentMode, TaskStep, ThinkingStep, ApprovalRequest, SlashCommand,
  OrchestrationPlan,
} from '../types';
import { parseIntent } from '../components/chat/intent/IntentParser';
import { executeAction } from '../components/chat/intent/actionExecutor';
import { shouldUseMetaAgent, metaAgentOrchestrate, executeOrchestrationPlan } from '../components/chat/intent/MetaAgent';
import { recordExecutionTrace, findRelevantExperience, buildExperienceContext } from '../lib/experienceBank';
import { memoryApi } from '../api/memoryApi';
import { runReflection } from '../lib/metaSkillEvolver';
import { rolloutMultiplePlans, evaluatePlansQuality } from '../lib/multiTrajectoryRollout';
import { extractTaskFeatures } from '../lib/modelRouter';
import { designWorkflowFromDescription, modifyWorkflowWithDescription, applyWorkflowModification } from '../lib/llmWorkflowDesigner';
import { getMemoryManager } from '../lib/memory';
import { MEMORY_TOOL_SCHEMAS, executeMemoryTool } from '../lib/memory/selfEditing';
import { BUILTIN_TOOL_SCHEMAS, isBuiltinTool, executeBuiltinTool } from '../lib/builtinTools';
import { trackFeatureUsed } from '../components/chat/FeatureHints';
import { getAgentRuntimeRegistry } from '../lib/agentRuntime';
import { slashCommands } from '../components/chat/SlashCommandBar';
import { generateTaskSteps } from '../components/chat/TaskTracker';
import { generateThinkingSteps } from '../components/chat/ThinkingIndicator';
import { needsApproval } from '../components/chat/ApprovalPrompt';
import { getAvailableChannelFromStore, routedChatLLMStream, pollTask, visionProxy, isModelSupportsVision } from '../api/llmApi';
import type { ContentPart } from '../api/llmApi';
import { RouterDashboard } from '../components/chat/cards/RouterDashboard';

import { useChatSession } from '../hooks/useChatSession';
import { useProjectDir } from '../hooks/useProjectDir';
import { useFileUpload } from '../hooks/useFileUpload';
import { ChatHeader } from '../components/chat/ChatHeader';
import { ChatMessageList } from '../components/chat/ChatMessageList';
import { ChatInputArea } from '../components/chat/ChatInputArea';

// 预置快捷建议
const quickSuggestions = [
  '帮我创建一个文案写手Agent',
  '设计一个内容审核工作流',
  '查看已有的Agent列表',
  '帮我创建一个数据分析助手，用DeepSeek模型',
];

// ===== 模式化响应生成 =====

function generateResponse(intent: ParsedIntent, result: ActionResult, mode: AgentMode): string {
  // Plan 模式：只规划不执行
  if (mode === 'plan') {
    switch (intent.action) {
      case 'create_agent':
        return `## 规划方案：创建 Agent\n\n基于你的描述，我制定了以下方案：\n\n1. **Agent 名称**: ${intent.params.name || '新助手'}\n2. **使用模型**: ${intent.params.model || 'GPT-4o'}\n3. **核心能力**: ${intent.params.description || '专业 AI 助手'}\n4. **工具配置**: ${intent.params.tools?.length > 0 ? intent.params.tools.join(', ') : '基础对话'}\n5. **温度参数**: ${intent.params.temperature || 0.7}\n\n*当前为规划模式，不会执行创建操作。切换到编码模式后可落地。*`;
      case 'create_workflow':
        return `## 规划方案：创建工作流\n\n建议的流程架构：\n\n${intent.params.nodeSequence?.map((n: any, i: number) => `${i + 1}. **${n.label}** (${n.type})`).join('\n') || '1. **开始** → 2. **LLM 调用** → 3. **结束**'}\n\n*当前为规划模式，不会执行创建操作。切换到编码模式后可落地。*`;
      default:
        return `## 规划方案\n\n我分析了你的需求，以下是建议的执行步骤：\n\n1. **理解需求**：明确目标和约束条件\n2. **制定方案**：选择合适的模型和工具\n3. **执行实施**：在编码模式下落地执行\n\n*当前为规划模式，仅提供方案建议。切换到编码模式后可实际执行。*`;
    }
  }

  // Debug 模式：侧重诊断
  if (mode === 'debug') {
    return result.success
      ? `## 诊断完成\n\n问题已定位并处理：\n- **操作**: ${intent.action}\n- **结果**: 成功\n\n建议检查相关配置确保问题不再出现。`
      : `## 诊断结果\n\n未能自动修复：${result.error || '未知问题'}\n\n建议手动检查配置，或切换到编码模式进行修复。`;
  }

  // Orchestrator 模式：侧重协调
  if (mode === 'orchestrator') {
    if (result.success) {
      return `## 任务协调完成\n\n已分解并协调执行：\n- **主任务**: ${intent.action}\n- **执行结果**: 成功\n\n各子任务已同步完成。`;
    }
    return `协调执行遇到问题：${result.error || '部分子任务失败'}。`;
  }

  // Code 模式（默认）
  switch (intent.action) {
    case 'create_agent':
      if (result.success) {
        const agent = result.data?.agent as Agent;
        return `已为你创建 Agent **${agent?.name || '新助手'}**！\n\n**配置详情**:\n- 模型: \`${agent?.model || 'GPT-4o'}\`\n- 工具: ${agent?.tools?.join(', ') || '无'}\n- 温度: ${agent?.temperature || 0.7}\n\n你可以点击卡片中的按钮查看或编辑，也可以继续在对话中调整配置。`;
      }
      return `创建 Agent 失败: ${result.error || '未知错误'}`;

    case 'create_workflow':
      if (result.success) {
        const wf = result.data?.workflow as WorkflowType;
        return `已为你创建工作流 **${wf?.name || '新工作流'}**！\n\n包含 ${wf?.nodes?.length || 0} 个节点，你可以在预览卡片中查看流程概览。\n\n点击"打开编辑器"可以精细调整节点配置和连线关系。`;
      }
      return `创建工作流失败: ${result.error || '未知错误'}`;

    case 'list_agents':
      if (result.success) {
        const agents = result.data?.agents as Agent[];
        return `当前共有 ${agents?.length || 0} 个 Agent:\n\n${agents?.map(a => `- **${a.name}** (\`${a.model}\`)`).join('\n') || '暂无 Agent'}\n\n你可以输入 \`/create-agent\` 或"帮我创建一个xxx Agent"来添加。`;
      }
      return '查询失败';

    case 'list_workflows':
      if (result.success) {
        const workflows = result.data?.workflows as WorkflowType[];
        return `当前共有 ${workflows?.length || 0} 个工作流:\n\n${workflows?.map(w => `- **${w.name}** (${w.status}, ${w.nodes.length}节点)`).join('\n') || '暂无工作流'}\n\n你可以输入 \`/create-workflow\` 来创建新的工作流。`;
      }
      return '查询失败';

    case 'query_status':
      if (result.success) {
        return `## 系统状态\n\n- Agent 数量: ${result.data?.agents || 0}\n- 工作流数量: ${result.data?.workflows || 0}\n- 执行状态: \`${result.data?.executionState?.status || 'idle'}\``;
      }
      return '查询失败';

    case 'run_workflow':
      if (result.success) {
        return `工作流已启动运行！你可以在对话中查看执行结果，也可以在工作流编辑器中查看详细日志。`;
      }
      return `运行失败: ${result.error || '请先指定要运行的工作流'}`;

    case 'general_chat':
      return `你好！我是 LNAgent 对话助手，支持以下功能：\n\n- **创建 Agent** — 输入 \`/create-agent\` 或"帮我创建一个xxx Agent"\n- **编排工作流** — 输入 \`/create-workflow\` 或"设计一个xxx工作流"\n- **查看列表** — 输入 \`/list\` 或"列出已有的Agent/工作流"\n- **运行工作流** — 输入 \`/run\` 或"运行xxx工作流"\n\n**模式切换**：顶部可切换 规划/编码/调试/编排 四种模式。\n\n试试下面的快捷建议吧！`;

    default:
      return intent.clarification || '我暂时无法理解你的请求，请尝试更详细地描述你想做什么。输入 `/help` 查看所有命令。';
  }
}

// ===== 主页面组件 =====

export function ChatWorkspacePage() {
  const { agents, workflows, channels, defaultModelId, routerEnabled, mcps, setDefaultModelId, setRouterEnabled, currentAgentId } = useStore();

  // 模式状态
  const [activeMode, setActiveMode] = useState<AgentMode>('code');

  // Hooks
  const chatSession = useChatSession(activeMode);
  const projectDir = useProjectDir();
  const fileUpload = useFileUpload(chatSession.activeMessages);

  // 本地 UI 状态
  const [lastUsedModel, setLastUsedModel] = useState<{ provider: string; model: string; displayName?: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [showRouterDashboard, setShowRouterDashboard] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showConnectorMenu, setShowConnectorMenu] = useState(false);
  const [allowFullAccess, setAllowFullAccess] = useState(false);

  // 任务追踪 / 思考 / 审批
  const [activeTaskSteps, setActiveTaskSteps] = useState<TaskStep[]>([]);
  const [multiAgentSteps, setMultiAgentSteps] = useState<TaskStep[]>([]);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const activeTaskStepsRef = useRef<TaskStep[]>([]);
  const thinkingStepsRef = useRef<ThinkingStep[]>([]);
  useEffect(() => { activeTaskStepsRef.current = activeTaskSteps; }, [activeTaskSteps]);
  useEffect(() => { thinkingStepsRef.current = thinkingSteps; }, [thinkingSteps]);
  const [streamingReasoning, setStreamingReasoning] = useState<string>('');
  const [pendingApproval, setPendingApproval] = useState<{
    request: ApprovalRequest;
    intent: ParsedIntent;
    metaPlan?: OrchestrationPlan;
  } | null>(null);

  // Refs
  const streamContentRef = useRef('');
  const streamAbortRef = useRef<AbortController | null>(null);
  const handleLLMStreamRef = useRef<((text: string, intent: ParsedIntent, userMsg: ChatMessage) => void) | null>(null);
  // 本轮对话中通过 memory_save 工具保存的记忆（用于完成后轻量提示）
  const savedMemoriesRef = useRef<Array<{ content: string; type: string }>>([]);

  // ===== 安全追加助手消息 =====
  const appendAssistantMessage = chatSession.appendAssistantMessage;

  // ===== 斜杠命令处理 =====
  const handleSlashCommandSelect = useCallback((cmd: SlashCommand) => {
    setInputValue('');
    setShowSlashMenu(false);
    const textMap: Record<string, string> = {
      'create-agent': '帮我创建一个Agent',
      'create-workflow': '帮我创建一个工作流',
      'list': '查看已有的Agent和工作流列表',
      'run': '运行工作流',
      'debug': '帮我诊断一下系统问题',
      'status': '查看系统运行状态',
      'ssh': 'SSH远程执行命令',
      'help': '/help',
    };

    if (cmd.id === 'help') {
      const helpMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `## 可用斜杠命令\n\n${slashCommands.map(c => `- \`/${c.command}\` — ${c.description}`).join('\n')}\n\n也可以直接用自然语言描述你的需求，我会自动识别意图。`,
        timestamp: new Date().toISOString(),
        messageType: 'text',
      };
      chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, helpMsg]);
      return;
    }

    if (cmd.id === 'reflect') {
      handleReflect();
      return;
    }

    if (cmd.id === 'optimize') {
      const lastUser = [...chatSession.activeMessages].reverse().find(m => m.role === 'user' && !m.content.startsWith('✅'));
      if (lastUser) {
        handleOptimize(lastUser.content);
      } else {
        appendAssistantMessage('请先描述你的需求（如"设计一个内容审核工作流"），然后再执行 `/optimize`。');
      }
      return;
    }

    if (cmd.id === 'router') {
      setShowRouterDashboard(true);
      return;
    }

    if (cmd.id === 'dream') {
      handleDreamCommand();
      return;
    }

    if (cmd.id === 'extract') {
      handleExtractCommand();
      return;
    }

    if (cmd.id === 'memory') {
      handleMemoryStatsCommand();
      return;
    }

    const text = textMap[cmd.id] || cmd.label;
    processUserInput(text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSession.activeMessages, chatSession.activeSessionId, appendAssistantMessage]);

  // ===== 核心处理逻辑（双层路由） =====
  const [inputValue, setInputValue] = useState('');

  const processUserInput = useCallback(async (text: string) => {
    if (!text.trim() || isProcessing) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
      messageType: 'text',
      attachments: fileUpload.uploadedFiles.length > 0 ? fileUpload.uploadedFiles.map((f) => ({ ...f })) : undefined,
    };

    chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, userMsg]);
    setInputValue('');
    fileUpload.clearUploadedFiles();
    setIsProcessing(true);

    try {
    const intent = parseIntent(text.trim());
    const useMetaAgent = shouldUseMetaAgent(intent);

    if (activeMode === 'ask' || activeMode === 'plan') {
      const thinking = generateThinkingSteps(intent.action, activeMode, intent.params);
      setThinkingSteps(thinking);
      const taskSteps = generateTaskSteps(intent.action, intent.params);
      setActiveTaskSteps(taskSteps);
      handleLLMStreamRef.current?.(text.trim(), intent, userMsg);
      return;
    }

    if (useMetaAgent) {
      handleMetaAgentOrchestrate(text.trim(), userMsg);
      return;
    }

    // 自动编排检测：code/debug/orchestrator 模式下，检测是否需要自动触发多 Agent
    // shouldAutoOrchestrate 内部会根据文本内容判断是否为复合任务（多领域/协作关键词）
    // 纯闲聊不会被 shouldAutoOrchestrate 触发（除非超过 200 字且含领域关键词）
    if (activeMode !== 'ask' && activeMode !== 'plan') {
      const { shouldAutoOrchestrate } = await import('../components/chat/intent/MetaAgent');
      const registry = getAgentRuntimeRegistry();
      const existingAgents = registry.getAllAgents().map((a) => ({
        capabilities: a.capabilities,
        name: a.agentId,
      }));
      const orchestrateCheck = shouldAutoOrchestrate(text.trim(), existingAgents);
      if (orchestrateCheck.shouldOrchestrate && !useMetaAgent) {
        handleMetaAgentOrchestrate(text.trim(), userMsg);
        return;
      }
    }

    const thinking = generateThinkingSteps(intent.action, activeMode, intent.params);
    setThinkingSteps(thinking);

    const taskSteps = generateTaskSteps(intent.action, intent.params);
    setActiveTaskSteps(taskSteps);

    const approval = allowFullAccess ? null : needsApproval(intent.action, activeMode);
    if (approval) {
      approval.details = {
        名称: intent.params.name || '-',
        模型: intent.params.model || '-',
        工具: intent.params.tools?.join(', ') || '-',
      };

      setTimeout(() => {
        setIsProcessing(false);
        setThinkingSteps([]);
        setActiveTaskSteps([]);
        setPendingApproval({ request: approval, intent });
      }, 600);
      return;
    }

    if (intent.action === 'general_chat' || intent.confidence < 0.5) {
      handleLLMStreamRef.current?.(text.trim(), intent, userMsg);
      return;
    }

    if (intent.action === 'create_workflow') {
      handleWorkflowDesign(text.trim(), userMsg);
      return;
    }
    if (intent.action === 'update_workflow' || intent.action === 'add_node' || intent.action === 'configure_node') {
      handleWorkflowModify(text.trim(), userMsg);
      return;
    }

    executeAndRespond(intent, userMsg, taskSteps);
    } catch (err: any) {
      // 任何异常都不应阻塞对话
      console.error('[Chat] processUserInput 异常:', err);
      const errMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `⚠️ 处理消息时出错：${err?.message || '未知错误'}\n\n请重试，或检查渠道设置。`,
        timestamp: new Date().toISOString(),
        messageType: 'text',
      };
      chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, errMsg]);
      setIsProcessing(false);
      setThinkingSteps([]);
      setActiveTaskSteps([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSession.activeMessages, chatSession.activeSessionId, activeMode, isProcessing, fileUpload.uploadedFiles, allowFullAccess]);

  // ===== LLM 驱动的工作流设计 =====
  const handleWorkflowDesign = useCallback(async (userText: string, userMsg: ChatMessage) => {
    setThinkingSteps([{ id: generateId(), phase: 'analyzing', content: '正在理解你的工作流需求...', timestamp: new Date().toISOString() }]);
    setIsProcessing(true);

    try {
      const designResult = await designWorkflowFromDescription(userText);

      if (designResult.success) {
        const workflowId = await useStore.getState().createWorkflow(designResult.name);
        await useStore.getState().updateWorkflow(workflowId, {
          description: designResult.description,
          nodes: designResult.nodes,
          edges: designResult.edges,
        });
        const workflow = useStore.getState().workflows.find(w => w.id === workflowId);

        const responseText = designResult.fallback
          ? `已为你创建工作流 **${designResult.name}**（基于模板拼接，可继续对话细化）。\n\n工作流包含 ${designResult.nodes.length} 个节点、${designResult.edges.length} 条连线。`
          : `已为你设计并创建工作流 **${designResult.name}**！\n\n工作流包含 ${designResult.nodes.length} 个节点、${designResult.edges.length} 条连线：\n${designResult.nodes.filter(n => n.type !== 'start' && n.type !== 'end').map(n => `- **${n.name}** (${n.type})`).join('\n')}\n\n你可以继续对话细化（如"再加一个条件分支"），或在编辑器中手动调整。`;

        const assistantMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: responseText,
          timestamp: new Date().toISOString(),
          messageType: 'workflow_preview',
          metadata: {
            workflowId,
            workflow,
            thinkingSteps: thinkingStepsRef.current,
            taskSteps: activeTaskStepsRef.current,
          },
        };
        chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, userMsg, assistantMsg]);
      } else {
        appendAssistantMessage(`⚠️ 工作流设计失败：${designResult.error || '未知错误'}。请尝试更详细的描述，如"设计一个内容审核流程：接收文本→AI判断→人工复审→输出结果"。`);
      }
    } catch (error: any) {
      appendAssistantMessage(`⚠️ 工作流设计异常：${error.message || '未知错误'}`);
    } finally {
      setIsProcessing(false);
      setThinkingSteps([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSession.activeMessages, chatSession.activeSessionId]);

  // ===== LLM 驱动的工作流修改 =====
  const handleWorkflowModify = useCallback(async (userText: string, userMsg: ChatMessage) => {
    setThinkingSteps([{ id: generateId(), phase: 'planning', content: '正在根据你的要求修改工作流...', timestamp: new Date().toISOString() }]);
    setIsProcessing(true);

    const currentWfId = useStore.getState().currentWorkflowId;
    const recentWorkflowMsg = [...chatSession.activeMessages].reverse().find(m => m.messageType === 'workflow_preview' && m.metadata?.workflowId);
    const targetWorkflowId = recentWorkflowMsg?.metadata?.workflowId || currentWfId;
    const targetWorkflow = useStore.getState().workflows.find(w => w.id === targetWorkflowId);

    if (!targetWorkflow) {
      appendAssistantMessage('⚠️ 未找到可修改的工作流。请先创建一个工作流再进行修改。');
      setIsProcessing(false);
      setThinkingSteps([]);
      return;
    }

    try {
      const modifyResult = await modifyWorkflowWithDescription(targetWorkflow, userText);

      if (modifyResult.success) {
        const updatedWorkflow = applyWorkflowModification(targetWorkflow, modifyResult);
        useStore.getState().updateWorkflow(targetWorkflowId, {
          name: updatedWorkflow.name,
          description: updatedWorkflow.description,
          nodes: updatedWorkflow.nodes,
          edges: updatedWorkflow.edges,
        });

        const changes = [
          modifyResult.addedNodes.length > 0 ? `新增 ${modifyResult.addedNodes.length} 个节点` : null,
          modifyResult.removedNodeIds.length > 0 ? `删除 ${modifyResult.removedNodeIds.length} 个节点` : null,
          modifyResult.addedEdges.length > 0 ? `新增 ${modifyResult.addedEdges.length} 条连线` : null,
          modifyResult.removedEdgeIds.length > 0 ? `删除 ${modifyResult.removedEdgeIds.length} 条连线` : null,
          modifyResult.updatedNodes.length > 0 ? `更新 ${modifyResult.updatedNodes.length} 个节点` : null,
        ].filter(Boolean).join('、');

        const responseText = changes
          ? `已修改工作流 **${updatedWorkflow.name}**：${changes}。\n\n现在共有 ${updatedWorkflow.nodes.length} 个节点、${updatedWorkflow.edges.length} 条连线。`
          : `工作流 **${updatedWorkflow.name}** 没有变化。`;

        const assistantMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: responseText,
          timestamp: new Date().toISOString(),
          messageType: 'workflow_preview',
          metadata: {
            workflowId: targetWorkflowId,
            workflow: updatedWorkflow,
            thinkingSteps: thinkingStepsRef.current,
            taskSteps: activeTaskStepsRef.current,
          },
        };
        chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, userMsg, assistantMsg]);
      } else {
        appendAssistantMessage(`⚠️ 工作流修改失败：${modifyResult.error || 'LLM 无法解析修改指令'}。请尝试更明确的描述，如"在AI判断后加一个条件分支"。`);
      }
    } catch (error: any) {
      appendAssistantMessage(`⚠️ 工作流修改异常：${error.message || '未知错误'}`);
    } finally {
      setIsProcessing(false);
      setThinkingSteps([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSession.activeMessages, chatSession.activeSessionId]);

  const handleWorkflowRefine = useCallback((_workflowId: string) => {
    setInputValue('继续细化这个工作流：');
  }, []);

  // ===== 计算 outcome 并记录轨迹 =====
  const recordPlanTrace = useCallback(async (userInput: string, plan: OrchestrationPlan, results: ActionResult[]): Promise<'success' | 'partial' | 'failure'> => {
    const failed = results.filter(r => !r.success);
    const outcome: 'success' | 'partial' | 'failure' =
      results.length === 0 ? 'success'
        : failed.length === 0 ? 'success'
          : failed.length === results.length ? 'failure' : 'partial';

    const failureModes = failed.map(r => (r.error || r.type)).filter(Boolean) as string[];
    const trace = recordExecutionTrace(userInput, plan, outcome, {
      agentCount: plan.agents.length,
      workflowNodeCount: plan.workflow?.nodes.length || 0,
      resultsSummary: results.map(r => ({ type: r.type, success: r.success })),
    }, failureModes.length > 0 ? failureModes : undefined);

    useStore.getState().addTrace(trace);
    try {
      await memoryApi.addTrace(trace);
    } catch (e) {
      console.warn('Failed to persist execution trace:', e);
    }
    return outcome;
  }, []);

  // ===== 失败后触发反思进化 =====
  const maybeReflectAndNotify = useCallback(async () => {
    const store = useStore.getState();
    let traces = store.experienceBank;
    try {
      traces = await memoryApi.getTraces();
    } catch {
      //降级到本地 store
    }
    const refl = await runReflection(traces, store.metaSkill);
    if (refl.evolved) {
      store.updateMetaSkill(refl.newSkill);
      try {
        await memoryApi.addReflection({
          trigger: refl.reason,
          summary: refl.summary,
          principles: [refl.summary],
          layer: 'L2B',
        });
      } catch {}
      appendAssistantMessage(
        `🧬 **Meta-Skill 已进化至 v${refl.newSkill.version}**\n\n${refl.summary}\n\n_触发原因：${refl.reason}_`
      );
    }
  }, [appendAssistantMessage]);

  // ===== 统一落地 Meta-Agent 编排计划 =====
  const finalizeMetaPlan = useCallback(async (plan: OrchestrationPlan, userInput: string, userMsg: ChatMessage) => {
    // 直接执行，跳过确认
    const execSteps: TaskStep[] = plan.agents.map((a, i) => ({
      id: `exec-agent-${i}`,
      label: `创建 Agent: ${a.name}`,
      status: 'pending' as const,
    }));
    if (plan.workflow) {
      execSteps.push({
        id: 'exec-workflow',
        label: `创建工作流: ${plan.workflow.name}`,
        status: 'pending' as const,
      });
    }
    setMultiAgentSteps(execSteps);
    setActiveTaskSteps([]);

    const results = await executeOrchestrationPlan(plan, (progress) => {
      setMultiAgentSteps((prev) =>
        prev.map((s, i) => {
          if (i === progress.currentIndex) return { ...s, status: 'running' as const };
          if (i < progress.currentIndex) return { ...s, status: 'completed' as const };
          return s;
        })
      );
    });

    // 渐进式提示：MetaAgent 编排路径也触发功能使用跟踪（仅在执行成功时）
    const anySuccess = Array.isArray(results) && results.some((r: any) => r?.success !== false);
    if (plan.agents.length > 0 && anySuccess) trackFeatureUsed('agent_created');
    if (plan.workflow && anySuccess) trackFeatureUsed('workflow_created');

    const responseText = formatMetaAgentResponse(plan, results);

    const assistantMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: responseText,
      timestamp: new Date().toISOString(),
      messageType: getMetaAgentMessageType(plan, results),
      metadata: getMetaAgentMetadata(plan, results),
    };

    setThinkingSteps([]);
    setActiveTaskSteps([]);
    setMultiAgentSteps([]);
    chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, userMsg, assistantMsg]);
    setIsProcessing(false);

    const outcome = await recordPlanTrace(userInput, plan, results);

    if (outcome !== 'success') {
      await maybeReflectAndNotify();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSession.activeMessages, chatSession.activeSessionId, activeMode, recordPlanTrace, maybeReflectAndNotify]);

  // ===== Meta-Agent 编排处理 =====
  const handleMetaAgentOrchestrate = useCallback(async (text: string, userMsg: ChatMessage) => {
    const store = useStore.getState();
    const metaSkill = store.metaSkill;
    const bank = store.experienceBank;

    const relevantExp = findRelevantExperience(text, bank);
    const expContext = buildExperienceContext(relevantExp);

    const memoryManager = getMemoryManager();
    const { recalledContext, sessionMemoryContext } = await memoryManager.onLLMCall(chatSession.activeSessionId, text, chatSession.activeMessages);

    const uploadedContext = fileUpload.readUploadedContext();

    const thinking = generateThinkingSteps('smart_orchestrate', activeMode, {});
    setThinkingSteps(thinking);

    const plan = await metaAgentOrchestrate(text, metaSkill, {
      experienceContext: expContext,
      recalledMemoryContext: recalledContext,
      sessionMemoryContext: [sessionMemoryContext, uploadedContext ? `【用户上传/引用的文件】\n${uploadedContext}` : '']
        .filter(Boolean).join('\n\n'),
    });

    const hasClarifications = plan.clarifications && plan.clarifications.length > 0;
    const hasAgents = plan.agents && plan.agents.length > 0;
    const hasWorkflow = !!plan.workflow;
    const hasSubTasks = plan.subTasks && plan.subTasks.length > 0;
    const hasRealContent = hasAgents || hasWorkflow || hasSubTasks;

    if (hasClarifications && !hasRealContent) {
      const clarificationText = plan.clarifications.map((q, i) => `${i + 1}. ${q}`).join('\n');
      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `请补充以下信息以便我为你制定更精准的方案：\n\n${clarificationText}`,
        timestamp: new Date().toISOString(),
        messageType: 'text',
      };
      setThinkingSteps([]);
      setActiveTaskSteps([]);
      chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, userMsg, assistantMsg]);
      setIsProcessing(false);
      return;
    }

    if (activeMode === 'plan') {
      if (hasRealContent) {
        const responseText = `# 编排规划方案（Meta-Agent）\n\n${plan.reasoning || '已分析你的需求，制定以下方案：'}\n\n## 子任务\n${hasSubTasks
    ? plan.subTasks.map((t, i) => `${i + 1}. ${t.action} — ${JSON.stringify(t.params).slice(0, 80)}`).join('\n')
    : '无需分解，直接执行'}\n\n## Agent 设计\n${hasAgents
    ? plan.agents.map((a, i) => `${i + 1}. **${a.name}** — 模型: \`${a.model}\`, 工具: ${a.tools.join(', ') || '无'}`).join('\n')
    : '无需创建 Agent'}\n\n## 工作流编排\n${hasWorkflow
    ? `**${plan.workflow!.name}** — ${plan.workflow!.nodes.length} 个节点\n${plan.workflow!.nodes.map((n, i) => `  ${i + 1}. ${n.name} (${n.type})`).join('\n')}`
    : '无需创建工作流'}\n\n*当前为规划模式，不会执行创建操作。切换到编码模式后可落地。*`;

        const assistantMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: responseText,
          timestamp: new Date().toISOString(),
          messageType: 'text',
        };

        setThinkingSteps([]);
        setActiveTaskSteps([]);
        chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, userMsg, assistantMsg]);
        setIsProcessing(false);
        return;
      }

      setThinkingSteps([]);
      setActiveTaskSteps([]);
      handleLLMStreamRef.current?.(text, { action: 'general_chat', params: {}, confidence: 0.5, originalText: text }, userMsg);
      return;
    }

    await finalizeMetaPlan(plan, text, userMsg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSession.activeMessages, chatSession.activeSessionId, activeMode, finalizeMetaPlan]);

  // ===== /reflect =====
  const handleReflect = useCallback(async () => {
    const store = useStore.getState();
    let traces = store.experienceBank;
    try {
      traces = await memoryApi.getTraces();
    } catch {}
    const refl = await runReflection(traces, store.metaSkill);
    if (refl.evolved) {
      store.updateMetaSkill(refl.newSkill);
      try {
        await memoryApi.addReflection({
          trigger: refl.reason,
          summary: refl.summary,
          principles: [refl.summary],
          layer: 'L2B',
        });
      } catch {}
    }
    appendAssistantMessage(
      `🧬 **Meta-Skill 反思进化**（当前 v${store.metaSkill.version}）\n\n` +
      `${refl.evolved ? `✅ 已进化至 **v${refl.newSkill.version}**` : '⏸ 暂未触发进化（失败样本不足）'}\n\n` +
      `${refl.summary}\n\n_${refl.reason}_`
    );
  }, [appendAssistantMessage]);

  // ===== /dream =====
  const handleDreamCommand = useCallback(async () => {
    const { handleDreamCommand: dreamCmd } = await import('../lib/memory/autoDream');
    const result = await dreamCmd();
    appendAssistantMessage(
      `🌙 **Auto Dream 记忆整合**\n\n${result.message}\n\n` +
      (result.log ? `合并: ${result.log.changes.factualMerged}条 | 蒸馏: ${result.log.changes.tracesConsolidated}条 | 修剪: ${result.log.changes.factualPruned}条 | Reflection: ${result.log.changes.reflectionsMerged}条` : '')
    );
  }, [appendAssistantMessage]);

  // ===== /extract =====
  const handleExtractCommand = useCallback(async () => {
    const { runAutoExtraction } = await import('../lib/memory/autoExtraction');
    const currentMessages = chatSession.sessions.find(s => s.id === chatSession.activeSessionId)?.messages || [];
    const result = await runAutoExtraction(chatSession.activeSessionId, currentMessages);
    appendAssistantMessage(
      `💡 **Auto Extraction 手动提取**\n\n` +
      `方法: ${result.method}\n` +
      `提取数量: ${result.extracted.length}条\n\n` +
      (result.extracted.length > 0
        ? result.extracted.map(m => `- [${m.type}] ${m.content.slice(0, 80)}`).join('\n')
        : '当前对话中没有可提取的事实')
    );
  }, [appendAssistantMessage, chatSession.activeSessionId, chatSession.sessions]);

  // ===== /memory =====
  const handleMemoryStatsCommand = useCallback(async () => {
    const stats = await getMemoryManager().getMemoryStats();
    appendAssistantMessage(
      `🧠 **记忆架构统计**\n\n` +
      `**L0 Session Memory**: ${stats.L0.sessions} 个活跃会话, 预估 ${stats.L0.totalTokens} tokens\n\n` +
      `**L1 Factual Memory**: ${stats.L1.entries} 条事实 (${Object.entries(stats.L1.byType).map(([t, n]) => `${t}=${n}`).join(', ')}), ${(stats.L1.totalSize / 1024).toFixed(1)}KB\n\n` +
      `**L2-A Traces**: ${stats.L2A.traces} 条轨迹 (成功=${stats.L2A.successes}, 失败=${stats.L2A.failures})\n\n` +
      `**L2-B Reflections**: ${stats.L2B.reflections} 条经验反思\n\n` +
      `**L2-C Strategies**: Meta-Skill v${stats.L2C.version}\n\n` +
      `**L3 Router Memory**: ${stats.L3.records} 条路由记录`
    );
  }, [appendAssistantMessage]);

  // ===== /optimize =====
  const handleOptimize = useCallback(async (text: string) => {
    const store = useStore.getState();
    const metaSkill = store.metaSkill;
    const bank = store.experienceBank;
    const relevantExp = findRelevantExperience(text, bank);
    const expContext = buildExperienceContext(relevantExp);

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
      messageType: 'text',
    };
    chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, userMsg]);
    setInputValue('');
    setIsProcessing(true);
    setThinkingSteps(generateThinkingSteps('smart_orchestrate', activeMode, {}));

    const plans = await rolloutMultiplePlans(text, metaSkill, expContext, 3);
    if (plans.length === 0) {
      appendAssistantMessage('⚠️ 多轨迹展开失败，可能未配置 LLM 渠道或网络异常。');
      setIsProcessing(false);
      setThinkingSteps([]);
      return;
    }

    const { scores, bestIndex } = await evaluatePlansQuality(plans, text);
    const bestPlan = plans[bestIndex] || plans[0];

    const compareText = `## 🔀 多轨迹展开结果（${plans.length} 个候选）\n\n${plans.map((p, i) => {
      const agents = p.agents.length > 0 ? p.agents.map(a => a.name).join('、') : '无';
      const wf = p.workflow ? `${p.workflow.nodes.length} 节点` : '无';
      const mark = i === bestIndex ? ' ⭐ **最优**' : '';
      return `${i + 1}. 评分 **${scores[i]?.toFixed?.(1) ?? scores[i]}** — Agent: ${agents} | 工作流: ${wf}${mark}`;
    }).join('\n')}\n\n已自动选用最优方案，请确认后落地。`;

    const compareMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: compareText,
      timestamp: new Date().toISOString(),
      messageType: 'text',
    };
    chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, userMsg, compareMsg]);
    setThinkingSteps([]);

    if (activeMode === 'plan') {
      const planText = `# 编排规划方案（Meta-Agent · 最优）\n\n${bestPlan.reasoning || '已分析你的需求，制定以下方案：'}\n\n## Agent 设计\n${bestPlan.agents.length > 0 ? bestPlan.agents.map((a, i) => `${i + 1}. **${a.name}** — 模型: \`${a.model}\`, 工具: ${a.tools.join(', ') || '无'}`).join('\n') : '无需创建 Agent'}\n\n## 工作流编排\n${bestPlan.workflow ? `**${bestPlan.workflow.name}** — ${bestPlan.workflow.nodes.length} 个节点\n${bestPlan.workflow.nodes.map((n, i) => `  ${i + 1}. ${n.name} (${n.type})`).join('\n')}` : '无需创建工作流'}\n\n*规划模式，不会执行。切换到编码模式后落地。*`;
      const planMsg: ChatMessage = { id: generateId(), role: 'assistant', content: planText, timestamp: new Date().toISOString(), messageType: 'text' };
      chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, userMsg, compareMsg, planMsg]);
      setIsProcessing(false);
      return;
    }

    await finalizeMetaPlan(bestPlan, text, userMsg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSession.activeMessages, chatSession.activeSessionId, activeMode, finalizeMetaPlan, appendAssistantMessage]);

  // ===== Meta-Agent 响应格式化 =====
  function formatMetaAgentResponse(plan: OrchestrationPlan, results: ActionResult[]): string {
    const agentResults = results.filter(r => r.type === 'agent_created');
    const workflowResults = results.filter(r => r.type === 'workflow_created');

    let text = '';
    if (plan.reasoning) {
      text += `${plan.reasoning}\n\n`;
    }

    if (plan.agents.length > 0) {
      text += `## 已创建 ${agentResults.length} 个 Agent\n\n`;
      agentResults.forEach((r, i) => {
        const agent = r.data?.agent as Agent;
        text += `${i + 1}. **${agent?.name}** — 模型: \`${agent?.model}\`, 工具: ${agent?.tools?.join(', ') || '无'}\n`;
      });
      text += '\n';
    }

    if (plan.workflow) {
      text += `## 已创建工作流: ${workflowResults[0]?.data?.workflow?.name || plan.workflow.name}\n\n`;
      text += `包含 ${plan.workflow.nodes.length} 个节点：${plan.workflow.nodes.map(n => n.name).join(' → ')}\n\n`;
    }

    if (plan.clarifications.length > 0) {
      text += `## 需要澄清\n${plan.clarifications.map(c => `- ${c}`).join('\n')}\n`;
    }

    if (text.trim() === '') {
      text = plan.reasoning || '已处理你的请求。';
    }

    return text;
  }

  function getMetaAgentMessageType(plan: OrchestrationPlan, results: ActionResult[]): ChatMessage['messageType'] {
    if (plan.agents.length > 0 && results.some(r => r.type === 'agent_created' && r.success)) {
      return 'agent_card';
    }
    if (plan.workflow && results.some(r => r.type === 'workflow_created' && r.success)) {
      return 'workflow_preview';
    }
    if (plan.clarifications.length > 0) {
      return 'clarification';
    }
    return 'text';
  }

  function getMetaAgentMetadata(plan: OrchestrationPlan, results: ActionResult[]): Record<string, any> {
    if (plan.agents.length > 0) {
      const agentResult = results.find(r => r.type === 'agent_created' && r.success);
      return { agentId: agentResult?.data?.agentId, agent: agentResult?.data?.agent };
    }
    if (plan.workflow) {
      const wfResult = results.find(r => r.type === 'workflow_created' && r.success);
      return { workflowId: wfResult?.data?.workflowId, workflow: wfResult?.data?.workflow };
    }
    if (plan.clarifications.length > 0) {
      return { clarification: plan.clarifications[0], suggestions: plan.clarifications };
    }
    return {};
  }

  // ===== LLM 流式对话 =====
  const handleLLMStream = useCallback(async (text: string, intent: ParsedIntent, userMsg: ChatMessage) => {
    streamContentRef.current = '';
    savedMemoriesRef.current = [];
    let streamMsgId = '';
    let sessionId = chatSession.activeSessionId;
    try {
    const channelInfo = await getAvailableChannelFromStore();

    if (!channelInfo) {
      const responseText = generateResponse(intent, { success: true, type: 'general_chat' }, activeMode);
      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: responseText + '\n\n> ⚠️ 当前未配置 LLM 渠道，此回复为预设模板。请在「渠道设置」中添加 API Key 以获得 AI 驱动的对话体验。',
        timestamp: new Date().toISOString(),
        messageType: 'text',
      };
      chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, userMsg, assistantMsg]);
      setIsProcessing(false);
      setThinkingSteps([]);
      setActiveTaskSteps([]);
      return;
    }

    streamMsgId = generateId();
    const streamMsg: ChatMessage = {
      id: streamMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      messageType: 'text',
    };

    chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, userMsg, streamMsg]);

    // Phase 1: 生成 taskId，注册后台任务（断线后可恢复）
    const taskId = generateId();
    sessionId = chatSession.activeSessionId;
    chatSession.setPendingTask(sessionId, taskId);

    const memoryManager = getMemoryManager();
    const { recalledContext, sessionMemoryContext, compactedMessages: memoryCompacted } = await memoryManager.onLLMCall(chatSession.activeSessionId, text, chatSession.activeMessages);
    let compactedMessages = memoryCompacted;
    const memoryContext = recalledContext || sessionMemoryContext ? `${recalledContext || ''}\n${sessionMemoryContext || ''}`.trim() : '';
    const sessionPrefix = sessionMemoryContext ? `\n${sessionMemoryContext}\n` : '';

    const now = new Date();

    // 获取当前工作流上下文
    const store = useStore.getState();
    const currentWfId = store.currentWorkflowId;
    const recentWorkflowMsg = [...chatSession.activeMessages].reverse().find(m => m.messageType === 'workflow_preview' && m.metadata?.workflowId);
    const targetWorkflowId = recentWorkflowMsg?.metadata?.workflowId || currentWfId;
    const targetWorkflow = store.workflows.find(w => w.id === targetWorkflowId);
    const workflowContext = targetWorkflow
      ? `<current_workflow>
名称: ${targetWorkflow.name}
描述: ${targetWorkflow.description || '无'}
节点数: ${targetWorkflow.nodes.length}
边数: ${targetWorkflow.edges.length}
状态: ${targetWorkflow.status}
节点列表: ${targetWorkflow.nodes.map(n => `${n.name}(${n.type})`).join(' → ') || '无'}
变量: ${targetWorkflow.variables.map(v => v.name).join(', ') || '无'}
</current_workflow>`
      : '';

    const systemPrompt = `<role>
你是 LNAgent，一位在 AI Agent 编排、自动化工作流设计与系统运维领域拥有深厚专业知识的资深专家。
你擅长将复杂需求拆解为可执行的 Agent 协作方案，支持本地与远程服务器的编程运维。
</role>

<core_rules>
NEVER 在回复开头使用客套话（如 "Great question!"、"当然"、"好的"、"Sure" 等）。直接输出核心内容。
NEVER 输出你的内部思考过程、推理步骤或决策理由。只输出对用户有价值的结论。
NEVER 在信息不足时猜测或编造方案。信息不足时，按模式规则主动追问。

IMPORTANT: 回复必须简洁、精确、可执行。用户时间宝贵，每句话都要有信息量。
CRITICAL: 当涉及文件创建/修改/删除等操作时，必须先读取当前状态再提出变更建议。
</core_rules>

<capability_rules>
你具备以下能力，应在合适场景主动使用，不要等用户明确要求：

<tool_usage>
何时使用工具（必须使用，不要凭记忆作答）：
- 需要实时信息、最新资讯、外部知识 → 调用 `builtin_web_search`（如"最新版本"、"当前价格"、"近期新闻"）
- 需要获取特定网页内容 → 调用 `builtin_web_fetch`（用户提供 URL 时）
- 需要精确数学计算 → 调用 `builtin_calculator`（避免心算出错）
- 需要当前日期/时间 → 调用 `builtin_datetime`（涉及"今天"、"现在"、"星期几"）

工具使用原则：
- 调用前简述意图（一句话），调用后基于结果回答，不要假装知道结果
- 工具失败时告知用户并给出替代建议，不要静默忽略
- 单次回答中工具调用不超过 3 次，避免过度依赖
</tool_usage>

<memory_usage>
何时不使用记忆工具：常规闲聊、一次性问答无需操作记忆。
何时保存记忆（调用 `memory_save`）：
- 用户明确表达了偏好或约束（如"我喜欢用 TypeScript"、"不要用 class"）
- 做出了重要决策（如"项目用 React 而非 Vue"）
- 用户布置了长期任务或项目背景（如"我在做一个电商系统"）
- 关键的纠错信息（如"上次你给的方案有 bug"）

何时检索记忆（调用 `memory_search`）：
- 用户提到"之前"、"上次"、"我记得"等回溯性表述
- 涉及用户偏好或项目背景时，先检索再回答
- 复杂任务开始前，检索相关历史上下文

记忆使用原则：
- 保存时用简短关键词作为 tags/keywords，便于后续检索
- 不要保存显而易见或一次性的信息（如"用户刚才说了你好"）
- 检索无结果时正常回答，不要刻意提醒"没有记忆"
</memory_usage>

<orchestration_flow>
面对复杂请求时，按以下顺序处理：
1. 意图理解：明确用户目标
2. 记忆召回：检索相关历史上下文（如有）
3. 工具调用：获取所需外部信息或执行操作
4. 综合回答：基于记忆+工具结果给出完整回复
5. 记忆沉淀：保存本次对话中的关键信息（如有）
</orchestration_flow>
</capability_rules>

<mode_config>
当前模式: ${activeMode}

<mode_plan>
【plan 模式规则 - 规划助手】
你的任务是帮用户想清楚需求，提供决策支持，而不是替用户做决定或直接执行。

判断标准:
- 信息充足度: 检查用户是否提供了目标、约束、偏好三个维度的关键信息
  ✓ 目标清晰（要做什么）
  ✓ 约束明确（时间/资源/技术限制）
  ✓ 偏好可识别（风格/质量/成本倾向）

输出规则:
- 信息不足时: 直接输出 2-5 个精准的澄清问题，不要解释为什么要问这些问题
  格式: "请补充以下信息：\n1. ...\n2. ..."
  问题必须具体、可回答，避免泛泛而问
- 信息充足时: 输出结构化规划方案，包含:
  1. 目标分析（用一句话重述用户目标）
  2. 推荐方案（列出 1-3 种方案，说明取舍理由）
  3. 执行步骤（分解为有序子步骤）
  4. 风险预判（识别潜在问题和应对措施）
  5. 下一步建议（告诉用户接下来应该做什么）
</mode_plan>

<mode_code>
【code 模式规则 - 执行助手】
用户已确认执行意图。你的任务是将规划方案落地为实际操作。

输出规则:
- 先确认要执行的操作范围
- 执行过程中实时反馈进度
- 完成后总结变更内容和结果
- 遇到错误时提供解决方案而非仅报告错误
</mode_code>

<mode_debug>
【debug 模式规则 - 诊断助手】
用户遇到了问题。你的任务是系统化排查并定位根因。

输出规则:
- 采用假设驱动的排查方法: 列出可能原因 → 逐一验证 → 定位根因
- 提供具体的检查命令和预期输出
- 修复方案必须经过验证，标注风险等级
- 修复后验证: 确认问题已解决，提供预防建议
</mode_debug>

<mode_orchestrator>
【orchestrator 模式规则 - 协调助手】
用户需要多任务并行执行。你的任务是分解任务、分配资源、协调执行。

输出规则:
- 展示任务依赖关系图
- 标注可并行的子任务
- 实时报告各子任务进度
- 任何子任务失败时自动评估影响并调整计划
- 最终汇总所有子任务结果
</mode_orchestrator>

<mode_ask>
【ask 模式规则 - 知识问答】
用户需要获取信息或解答疑问。你的任务是提供准确、简洁的回答。

输出规则:
- 直接回答，不绕弯子
- 对不确定的内容明确说明
- 需要代码示例时提供完整可运行的代码
- 复杂概念用类比或示例解释
</mode_ask>
</mode_config>

<output_examples>
【输出风格参考】
用户: 帮我创建一个文案写手 Agent
助手: 请补充以下信息：
1. 目标文案类型（营销/技术/学术）
2. 目标输出语言（中文/英文/双语）
3. 质量与速度偏好（追求完美 vs 快速初稿）

用户: Python 怎么反转列表？
助手: list[::-1] 或 list.reverse()

用户: 设计一个内容审核工作流
助手: ## 规划方案：内容审核工作流

### 目标分析
为用户生成自动化内容审核流程，支持文本输入→AI判断→输出结果

### 推荐方案
方案 A（简单）: LLM 单节点审核 → 适合快速上线
方案 B（推荐）: AI 判断 + 条件分支 → 支持多维度审核
方案 C（完整）: 多级审核 + 人工复审 → 高准确性要求场景

### 执行步骤
1. 确定审核维度（合规/质量/风格）
2. 设计审核规则
3. 选择模型和阈值
4. 配置条件分支
5. 设计输出格式

### 下一步
确认推荐方案后，切换到编码模式即可落地。
</output_examples>

<context>
<timestamp>当前时间: ${now.toLocaleString('zh-CN')}</timestamp>
<system_state>
Agent 数量: ${useStore.getState().agents.length}
工作流数量: ${useStore.getState().workflows.length}
可用模型: ${channelInfo.models.map(m => m.displayName).join(', ') || '无'}
会话 ID: ${chatSession.activeSessionId}
</system_state>
${workflowContext}
</context>`;

    const projectContext = await projectDir.readSelectedContext();
    const uploadedContext = fileUpload.readUploadedContext();
    const contextParts: string[] = [];
    if (projectContext) {
      contextParts.push(
        `【当前项目目录：${projectDir.projectDir?.name}】以下是用户选中的项目文件，你可以阅读它们来理解项目结构。\n当用户需要新增或修改文件时，请用如下格式输出完整文件内容（语言名可选，冒号后是相对路径），用户确认后会自动写回对应文件：\n\`\`\`语言名:相对路径\n...完整文件内容...\n\`\`\`\n\n项目文件内容：\n${projectContext}`,
      );
    }
    if (uploadedContext) {
      contextParts.push(
        `【用户上传的文件】以下文件由用户上传，作为本次对话的上下文参考（非项目目录文件，无需写回）：\n${uploadedContext}`,
      );
    }
    const contextMsg = contextParts.length > 0 ? contextParts.join('\n\n') : null;

    // ===== 视觉模型自动路由：含图片时智能处理 =====
    // 注意：processUserInput 已调用 clearUploadedFiles()，需从 userMsg.attachments 取图片
    const imageAttachments = (userMsg.attachments || [])
      .filter((a) => a.kind === 'image' && a.preview)
      .map((a) => ({ id: a.id, name: a.name, dataUrl: a.preview!, mimeType: a.type || 'image/png' }));
    let visionContextMsg: string | null = null;
    let userContent: string | ContentPart[] = text;

    if (imageAttachments.length > 0) {
      try {
        const store = useStore.getState();
        // 判断当前会使用的模型是否支持视觉
        let currentModelSupportsVision = false;
        let currentChannelId = '';
        let currentModelName = '';

        if (!store.routerEnabled && store.defaultModelId) {
          // 手动模式：检查指定的默认模型
          const sepIdx = store.defaultModelId.lastIndexOf(':');
          if (sepIdx >= 0) {
            currentChannelId = store.defaultModelId.slice(0, sepIdx);
            currentModelName = store.defaultModelId.slice(sepIdx + 1);
            currentModelSupportsVision = await isModelSupportsVision(currentChannelId, currentModelName);
          }
        }
        // 自动路由模式：无法预知模型，保守按"不支持视觉"处理，统一走 visionProxy

        if (currentModelSupportsVision && currentChannelId && currentModelName) {
          // 当前模型支持视觉 → 构建多模态 content 直接传图
          const parts: ContentPart[] = [{ type: 'text', text }];
          for (const img of imageAttachments) {
            parts.push({ type: 'image_url', image_url: { url: img.dataUrl, detail: 'high' } });
          }
          userContent = parts;
        } else {
          // 当前模型不支持视觉 → 调用识图模型分析图片，再回填文本
          const tempUserContent: ContentPart[] = [
            { type: 'text', text },
            ...imageAttachments.map((img): ContentPart => ({ type: 'image_url', image_url: { url: img.dataUrl, detail: 'high' } })),
          ];

          const visionResult = await visionProxy(
            [{ role: 'user', content: tempUserContent }],
            currentChannelId,
            currentModelName,
            (msg) => {
              // 进度提示：更新流式消息占位
              chatSession.setSessions((prev) => prev.map((s) => {
                if (s.id !== chatSession.activeSessionId) return s;
                return {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === streamMsgId ? { ...m, content: `🔍 ${msg}` } : m
                  ),
                };
              }));
            },
          );

          if (visionResult.proxied) {
            // 图片已被识图模型分析为文本，把分析结果作为上下文注入
            const analyzedText = visionResult.messages
              .map((m) => (typeof m.content === 'string' ? m.content : ''))
              .join('\n\n');
            visionContextMsg = `【图片分析结果】用户上传了 ${imageAttachments.length} 张图片，由识图模型（${visionResult.visionModelUsed}）分析得到以下描述，请基于此描述回应用户：\n\n${analyzedText}`;
            userContent = text;
          } else if (visionResult.warning) {
            visionContextMsg = visionResult.warning;
            userContent = text;
          } else {
            userContent = text;
          }
        }
      } catch (visionErr: any) {
        // vision 处理失败时不阻塞对话，降级为纯文本
        console.error('[Vision] 图片处理失败，降级为纯文本:', visionErr);
        visionContextMsg = `⚠️ 图片处理失败（${visionErr?.message || '未知错误'}），已降级为纯文本对话。`;
        userContent = text;
      }
    }

    const toolLog = { text: '' };

    const memoryTools = MEMORY_TOOL_SCHEMAS.map(schema => ({
      type: 'function' as const,
      function: schema,
    }));

    const mcpTools = mcps
      .filter((m) => m.enabled && m.status === 'connected' && m.tools?.length > 0)
      .flatMap((m) =>
        m.tools.map((t) => ({
          type: 'function' as const,
          function: {
            name: `${m.name}__${t.name}`,
            description: t.description,
            parameters: t.inputSchema,
          },
        }))
      );

    const allTools = [...BUILTIN_TOOL_SCHEMAS, ...memoryTools, ...mcpTools];

    // 若当前选中了某个 Agent 且该 Agent 配置了工具列表，则按其配置过滤工具集
    // 这样 Agent 只能使用自己被授权的工具，避免越权调用（如写作助手不应调用代码执行）
    // 特殊：Agent.tools 为空数组表示"不限制"，保留全部工具
    const currentAgent = currentAgentId ? agents.find(a => a.id === currentAgentId) : null;
    const effectiveTools = currentAgent && Array.isArray(currentAgent.tools) && currentAgent.tools.length > 0
      ? allTools.filter(t => {
          const toolName = (t as any).function?.name || '';
          return currentAgent.tools!.includes(toolName);
        })
      : allTools;

    const effectiveMessages = (compactedMessages || chatSession.activeMessages).map(m => ({
      role: (m.role === 'system' || m.role === 'tool' ? 'assistant' : m.role) as 'user' | 'assistant',
      content: m.content,
    }));

    const abortController = routedChatLLMStream(
      {
        messages: ([
          { role: 'system' as const, content: systemPrompt },
          ...(memoryContext ? [{ role: 'system' as const, content: `[相关记忆上下文]\n${memoryContext}` }] : []),
          ...(contextMsg ? [{ role: 'system' as const, content: contextMsg }] : []),
          ...(visionContextMsg ? [{ role: 'system' as const, content: visionContextMsg }] : []),
          ...effectiveMessages,
          { role: 'user' as const, content: userContent },
        ]) as Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string | ContentPart[] }>,
        temperature: activeMode === 'debug' ? 0.3 : activeMode === 'ask' ? 0.5 : 0.7,
        maxTokens: 2048,
        tools: effectiveTools,
        sessionId,
        taskId,
      },
      extractTaskFeatures(text, { intent: 'general_chat', mode: activeMode }),
      {
        onRouting: (decision) => {
          setLastUsedModel({
            provider: decision.provider,
            model: decision.modelName,
            displayName: decision.modelDisplayName || decision.modelName,
          });
        },
        onStart: () => {
          setStreamingReasoning('');
          setActiveTaskSteps((prev) =>
            prev.map((s, i) => ({
              ...s,
              status: i === 0 ? 'completed' : i === 1 ? 'running' : 'pending',
            }))
          );
        },
        onReasoning: (data) => {
          setStreamingReasoning(data.fullContent || '');
          setActiveTaskSteps((prev) =>
            prev.map((s, i) => ({
              ...s,
              status: i === 0 ? 'completed' : i === 1 ? 'running' : 'pending',
            }))
          );
        },
        onTool: async (data) => {
          const isMcpTool = data.name.includes('__');
          const isBuiltin = isBuiltinTool(data.name);
          const isMemory = data.name.startsWith('memory_');
          const displayName = isMcpTool ? data.name.replace('__', ' / ') : data.name.replace(/^builtin_/, '');
          const icon = isMcpTool ? '🔌' : isBuiltin ? '⚡' : isMemory ? '🧠' : '🔧';
          const toolType = isMcpTool ? 'MCP' : isBuiltin ? '内置' : isMemory ? '记忆' : '';

          if (data.status === 'running') {
            toolLog.text += (toolLog.text ? '\n' : '') + `${icon} 调用${toolType}工具 \`${displayName}\` …`;
            // 渐进式提示：首次使用工具/记忆时标记
            if (isBuiltin) trackFeatureUsed('builtin_tool');
            if (isMemory) trackFeatureUsed('memory');
          } else if (data.status === 'done') {
            if (data.result) {
              try {
                const result = JSON.parse(data.result);
                if (result._delegate) {
                  // Worker 后端未注册的工具，委托前端执行
                  // Worker 已内置 memory_* executor，但 builtin_* 未注册，需要前端执行
                  const toolName = result.toolName || '';
                  const toolArgs = result.args || {};
                  let execResult: { success: boolean; message: string; data?: any };

                  if (isBuiltinTool(toolName)) {
                    // 前端执行内置工具（web_search/web_fetch/calculator/datetime/code_run）
                    execResult = await executeBuiltinTool(toolName, toolArgs);
                  } else {
                    // 记忆工具兜底
                    execResult = executeMemoryTool(toolName, toolArgs);
                  }

                  const msg = execResult.success ? `✅ ${execResult.message}` : `❌ ${execResult.message}`;
                  toolLog.text += (toolLog.text ? '\n' : '') + msg;
                  // 捕获 memory_save 成功记录
                  if (toolName === 'memory_save' && execResult.success && toolArgs.content) {
                    savedMemoriesRef.current.push({
                      content: String(toolArgs.content).slice(0, 120),
                      type: String(toolArgs.type || 'user'),
                    });
                    window.dispatchEvent(new Event('lnagent:memory-updated'));
                  }
                } else {
                  const msg = result.success
                    ? `✅ ${result.message || '工具执行成功'}`
                    : `❌ ${result.message || '工具执行失败'}`;
                  toolLog.text += (toolLog.text ? '\n' : '') + msg;
                  // 捕获 memory_save 成功的记录，用于完成后轻量提示
                  if (data.name === 'memory_save' && result.success && data.args?.content) {
                    savedMemoriesRef.current.push({
                      content: String(data.args.content).slice(0, 120),
                      type: String(data.args.type || 'user'),
                    });
                    // 通知侧边栏 MemoryPanel 刷新
                    window.dispatchEvent(new Event('lnagent:memory-updated'));
                  }
                }
              } catch {
                // 非 JSON 结果（裸字符串），视为执行完成但无结构化状态
                const preview = (data.result || '').slice(0, 100);
                toolLog.text += (toolLog.text ? '\n' : '') + `✅ ${icon} \`${displayName}\` 完成${preview ? `：${preview}` : ''}`;
              }
            } else {
              toolLog.text += (toolLog.text ? '\n' : '') + `✅ ${icon} \`${displayName}\` 完成`;
            }
          }
          const contentPrefix = toolLog.text ? toolLog.text + '\n\n' : '';
          chatSession.setSessions((prev) => prev.map((s) => {
            if (s.id !== chatSession.activeSessionId) return s;
            return {
              ...s,
              messages: s.messages.map((m) =>
                m.id === streamMsgId ? { ...m, content: contentPrefix } : m
              ),
            };
          }));
        },
        onDelta: (data) => {
          streamContentRef.current = data.fullContent || '';
          const prefix = toolLog.text ? toolLog.text + '\n\n' : '';
          const currentContent = prefix + (data.fullContent || '');
          setActiveTaskSteps((prev) =>
            prev.map((s, i) => ({
              ...s,
              status: i === 0 ? 'completed' : i === 1 ? 'running' : 'pending',
            }))
          );
          chatSession.setSessions((prev) => prev.map((s) => {
            if (s.id !== chatSession.activeSessionId) return s;
            return {
              ...s,
              messages: s.messages.map((m) =>
                m.id === streamMsgId ? { ...m, content: currentContent } : m
              ),
            };
          }));
        },
        onDone: (doneData) => {
          setIsProcessing(false);
          streamAbortRef.current = null;
          chatSession.clearPendingTask(sessionId);

          // 保存推理内容和思考/任务进度到消息 metadata
          const finalReasoning = doneData?.reasoningContent || streamingReasoning || '';
          const savedMemories = savedMemoriesRef.current.length > 0 ? savedMemoriesRef.current.slice() : null;
          chatSession.setSessions((prev) => prev.map((s) => {
            if (s.id !== sessionId) return s;
            return {
              ...s,
              messages: s.messages.map(m =>
                m.id === streamMsgId
                  ? {
                      ...m,
                      metadata: {
                        ...(m.metadata || {}),
                        reasoning: finalReasoning || undefined,
                        thinkingSteps: thinkingStepsRef.current.length > 0 ? thinkingStepsRef.current : undefined,
                        taskSteps: activeTaskStepsRef.current.length > 0 ? activeTaskStepsRef.current : undefined,
                        savedMemories: savedMemories || undefined,
                      },
                    }
                  : m
              ),
            };
          }));
          setStreamingReasoning('');
          setThinkingSteps([]);
          setActiveTaskSteps([]);

          if (projectDir.projectDir && streamContentRef.current) {
            const extracted = projectDir.extractChanges(streamContentRef.current);
            if (extracted.length > 0) {
              projectDir.addPendingChanges(extracted);
            }
          }
          streamContentRef.current = '';

          const currentMessages = chatSession.sessions.find(s => s.id === chatSession.activeSessionId)?.messages || [];
          // 自动提取是异步的，延迟通知 MemoryPanel 刷新（提取通常需 1-3 秒）
          getMemoryManager().onTurnComplete(chatSession.activeSessionId, currentMessages);
          setTimeout(() => window.dispatchEvent(new Event('lnagent:memory-updated')), 2500);
        },
        onError: (data) => {
          // Phase 1: SSE 断线时，检查服务端任务是否仍在运行（浏览器未关闭但网络抖动）
          pollTask(taskId).then((task) => {
            if (task && task.status === 'running') {
              // 服务端仍在生成 → 显示云端生成中，轮询直到完成
              chatSession.setSessions((prev) => prev.map((s) => {
                if (s.id !== sessionId) return s;
                return {
                  ...s,
                  messages: s.messages.map(m =>
                    m.id === streamMsgId
                      ? { ...m, content: '☁️ 网络中断，云端仍在生成中...\n\n（请勿关闭页面，完成后自动恢复）' }
                      : m
                  ),
                };
              }));
              // 轮询兜底
              const pollStartTime = Date.now();
              const POLL_TIMEOUT = 5 * 60 * 1000; // 5 分钟
              const pollInterval = setInterval(() => {
                if (Date.now() - pollStartTime > POLL_TIMEOUT) {
                  clearInterval(pollInterval);
                  setIsProcessing(false);
                  streamAbortRef.current = null;
                  chatSession.clearPendingTask(sessionId);
                  setThinkingSteps([]);
                  setActiveTaskSteps([]);
                  chatSession.setSessions((prev) => prev.map((s) => {
                    if (s.id !== sessionId) return s;
                    return {
                      ...s,
                      messages: s.messages.map((m) =>
                        m.id === streamMsgId ? { ...m, content: `⚠️ 请求超时（5分钟），请重试` } : m
                      ),
                    };
                  }));
                  return;
                }
                pollTask(taskId).then((t) => {
                  if (!t) return;
                  if (t.status === 'done' && t.content) {
                    clearInterval(pollInterval);
                    chatSession.clearPendingTask(sessionId);
                    chatSession.setSessions((prev) => prev.map((s) => {
                      if (s.id !== sessionId) return s;
                      return {
                        ...s,
                        messages: s.messages.map(m =>
                          m.id === streamMsgId ? { ...m, content: t.content! } : m
                        ),
                      };
                    }));
                    setIsProcessing(false);
                    setThinkingSteps([]);
                    setActiveTaskSteps([]);
                  } else if (t.status === 'error') {
                    clearInterval(pollInterval);
                    chatSession.clearPendingTask(sessionId);
                    setIsProcessing(false);
                  }
                }).catch(() => {
                  clearInterval(pollInterval);
                  setIsProcessing(false);
                  streamAbortRef.current = null;
                  chatSession.clearPendingTask(sessionId);
                  setThinkingSteps([]);
                  setActiveTaskSteps([]);
                });
              }, 2000);
              return;
            }
            // 服务端已结束（真错误）→ 显示错误并清理
            chatSession.clearPendingTask(sessionId);
            chatSession.setSessions(prev => prev.map(s => {
              if (s.id !== sessionId) return s;
              return {
                ...s,
                messages: s.messages.map(m =>
                  m.id === streamMsgId
                    ? { ...m, content: `❌ LLM 调用失败: ${data.message}\n\n请检查渠道设置中的 API Key 是否正确。` }
                    : m
                ),
              };
            }));
            setIsProcessing(false);
            setThinkingSteps([]);
            setActiveTaskSteps([]);
            streamAbortRef.current = null;
          }).catch(() => {
            // pollTask 网络失败，Worker 完全不可达
            setIsProcessing(false);
            streamAbortRef.current = null;
            chatSession.clearPendingTask(sessionId);
            setThinkingSteps([]);
            setActiveTaskSteps([]);
            chatSession.setSessions((prev) => prev.map((s) => {
              if (s.id !== sessionId) return s;
              return {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === streamMsgId ? { ...m, content: `⚠️ 服务暂时不可用，请稍后重试` } : m
                ),
              };
            }));
          });
        },
      }
    );

    streamAbortRef.current = abortController;
    } catch (err: any) {
      const errorMsg = `⚠️ 对话初始化失败：${err.message || '未知错误'}`;
      chatSession.setSessions((prev) => prev.map((s) => {
        if (s.id !== sessionId) return s;
        return {
          ...s,
          messages: s.messages.map((m) =>
            m.id === streamMsgId ? { ...m, content: errorMsg } : m
          ),
        };
      }));
      setIsProcessing(false);
      streamAbortRef.current = null;
      chatSession.clearPendingTask(sessionId);
      setThinkingSteps([]);
      setActiveTaskSteps([]);
    } finally {
      // 兜底：正常路径（onDone）和错误路径（catch）均已重置 isProcessing，此处无需关键操作
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSession.activeMessages, chatSession.activeSessionId, activeMode, projectDir.projectDir, projectDir.selectedFiles, fileUpload.uploadedFiles, currentAgentId, agents]);

  handleLLMStreamRef.current = handleLLMStream;

  const executeAndRespond = useCallback((intent: ParsedIntent, userMsg: ChatMessage, initialSteps: TaskStep[]) => {
    const totalSteps = initialSteps.length;
    let currentStep = 0;

    const stepInterval = setInterval(async () => {
      currentStep++;
      setActiveTaskSteps(prev =>
        prev.map((s, i) => ({
          ...s,
          status: i < currentStep ? 'completed' as const :
                  i === currentStep ? 'running' as const :
                  'pending' as const,
          duration: i < currentStep ? Math.round(100 + Math.random() * 300) : undefined,
        }))
      );

      if (currentStep >= totalSteps) {
        clearInterval(stepInterval);

        const result = await executeAction(intent);
        // 渐进式提示：首次创建 Agent/工作流时标记
        if (result.success) {
          if (intent.action === 'create_agent') trackFeatureUsed('agent_created');
          if (intent.action === 'create_workflow') trackFeatureUsed('workflow_created');
        }
        const responseText = generateResponse(intent, result, activeMode);

        const assistantMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: responseText,
          timestamp: new Date().toISOString(),
          messageType: getMessageType(intent, result) as ChatMessage['messageType'],
          metadata: {
            ...getMetadata(intent, result),
            thinkingSteps: thinkingStepsRef.current,
            taskSteps: activeTaskStepsRef.current,
          },
        };

        chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, userMsg, assistantMsg]);
        setIsProcessing(false);
        setThinkingSteps([]);
        setActiveTaskSteps([]);
      }
    }, 300 + Math.random() * 200);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSession.activeMessages, chatSession.activeSessionId, activeMode]);

  // ===== 操作确认回调 =====
  const handleApprove = () => {
    if (!pendingApproval) return;
    const { intent, metaPlan } = pendingApproval;

    if (metaPlan) {
      const confirmMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: `✅ 确认执行 Meta-Agent 编排方案: ${pendingApproval.request.action}`,
        timestamp: new Date().toISOString(),
        messageType: 'text',
      };

      chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, confirmMsg]);
      setPendingApproval(null);
      setIsProcessing(true);

      (async () => {
        const results = await executeOrchestrationPlan(metaPlan);
        const responseText = formatMetaAgentResponse(metaPlan, results);
        const assistantMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: responseText,
          timestamp: new Date().toISOString(),
          messageType: getMetaAgentMessageType(metaPlan, results),
          metadata: {
            ...getMetaAgentMetadata(metaPlan, results),
            thinkingSteps: thinkingStepsRef.current,
            taskSteps: activeTaskStepsRef.current,
          },
        };
        chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, confirmMsg, assistantMsg]);
        setIsProcessing(false);
        setThinkingSteps([]);
        setActiveTaskSteps([]);
      })();
      return;
    }

    const taskSteps = generateTaskSteps(intent.action, intent.params);

    const confirmMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: `✅ 确认执行: ${pendingApproval.request.action}`,
      timestamp: new Date().toISOString(),
      messageType: 'text',
    };

    chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, confirmMsg]);
    setPendingApproval(null);
    setIsProcessing(true);

    executeAndRespond(intent, confirmMsg, taskSteps);
  };

  const handleReject = () => {
    if (!pendingApproval) return;

    const rejectMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: `已取消操作: **${pendingApproval.request.action}**\n\n如需重新执行，请再次描述你的需求。`,
      timestamp: new Date().toISOString(),
      messageType: 'text',
    };

    chatSession.updateSessionMessages(chatSession.activeSessionId, [...chatSession.activeMessages, rejectMsg]);
    setPendingApproval(null);
  };

  // ===== 事件处理 =====
  const handleSend = () => {
    if (inputValue.startsWith('/')) {
      const query = inputValue.slice(1).toLowerCase();
      const match = slashCommands.find(c => c.command.toLowerCase().includes(query));
      if (match) {
        handleSlashCommandSelect(match);
      }
      return;
    }
    processUserInput(inputValue);
  };

  const handleSuggestionClick = (suggestion: string) => {
    processUserInput(suggestion);
  };

  function getMessageType(intent: ParsedIntent, result: ActionResult): string {
    if (activeMode === 'plan') return 'text';
    if (intent.action === 'create_agent' && result.success) return 'agent_card';
    if (intent.action === 'create_workflow' && result.success) return 'workflow_preview';
    if (intent.clarification) return 'clarification';
    return 'text';
  }

  function getMetadata(intent: ParsedIntent, result: ActionResult): Record<string, any> {
    if (intent.action === 'create_agent' && result.success) {
      return { agentId: result.data?.agentId, agent: result.data?.agent };
    }
    if (intent.action === 'create_workflow' && result.success) {
      return { workflowId: result.data?.workflowId, workflow: result.data?.workflow };
    }
    if (intent.clarification) {
      return { clarification: intent.clarification, suggestions: getSuggestions(intent.action) };
    }
    return {};
  }

  function getSuggestions(action: string): string[] {
    switch (action) {
      case 'create_agent':
        return ['帮我创建一个文案写手Agent，用GPT-4o', '创建一个数据分析助手，加上搜索工具', '创建一个翻译Agent'];
      case 'create_workflow':
        return ['设计一个内容审核流程：搜索→AI判断→人工复审', '创建一个数据处理流程', '帮我编排一个自动翻译工作流'];
      default:
        return quickSuggestions;
    }
  }

  const insertRef = (text: string) => {
    setInputValue((prev) => (prev ? `${prev} ${text}` : text));
    setShowConnectorMenu(false);
  };

  return (
    <div className="flex-1 flex overflow-hidden h-full">
      {/* 主对话区 */}
      <div className="flex-1 flex flex-col bg-bg-secondary">
        <ChatHeader
          activeSession={chatSession.activeSession}
          sessions={chatSession.sessions}
          activeSessionId={chatSession.activeSessionId}
          activeMode={activeMode}
          lastUsedModel={lastUsedModel}
          routerEnabled={routerEnabled}
          defaultModelId={defaultModelId}
          channels={channels}
          showSessionMenu={showSessionMenu}
          setShowSessionMenu={setShowSessionMenu}
          onNewSession={chatSession.handleNewSession}
          onDeleteSession={chatSession.handleDeleteSession}
          onSwitchSession={chatSession.switchSession}
        />

        <ChatMessageList
          activeMessages={chatSession.activeMessages}
          activeMode={activeMode}
          isProcessing={isProcessing}
          thinkingSteps={thinkingSteps}
          streamingReasoning={streamingReasoning}
          activeTaskSteps={activeTaskSteps}
          multiAgentSteps={multiAgentSteps}
          pendingApproval={pendingApproval}
          onApprove={handleApprove}
          onReject={handleReject}
          onSuggestionClick={handleSuggestionClick}
          onWorkflowRefine={handleWorkflowRefine}
          projectName={projectDir.projectDir?.name || null}
          fileTree={projectDir.fileTree}
          selectedFiles={projectDir.selectedFiles}
          dirBusy={projectDir.dirBusy}
          dirError={projectDir.dirError}
          pendingChanges={projectDir.pendingChanges}
          onSelectDir={projectDir.selectProjectDir}
          onToggleFile={projectDir.toggleFile}
          onApplyChange={projectDir.applyChange}
          onSkipChange={projectDir.skipChange}
          onClearChanges={projectDir.clearChanges}
        />

        <ChatInputArea
          inputValue={inputValue}
          setInputValue={setInputValue}
          onSend={handleSend}
          isProcessing={isProcessing}
          activeMode={activeMode}
          showSlashMenu={showSlashMenu}
          setShowSlashMenu={setShowSlashMenu}
          onSlashSelect={handleSlashCommandSelect}
          uploadedFiles={fileUpload.uploadedFiles}
          onRemoveUploadedFile={fileUpload.removeUploadedFile}
          fileInputRef={fileUpload.fileInputRef}
          onFileSelect={fileUpload.handleFileSelect}
          showAttachMenu={fileUpload.showAttachMenu}
          setShowAttachMenu={fileUpload.setShowAttachMenu}
          showRefPicker={fileUpload.showRefPicker}
          setShowRefPicker={fileUpload.setShowRefPicker}
          refSelection={fileUpload.refSelection}
          setRefSelection={fileUpload.setRefSelection}
          conversationAttachments={fileUpload.conversationAttachments}
          onConfirmRefAttachments={fileUpload.confirmRefAttachments}
          channels={channels}
          defaultModelId={defaultModelId}
          routerEnabled={routerEnabled}
          setDefaultModelId={setDefaultModelId}
          setRouterEnabled={setRouterEnabled}
          showModelMenu={showModelMenu}
          setShowModelMenu={setShowModelMenu}
          showModeMenu={showModeMenu}
          setShowModeMenu={setShowModeMenu}
          onModeChange={setActiveMode}
          showConnectorMenu={showConnectorMenu}
          setShowConnectorMenu={setShowConnectorMenu}
          mcps={mcps}
          agents={agents}
          workflows={workflows}
          onInsertRef={insertRef}
          allowFullAccess={allowFullAccess}
          setAllowFullAccess={setAllowFullAccess}
        />
      </div>

      {/* 路由仪表盘 Overlay */}
      {showRouterDashboard && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-primary border border-border rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-text-primary">路由仪表盘</h2>
              <button
                onClick={() => setShowRouterDashboard(false)}
                className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <RouterDashboard />
          </div>
        </div>
      )}
    </div>
  );
}
