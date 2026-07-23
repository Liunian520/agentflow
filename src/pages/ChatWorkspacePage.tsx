import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Send, Plus, Sparkles, MessageSquare, Bot, Workflow,
  Trash2, ChevronLeft, ChevronRight, Lightbulb,
  Paperclip, FileText, X, Image as ImageIcon,
  Cpu, Zap, Plug, ShieldCheck,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn, generateId } from '../lib/utils';
import type {
  ChatMessage, ParsedIntent, ActionResult, Agent, Workflow as WorkflowType,
  AgentMode, ChatSession, TaskStep, ThinkingStep, ApprovalRequest, SlashCommand,
  OrchestrationPlan, FileAttachment,
} from '../types';
import { parseIntent } from '../components/chat/intent/IntentParser';
import { executeAction } from '../components/chat/intent/actionExecutor';
import { shouldUseMetaAgent, metaAgentOrchestrate, executeOrchestrationPlan } from '../components/chat/intent/MetaAgent';
import { recordExecutionTrace, findRelevantExperience, buildExperienceContext } from '../lib/experienceBank';
import { runReflection } from '../lib/metaSkillEvolver';
import { rolloutMultiplePlans, evaluatePlansQuality } from '../lib/multiTrajectoryRollout';
import { extractTaskFeatures } from '../lib/modelRouter';
import { designWorkflowFromDescription, modifyWorkflowWithDescription, applyWorkflowModification } from '../lib/llmWorkflowDesigner';
import { getMemoryManager } from '../lib/memory';
import { MEMORY_TOOL_SCHEMAS, executeMemoryTool } from '../lib/memory/selfEditing';
import { AgentCard } from '../components/chat/cards/AgentCard';
import { WorkflowPreview } from '../components/chat/cards/WorkflowPreview';
import { Clarification } from '../components/chat/cards/Clarification';
import { ModeSelector, getModeConfig } from '../components/chat/ModeSelector';
import { SlashCommandBar, slashCommands } from '../components/chat/SlashCommandBar';
import { TaskTracker, generateTaskSteps } from '../components/chat/TaskTracker';
import { ThinkingIndicator, generateThinkingSteps } from '../components/chat/ThinkingIndicator';
import { ApprovalPrompt, needsApproval } from '../components/chat/ApprovalPrompt';
import { MarkdownRenderer } from '../components/chat/MarkdownRenderer';
import { getAvailableChannelFromStore, routedChatLLMStream } from '../api/llmApi';
import { ProjectDirPanel, type FileNode, type FileChange } from '../components/chat/ProjectDirPanel';
import { RouterDashboard } from '../components/chat/cards/RouterDashboard';

/** 用户上传的文件，作为单次对话的上下文（与消息中持久化的 FileAttachment 同构） */
type UploadedFile = FileAttachment;

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
        return `## 分析结果\n\n我已经分析了你的请求，建议的操作是：**${intent.action}**。\n\n*当前为规划模式，仅提供分析建议。切换到编码模式后可执行操作。*`;
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
      return `你好！我是 AgentFlow 对话助手，支持以下功能：\n\n- **创建 Agent** — 输入 \`/create-agent\` 或"帮我创建一个xxx Agent"\n- **编排工作流** — 输入 \`/create-workflow\` 或"设计一个xxx工作流"\n- **查看列表** — 输入 \`/list\` 或"列出已有的Agent/工作流"\n- **运行工作流** — 输入 \`/run\` 或"运行xxx工作流"\n\n**模式切换**：顶部可切换 规划/编码/调试/编排 四种模式。\n\n试试下面的快捷建议吧！`;

    default:
      return intent.clarification || '我暂时无法理解你的请求，请尝试更详细地描述你想做什么。输入 `/help` 查看所有命令。';
  }
}

// ===== 主页面组件 =====

export function ChatWorkspacePage() {
  const { agents, workflows, metaSkill, channels, defaultModelId, routerEnabled, mcps } = useStore();

  // 最近一次路由决策使用的模型信息（来自 onRouting 回调）
  const [lastUsedModel, setLastUsedModel] = useState<{ provider: string; model: string; displayName?: string } | null>(null);

  // 模式状态
  const [activeMode, setActiveMode] = useState<AgentMode>('code');

  // 对话会话状态
  const CHAT_SESSIONS_KEY = 'agentflow.chatSessions.v1';
  const CHAT_ACTIVE_KEY = 'agentflow.chatActiveSession.v1';
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const raw = localStorage.getItem(CHAT_SESSIONS_KEY);
      if (raw) return JSON.parse(raw) as ChatSession[];
    } catch {
      // 忽略损坏的本地数据，回退到默认会话
    }
    return [
    {
      id: 'session-default',
      title: '新对话',
      messages: [
        {
          id: 'msg-welcome',
          role: 'assistant',
          content: `你好！我是 AgentFlow 对话助手 🤖\n\n支持 **五种工作模式**（顶栏可一键切换）：\n\n- **规划** — 只分析不执行，想清楚再动手\n- **编码** — 执行需确认，安全可靠\n- **调试** — 自动诊断修复问题\n- **编排** — 协调多 Agent 并行执行\n- **问答** — 纯问答，不执行任何操作\n\n💡 你还可以 **上传文件/代码** 作为对话上下文，或 **选择项目目录** 让 AI 直接读写你的文件。\n\n输入 \`/help\` 查看所有斜杠命令，或试试下面的快捷建议 👇`,
          timestamp: new Date().toISOString(),
          messageType: 'text',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: 'code',
    },
    ];
  });
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    return localStorage.getItem(CHAT_ACTIVE_KEY) || 'session-default';
  });
  // 持久化会话与当前会话 ID 到 localStorage，刷新后自动恢复
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(sessions));
    } catch {
      // 忽略配额超限等写入失败
    }
  }, [sessions]);
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_ACTIVE_KEY, activeSessionId);
    } catch {
      // 忽略写入失败
    }
  }, [activeSessionId]);
  const [inputValue, setInputValue] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  // 任务追踪状态
  const [activeTaskSteps, setActiveTaskSteps] = useState<TaskStep[]>([]);

  // 思考过程状态
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);

  // 操作确认状态
  const [pendingApproval, setPendingApproval] = useState<{
    request: ApprovalRequest;
    intent: ParsedIntent;
    metaPlan?: OrchestrationPlan;
  } | null>(null);

  // 斜杠命令菜单状态
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [showRouterDashboard, setShowRouterDashboard] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ===== 本机项目目录（A 路线：对话 AI 操作项目目录） =====
  const [projectDir, setProjectDir] = useState<{ handle: any; name: string } | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [dirBusy, setDirBusy] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<FileChange[]>([]);
  const streamContentRef = useRef('');

  // ===== 上传文件（作为对话上下文） =====
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 输入框「+」附件菜单：添加文件 / 引用对话中的文件
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showRefPicker, setShowRefPicker] = useState(false);
  const [refSelection, setRefSelection] = useState<string[]>([]);
  // 连接器下拉
  const [showConnectorMenu, setShowConnectorMenu] = useState(false);
  // 执行权限：允许完全访问（自动执行，跳过确认）
  const [allowFullAccess, setAllowFullAccess] = useState(false);
  // 用 ref 持有最新的 handleLLMStream，避免 processUserInput 因声明顺序/依赖问题拿到过期闭包
  const handleLLMStreamRef = useRef<((text: string, intent: ParsedIntent, userMsg: ChatMessage) => void) | null>(null);

  const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'out', '.idea', '.vscode']);
  const MAX_FILES = 300;

  const buildFileTree = async (
    handle: any,
    relPath = '',
    depth = 0,
    budget: { n: number } = { n: 0 },
  ): Promise<FileNode[]> => {
    if (depth > 5) return [];
    const nodes: FileNode[] = [];
    try {
      for await (const [name, entry] of (handle as any).entries()) {
        if (name.startsWith('.')) continue;
        if (entry.kind === 'directory') {
          if (IGNORE_DIRS.has(name)) continue;
          const children = depth < 3 ? await buildFileTree(entry, relPath ? `${relPath}/${name}` : name, depth + 1, budget) : [];
          nodes.push({ name, path: relPath ? `${relPath}/${name}` : name, isDir: true, children });
        } else {
          if (budget.n >= MAX_FILES) continue;
          budget.n += 1;
          nodes.push({ name, path: relPath ? `${relPath}/${name}` : name, isDir: false });
        }
      }
    } catch {
      /* 忽略无权限目录 */
    }
    nodes.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    return nodes;
  };

  const resolveFileHandle = async (dir: any, relPath: string): Promise<any> => {
    const segs = relPath.split('/').filter(Boolean);
    let cur = dir;
    for (let i = 0; i < segs.length - 1; i++) {
      cur = await cur.getDirectoryHandle(segs[i], { create: true });
    }
    return cur.getFileHandle(segs[segs.length - 1], { create: true });
  };

  const selectProjectDir = async () => {
    try {
      setDirBusy(true);
      setDirError(null);
      const handle = await (window as any).showDirectoryPicker();
      try {
        await handle.requestPermission?.({ mode: 'readwrite' });
      } catch {
        /* 已授权则忽略 */
      }
      const tree = await buildFileTree(handle, '', 0, { n: 0 });
      setProjectDir({ handle, name: handle.name });
      setFileTree(tree);
      setSelectedFiles(new Set());
    } catch (e: any) {
      if (e?.name !== 'AbortError') setDirError(e?.message || '选择目录失败');
    } finally {
      setDirBusy(false);
    }
  };

  const toggleFile = (path: string) => {
    setSelectedFiles((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  };

  const readSelectedContext = async (): Promise<string> => {
    if (!projectDir || selectedFiles.size === 0) return '';
    const parts: string[] = [];
    for (const path of selectedFiles) {
      try {
        const fileHandle = await resolveFileHandle(projectDir.handle, path);
        const file = await fileHandle.getFile();
        const content = await file.text();
        const ext = path.split('.').pop() || '';
        parts.push(`// 文件: ${path}\n\`\`\`${ext}\n${content}\n\`\`\``);
      } catch {
        /* 跳过无法读取的文件 */
      }
    }
    return parts.join('\n\n');
  };

  // 从 AI 回复中提取文件改动：```语言名:相对路径 ... ```
  const extractChanges = (text: string): FileChange[] => {
    const re = /```[\w-]*:\s*([^\n]+)\n([\s\S]*?)```/g;
    const out: FileChange[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const path = m[1].trim();
      const content = m[2];
      if (path && !out.find((c) => c.path === path)) {
        out.push({ path, content, status: 'pending' });
      }
    }
    return out;
  };

  const applyChange = async (c: FileChange) => {
    if (!projectDir) return;
    try {
      const fileHandle = await resolveFileHandle(projectDir.handle, c.path);
      const writable = await fileHandle.createWritable();
      await writable.write(c.content);
      await writable.close();
      setPendingChanges((prev) => prev.map((x) => (x.path === c.path ? { ...x, status: 'applied' } : x)));
    } catch (e: any) {
      setDirError(e?.message || '写回失败');
    }
  };

  const skipChange = (c: FileChange) => {
    setPendingChanges((prev) => prev.map((x) => (x.path === c.path ? { ...x, status: 'skipped' } : x)));
  };

  const clearChanges = () => setPendingChanges([]);

  // 上传文件：文本/代码读取内容，图片记录预览，其余仅记元数据
  const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|markdown|txt|py|php|html?|css|scss|sass|less|yml|yaml|env|toml|ini|sh|bash|sql|go|java|kt|rb|rs|vue|svelte|xml|csv|log|lock|gitignore|dockerfile)$/i;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (e.target) e.target.value = ''; // 允许重复选择同一文件
    files.forEach((file) => {
      const id = generateId();
      const isText = file.type.startsWith('text/') || TEXT_EXT.test(file.name);
      if (isText) {
        const reader = new FileReader();
        reader.onload = () => {
          setUploadedFiles((prev) => [
            ...prev,
            { id, name: file.name, size: file.size, type: file.type || 'text/plain', kind: 'text', content: String(reader.result || '') },
          ]);
        };
        reader.readAsText(file);
      } else if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          setUploadedFiles((prev) => [
            ...prev,
            { id, name: file.name, size: file.size, type: file.type, kind: 'image', preview: String(reader.result || '') },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        setUploadedFiles((prev) => [
          ...prev,
          { id, name: file.name, size: file.size, type: file.type || 'application/octet-stream', kind: 'other' },
        ]);
      }
    });
  };

  const removeUploadedFile = (id: string) =>
    setUploadedFiles((prev) => prev.filter((f) => f.id !== id));

  // 把上传文件拼成 system 上下文片段
  const readUploadedContext = (): string | null => {
    if (uploadedFiles.length === 0) return null;
    const parts = uploadedFiles.map((f) => {
      if (f.kind === 'text' && f.content != null) {
        const body = f.content.length > 20000 ? f.content.slice(0, 20000) + '\n…(已截断)' : f.content;
        return `【上传文件：${f.name}】\n\`\`\`\n${body}\n\`\`\``;
      }
      if (f.kind === 'image') return `【上传图片：${f.name}，${(f.size / 1024).toFixed(1)}KB】(如模型支持视觉输入可参考)`;
      return `【上传文件：${f.name}，${(f.size / 1024).toFixed(1)}KB，类型 ${f.type}】`;
    });
    return parts.join('\n\n');
  };

  // 引用对话中的文件：把勾选的历史附件加入当前上下文
  const confirmRefAttachments = () => {
    const picked = conversationAttachments.filter((a) => refSelection.includes(a.id));
    setUploadedFiles((prev) => {
      const existing = new Set(prev.map((f) => f.id));
      return [...prev, ...picked.filter((p) => !existing.has(p.id))];
    });
    setRefSelection([]);
    setShowRefPicker(false);
    setShowAttachMenu(false);
  };

  // 在输入框插入引用标记（@agent / @workflow / @mcp），对齐 WorkBuddy 的引用式交互
  const insertRef = (text: string) => {
    setInputValue((prev) => (prev ? `${prev} ${text}` : text));
    setShowConnectorMenu(false);
    textareaRef.current?.focus();
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const activeMessages = activeSession?.messages || [];

  // 从对话历史收集所有附件（用于「引用对话中的文件」）
  const conversationAttachments = useMemo(() => {
    const map = new Map<string, FileAttachment>();
    activeMessages.forEach((m) => (m.attachments || []).forEach((a) => {
      if (!map.has(a.id)) map.set(a.id, a);
    }));
    return Array.from(map.values());
  }, [activeMessages]);

  const modeConfig = getModeConfig(activeMode);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages, activeTaskSteps, thinkingSteps]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 128) + 'px';
    }
  }, [inputValue]);

  // ===== 斜杠命令处理 =====

  useEffect(() => {
    setShowSlashMenu(inputValue.startsWith('/') && inputValue.length < 30);
  }, [inputValue]);

  const handleSlashCommandSelect = (cmd: SlashCommand) => {
    setInputValue('');
    setShowSlashMenu(false);
    // 直接触发对应的意图
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
      updateSessionMessages(activeSessionId, [...activeMessages, helpMsg]);
      return;
    }

    // /reflect：基于历史失败经验触发 Meta-Skill 反思进化（Phase 3）
    if (cmd.id === 'reflect') {
      handleReflect();
      return;
    }

    // /optimize：对最近的需求做多轨迹展开选优（Phase 4）
    if (cmd.id === 'optimize') {
      const lastUser = [...activeMessages].reverse().find(m => m.role === 'user' && !m.content.startsWith('✅'));
      if (lastUser) {
        handleOptimize(lastUser.content);
      } else {
        appendAssistantMessage('请先描述你的需求（如"设计一个内容审核工作流"），然后再执行 `/optimize`。');
      }
      return;
    }

    // /router：打开路由仪表盘（ACRouter 自进化统计）
    if (cmd.id === 'router') {
      setShowRouterDashboard(true);
      return;
    }

    // /dream：触发 Auto Dream 四阶段跨会话记忆整合
    if (cmd.id === 'dream') {
      handleDreamCommand();
      return;
    }

    // /extract：手动触发 Auto Extraction
    if (cmd.id === 'extract') {
      handleExtractCommand();
      return;
    }

    // /memory：显示记忆架构统计
    if (cmd.id === 'memory') {
      handleMemoryStatsCommand();
      return;
    }

    const text = textMap[cmd.id] || cmd.label;
    processUserInput(text);
  };

  // ===== 核心处理逻辑（双层路由） =====

  const processUserInput = useCallback((text: string) => {
    if (!text.trim() || isProcessing) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
      messageType: 'text',
      // 把本次输入框中的附件随消息持久化，刷新/重新打开会话后仍在
      attachments: uploadedFiles.length > 0 ? uploadedFiles.map((f) => ({ ...f })) : undefined,
    };

    updateSessionMessages(activeSessionId, [...activeMessages, userMsg]);
    setInputValue('');
    setUploadedFiles([]);
    setIsProcessing(true);

    // 1. 快速层：IntentParser 关键词匹配
    const intent = parseIntent(text.trim());

    // 2. 双层路由决策：低置信度/复杂需求 → Meta-Agent；高置信度 → IntentParser 快速层
    const useMetaAgent = shouldUseMetaAgent(intent);

    if (useMetaAgent) {
      // Meta-Agent 深度层：LLM 驱动的三层编排
      handleMetaAgentOrchestrate(text.trim(), userMsg);
      return;
    }

    // 3. 快速层：生成思考步骤
    const thinking = generateThinkingSteps(intent.action, activeMode, intent.params);
    setThinkingSteps(thinking);

    // 4. 生成任务步骤
    const taskSteps = generateTaskSteps(intent.action, intent.params);
    setActiveTaskSteps(taskSteps);

    // 5. Ask 模式：纯问答，直接走 LLM 对话，不规划、不执行
    if (activeMode === 'ask') {
      handleLLMStreamRef.current?.(text.trim(), intent, userMsg);
      return;
    }

    // 6. Plan 模式：不执行，直接返回规划方案
    if (activeMode === 'plan') {
      setTimeout(() => {
        const responseText = generateResponse(intent, { success: true, type: 'plan' }, activeMode);

        setThinkingSteps(prev => prev.map(s => ({ ...s, content: s.content })));
        setActiveTaskSteps(prev => prev.map(s => ({ ...s, status: 'completed' as const })));

        const assistantMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: responseText,
          timestamp: new Date().toISOString(),
          messageType: 'text',
        };

        updateSessionMessages(activeSessionId, [...activeMessages, userMsg, assistantMsg]);
        setIsProcessing(false);
        setThinkingSteps([]);
        setActiveTaskSteps([]);
      }, 800);
      return;
    }

    // 7. 检查是否需要操作确认
    // 「允许完全访问」开启时跳过操作确认，与 WorkBuddy 的 auto-run 权限一致
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

    // 8. 无需确认：判断是否走 LLM 流式对话（纯对话/低置信度）
    if (intent.action === 'general_chat' || intent.confidence < 0.5) {
      handleLLMStreamRef.current?.(text.trim(), intent, userMsg);
      return;
    }

    // 9. 工作流设计/修改 → LLM 驱动（而非模板拼接）
    if (intent.action === 'create_workflow') {
      handleWorkflowDesign(text.trim(), userMsg);
      return;
    }
    if (intent.action === 'update_workflow' || intent.action === 'add_node' || intent.action === 'configure_node') {
      handleWorkflowModify(text.trim(), userMsg);
      return;
    }

    // 10. 其他操作类意图：直接执行
    executeAndRespond(intent, userMsg, taskSteps);
  }, [activeMessages, activeSessionId, activeMode, isProcessing]);

  // ===== 安全追加助手消息（避免异步竞态覆盖） =====
  const appendAssistantMessage = useCallback((content: string, messageType: ChatMessage['messageType'] = 'text') => {
    const msg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content,
      timestamp: new Date().toISOString(),
      messageType,
    };
    setSessions(prev => prev.map(s => {
      if (s.id !== activeSessionId) return s;
      const firstUserMsg = s.messages.find(m => m.role === 'user' && !m.content.startsWith('✅'));
      const title = firstUserMsg ? firstUserMsg.content.slice(0, 20) + (firstUserMsg.content.length > 20 ? '...' : '') : s.title;
      return { ...s, messages: [...s.messages, msg], title, updatedAt: new Date().toISOString(), mode: activeMode };
    }));
  }, [activeSessionId, activeMode]);

  // ===== LLM 驱动的工作流设计（对话创建） =====

  const handleWorkflowDesign = useCallback(async (userText: string, userMsg: ChatMessage) => {
    setThinkingSteps([{ id: generateId(), phase: 'analyzing', content: '正在理解你的工作流需求...', timestamp: new Date().toISOString() }]);
    setIsProcessing(true);

    try {
      const designResult = await designWorkflowFromDescription(userText);

      if (designResult.success) {
        // 创建工作流并写入 Store
        const workflowId = useStore.getState().createWorkflow(designResult.name);
        useStore.getState().updateWorkflow(workflowId, {
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
          metadata: { workflowId, workflow },
        };
        updateSessionMessages(activeSessionId, [...activeMessages, userMsg, assistantMsg]);
      } else {
        appendAssistantMessage(`⚠️ 工作流设计失败：${designResult.error || '未知错误'}。请尝试更详细的描述，如"设计一个内容审核流程：接收文本→AI判断→人工复审→输出结果"。`);
      }
    } catch (error: any) {
      appendAssistantMessage(`⚠️ 工作流设计异常：${error.message || '未知错误'}`);
    } finally {
      setIsProcessing(false);
      setThinkingSteps([]);
    }
  }, [activeMessages, activeSessionId]);

  // ===== LLM 驱动的工作流修改（对话追加） =====

  const handleWorkflowModify = useCallback(async (userText: string, userMsg: ChatMessage) => {
    setThinkingSteps([{ id: generateId(), phase: 'planning', content: '正在根据你的要求修改工作流...', timestamp: new Date().toISOString() }]);
    setIsProcessing(true);

    // 找到最近创建的工作流（或当前选中的）
    const currentWfId = useStore.getState().currentWorkflowId;
    const recentWorkflowMsg = [...activeMessages].reverse().find(m => m.messageType === 'workflow_preview' && m.metadata?.workflowId);
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
          metadata: { workflowId: targetWorkflowId, workflow: updatedWorkflow },
        };
        updateSessionMessages(activeSessionId, [...activeMessages, userMsg, assistantMsg]);
      } else {
        appendAssistantMessage(`⚠️ 工作流修改失败：${modifyResult.error || 'LLM 无法解析修改指令'}。请尝试更明确的描述，如"在AI判断后加一个条件分支"。`);
      }
    } catch (error: any) {
      appendAssistantMessage(`⚠️ 工作流修改异常：${error.message || '未知错误'}`);
    } finally {
      setIsProcessing(false);
      setThinkingSteps([]);
    }
  }, [activeMessages, activeSessionId]);

  // ===== 工作流细化快捷入口 =====
  const handleWorkflowRefine = useCallback((_workflowId: string) => {
    // 将细化提示词填入输入框，聚焦（_workflowId 保留供将来精确匹配）
    setInputValue('继续细化这个工作流：');
    textareaRef.current?.focus();
  }, []);

  // ===== 计算 outcome 并记录轨迹到 Experience Bank =====
  const recordPlanTrace = useCallback((userInput: string, plan: OrchestrationPlan, results: ActionResult[]): 'success' | 'partial' | 'failure' => {
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
    return outcome;
  }, []);

  // ===== 失败后触发反思进化（Phase 3） =====
  const maybeReflectAndNotify = useCallback(async () => {
    const store = useStore.getState();
    const refl = await runReflection(store.experienceBank, store.metaSkill);
    if (refl.evolved) {
      store.updateMetaSkill(refl.newSkill);
      appendAssistantMessage(
        `🧬 **Meta-Skill 已进化至 v${refl.newSkill.version}**\n\n${refl.summary}\n\n_触发原因：${refl.reason}_`
      );
    }
  }, [appendAssistantMessage]);

  // ===== 统一落地 Meta-Agent 编排计划 =====
  // 负责：审批判定 → 执行 → 记录真实轨迹 → 失败后反思进化
  const finalizeMetaPlan = useCallback(async (plan: OrchestrationPlan, userInput: string, userMsg: ChatMessage) => {
    // 检查是否需要操作确认（允许完全访问时跳过）
    const approval = allowFullAccess ? null : needsApproval(plan.intent as any, activeMode);
    if (approval && (plan.agents.length > 0 || plan.workflow)) {
      const request: ApprovalRequest = {
        id: generateId(),
        action: plan.intent as string,
        description: `Meta-Agent 计划创建 ${plan.agents.length} 个 Agent 和 ${plan.workflow ? '1 个工作流' : '0 个工作流'}`,
        riskLevel: 'medium',
        details: {
          编排推理: plan.reasoning.slice(0, 200) || '-',
          Agent数量: String(plan.agents.length),
          工作流节点: String(plan.workflow?.nodes.length || 0),
        },
      };

      setThinkingSteps([]);
      setActiveTaskSteps([]);
      setPendingApproval({ request, intent: plan as any, metaPlan: plan });
      setIsProcessing(false);
      return;
    }

    // 直接执行编排计划
    const results = await executeOrchestrationPlan(plan);

    // 生成响应文本
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
    updateSessionMessages(activeSessionId, [...activeMessages, userMsg, assistantMsg]);
    setIsProcessing(false);

    // 记录真实执行轨迹（依据结果判定 outcome，而非预设 success）
    const outcome = recordPlanTrace(userInput, plan, results);

    // 失败后触发 Selective Reflection（Phase 3）
    if (outcome !== 'success') {
      await maybeReflectAndNotify();
    }
  }, [activeMessages, activeSessionId, activeMode, recordPlanTrace, maybeReflectAndNotify]);

  // ===== Meta-Agent 编排处理（深度层） =====
  const handleMetaAgentOrchestrate = useCallback(async (text: string, userMsg: ChatMessage) => {
    const store = useStore.getState();
    const metaSkill = store.metaSkill;
    const bank = store.experienceBank;

    // 检索相关经验（Phase 2：为 LLM 提供历史成功案例参考）
    const relevantExp = findRelevantExperience(text, bank);
    const expContext = buildExperienceContext(relevantExp);

    // Phase 10: Dynamic Recall — 从 L1/L2-A 按需召回
    const memoryManager = getMemoryManager();
    const { recalledContext, sessionMemoryContext } = await memoryManager.onLLMCall(activeSessionId, text, activeMessages);

    // 把用户上传/引用的文件作为上下文注入 Meta-Agent
    const uploadedContext = readUploadedContext();

    // 生成思考过程
    const thinking = generateThinkingSteps('smart_orchestrate', activeMode, {});
    setThinkingSteps(thinking);

    // 调用 Meta-Agent 进行三层编排（经验 + Dynamic Recall + 上传文件 注入）
    const plan = await metaAgentOrchestrate(text, metaSkill, {
      experienceContext: expContext,
      recalledMemoryContext: recalledContext,
      sessionMemoryContext: [sessionMemoryContext, uploadedContext ? `【用户上传/引用的文件】\n${uploadedContext}` : '']
        .filter(Boolean).join('\n\n'),
    });

    // Plan 模式：只展示编排方案，不执行、不记录轨迹
    if (activeMode === 'plan') {
      const responseText = `# 编排规划方案（Meta-Agent）

${plan.reasoning || '已分析你的需求，制定以下方案：'}

## 子任务
${plan.subTasks.length > 0
    ? plan.subTasks.map((t, i) => `${i + 1}. ${t.action} — ${JSON.stringify(t.params).slice(0, 80)}`).join('\n')
    : '无需分解，直接执行'}

## Agent 设计
${plan.agents.length > 0
    ? plan.agents.map((a, i) => `${i + 1}. **${a.name}** — 模型: \`${a.model}\`, 工具: ${a.tools.join(', ') || '无'}`).join('\n')
    : '无需创建 Agent'}

## 工作流编排
${plan.workflow
    ? `**${plan.workflow.name}** — ${plan.workflow.nodes.length} 个节点\n${plan.workflow.nodes.map((n, i) => `  ${i + 1}. ${n.name} (${n.type})`).join('\n')}`
    : '无需创建工作流'}

*当前为规划模式，不会执行创建操作。切换到编码模式后可落地。*`;

      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: responseText,
        timestamp: new Date().toISOString(),
        messageType: 'text',
      };

      setThinkingSteps([]);
      setActiveTaskSteps([]);
      updateSessionMessages(activeSessionId, [...activeMessages, userMsg, assistantMsg]);
      setIsProcessing(false);
      return;
    }

    // 落地执行（含确认 / 直接执行 / 轨迹记录 / 反思进化）
    await finalizeMetaPlan(plan, text, userMsg);
  }, [activeMessages, activeSessionId, activeMode, finalizeMetaPlan]);

  // ===== /reflect 手动触发反思进化（Phase 3） =====
  // ===== /dream 记忆整合命令（Phase 10 Auto Dream） =====
  const handleDreamCommand = useCallback(async () => {
    const { handleDreamCommand: dreamCmd } = await import('../lib/memory/autoDream');
    const result = await dreamCmd();
    appendAssistantMessage(
      `🌙 **Auto Dream 记忆整合**\n\n${result.message}\n\n` +
      (result.log ? `合并: ${result.log.changes.factualMerged}条 | 蒸馏: ${result.log.changes.tracesConsolidated}条 | 修剪: ${result.log.changes.factualPruned}条 | Reflection: ${result.log.changes.reflectionsMerged}条` : '')
    );
  }, [appendAssistantMessage]);

  // ===== /extract 手动提取命令（Phase 10 Auto Extraction） =====
  const handleExtractCommand = useCallback(async () => {
    const { runAutoExtraction } = await import('../lib/memory/autoExtraction');
    const currentMessages = sessions.find(s => s.id === activeSessionId)?.messages || [];
    const result = await runAutoExtraction(activeSessionId, currentMessages);
    appendAssistantMessage(
      `💡 **Auto Extraction 手动提取**\n\n` +
      `方法: ${result.method}\n` +
      `提取数量: ${result.extracted.length}条\n\n` +
      (result.extracted.length > 0
        ? result.extracted.map(m => `- [${m.type}] ${m.content.slice(0, 80)}`).join('\n')
        : '当前对话中没有可提取的事实')
    );
  }, [appendAssistantMessage, activeSessionId, sessions]);

  // ===== /memory 统计命令（Phase 10 记忆架构） =====
  const handleMemoryStatsCommand = useCallback(() => {
    const stats = getMemoryManager().getMemoryStats();
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

  const handleReflect = useCallback(async () => {
    const store = useStore.getState();
    const refl = await runReflection(store.experienceBank, store.metaSkill);
    if (refl.evolved) {
      store.updateMetaSkill(refl.newSkill);
    }
    appendAssistantMessage(
      `🧬 **Meta-Skill 反思进化**（当前 v${store.metaSkill.version}）\n\n` +
      `${refl.evolved ? `✅ 已进化至 **v${refl.newSkill.version}**` : '⏸ 暂未触发进化（失败样本不足）'}\n\n` +
      `${refl.summary}\n\n_${refl.reason}_`
    );
  }, [appendAssistantMessage]);

  // ===== /optimize 多轨迹展开选优（Phase 4） =====
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
    updateSessionMessages(activeSessionId, [...activeMessages, userMsg]);
    setInputValue('');
    setIsProcessing(true);
    setThinkingSteps(generateThinkingSteps('smart_orchestrate', activeMode, {}));

    // 1. 多轨迹展开
    const plans = await rolloutMultiplePlans(text, metaSkill, expContext, 3);
    if (plans.length === 0) {
      appendAssistantMessage('⚠️ 多轨迹展开失败，可能未配置 LLM 渠道或网络异常。');
      setIsProcessing(false);
      setThinkingSteps([]);
      return;
    }

    // 2. 评估选优
    const { scores, bestIndex } = await evaluatePlansQuality(plans, text);
    const bestPlan = plans[bestIndex] || plans[0];

    // 3. 展示候选对比
    const compareText = `## 🔀 多轨迹展开结果（${plans.length} 个候选）

${plans.map((p, i) => {
      const agents = p.agents.length > 0 ? p.agents.map(a => a.name).join('、') : '无';
      const wf = p.workflow ? `${p.workflow.nodes.length} 节点` : '无';
      const mark = i === bestIndex ? ' ⭐ **最优**' : '';
      return `${i + 1}. 评分 **${scores[i]?.toFixed?.(1) ?? scores[i]}** — Agent: ${agents} | 工作流: ${wf}${mark}`;
    }).join('\n')}

已自动选用最优方案，请确认后落地。`;

    const compareMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: compareText,
      timestamp: new Date().toISOString(),
      messageType: 'text',
    };
    updateSessionMessages(activeSessionId, [...activeMessages, userMsg, compareMsg]);
    setThinkingSteps([]);

    // 4. 走统一落地流程（最优方案）
    if (activeMode === 'plan') {
      const planText = `# 编排规划方案（Meta-Agent · 最优）

${bestPlan.reasoning || '已分析你的需求，制定以下方案：'}

## Agent 设计
${bestPlan.agents.length > 0 ? bestPlan.agents.map((a, i) => `${i + 1}. **${a.name}** — 模型: \`${a.model}\`, 工具: ${a.tools.join(', ') || '无'}`).join('\n') : '无需创建 Agent'}

## 工作流编排
${bestPlan.workflow ? `**${bestPlan.workflow.name}** — ${bestPlan.workflow.nodes.length} 个节点\n${bestPlan.workflow.nodes.map((n, i) => `  ${i + 1}. ${n.name} (${n.type})`).join('\n')}` : '无需创建工作流'}

*规划模式，不会执行。切换到编码模式后落地。*`;
      const planMsg: ChatMessage = { id: generateId(), role: 'assistant', content: planText, timestamp: new Date().toISOString(), messageType: 'text' };
      updateSessionMessages(activeSessionId, [...activeMessages, userMsg, compareMsg, planMsg]);
      setIsProcessing(false);
      return;
    }

    await finalizeMetaPlan(bestPlan, text, userMsg);
  }, [activeMessages, activeSessionId, activeMode, finalizeMetaPlan, appendAssistantMessage]);

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
  const streamAbortRef = useRef<AbortController | null>(null);

  const handleLLMStream = useCallback(async (text: string, intent: ParsedIntent, userMsg: ChatMessage) => {
    streamContentRef.current = '';
    const channelInfo = await getAvailableChannelFromStore();

    if (!channelInfo) {
      // 没有可用渠道，使用模板回复
      const responseText = generateResponse(intent, { success: true, type: 'general_chat' }, activeMode);
      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: responseText + '\n\n> ⚠️ 当前未配置 LLM 渠道，此回复为预设模板。请在「渠道设置」中添加 API Key 以获得 AI 驱动的对话体验。',
        timestamp: new Date().toISOString(),
        messageType: 'text',
      };
      updateSessionMessages(activeSessionId, [...activeMessages, userMsg, assistantMsg]);
      setIsProcessing(false);
      setThinkingSteps([]);
      setActiveTaskSteps([]);
      return;
    }

    // 创建流式响应的占位消息
    const streamMsgId = generateId();
    const streamMsg: ChatMessage = {
      id: streamMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      messageType: 'text',
    };

    // 先添加占位消息到对话流
    updateSessionMessages(activeSessionId, [...activeMessages, userMsg, streamMsg]);

    // 组装系统提示词（Phase 10: 注入 Session Memory 固定前缀 + 自动上下文压缩）
    const memoryManager = getMemoryManager();
    const { sessionMemoryContext, compactedMessages } = await memoryManager.onLLMCall(activeSessionId, text, activeMessages);
    const sessionPrefix = sessionMemoryContext ? `\n${sessionMemoryContext}\n` : '';

    const systemPrompt = `${sessionPrefix}你是 AgentFlow 的对话助手，支持以下能力：
- 创建、修改、查看 Agent（AI助手）
- 创建、编排、运行工作流
- 管理 SSH 远程主机连接
- 查看系统状态

当前用户处于 ${activeMode} 模式：
- plan 模式：只分析规划，不执行操作
- code 模式：需确认后执行
- debug 模式：侧重诊断和修复
- orchestrator 模式：协调多任务并行
- ask 模式：纯问答，不执行、不规划任何操作，只回答用户问题

当前系统信息：
- Agent 数量: ${useStore.getState().agents.length}
- 工作流数量: ${useStore.getState().workflows.length}
- 可用模型: ${channelInfo.models.map(m => m.displayName).join(', ')}

请根据用户的问题给出专业、简洁的回答。如需创建/修改对象，建议用户使用斜杠命令或更明确的指令。`;

    // 注入本机项目目录上下文（A 路线）+ 上传文件上下文
    const projectContext = await readSelectedContext();
    const uploadedContext = readUploadedContext();
    const contextParts: string[] = [];
    if (projectContext) {
      contextParts.push(
        `【当前项目目录：${projectDir?.name}】以下是用户选中的项目文件，你可以阅读它们来理解项目结构。\n当用户需要新增或修改文件时，请用如下格式输出完整文件内容（语言名可选，冒号后是相对路径），用户确认后会自动写回对应文件：\n\`\`\`语言名:相对路径\n...完整文件内容...\n\`\`\`\n\n项目文件内容：\n${projectContext}`,
      );
    }
    if (uploadedContext) {
      contextParts.push(
        `【用户上传的文件】以下文件由用户上传，作为本次对话的上下文参考（非项目目录文件，无需写回）：\n${uploadedContext}`,
      );
    }
    const contextMsg = contextParts.length > 0 ? contextParts.join('\n\n') : null;

    // 工具调用日志（在流式过程中累计，最终回复前展示）
    const toolLog = { text: '' };

    // 发起 SSE 流式调用（ACRouter 路由：自动选最优模型 + 反馈回写）
    // Phase 10 Self-Editing: 注入记忆管理工具，Agent 可通过 function calling 自管理 L1 记忆
    const memoryTools = MEMORY_TOOL_SCHEMAS.map(schema => ({
      type: 'function',
      function: schema,
    }));
    // Phase 10 自动上下文压缩：如果 onLLMCall 返回了 compactedMessages，使用压缩后的消息
    // 否则取最近 6 条（滑动窗口）
    const effectiveMessages = compactedMessages
      ? compactedMessages.map(m => ({
          role: (m.role === 'system' || m.role === 'tool' ? 'assistant' : m.role) as 'user' | 'assistant' | 'system' | 'tool',
          content: m.content,
        }))
      : activeMessages.slice(-6).map(m => ({
          role: (m.role === 'system' || m.role === 'tool' ? 'assistant' : m.role) as 'user' | 'assistant' | 'system' | 'tool',
          content: m.content,
        }));

    const abortController = routedChatLLMStream(
      {
        messages: ([
          { role: 'system' as const, content: systemPrompt },
          ...(contextMsg ? [{ role: 'system' as const, content: contextMsg }] : []),
          ...effectiveMessages,
          { role: 'user' as const, content: text },
        ]) as Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>,
        temperature: activeMode === 'debug' ? 0.3 : activeMode === 'ask' ? 0.5 : 0.7,
        maxTokens: 2048,
        tools: memoryTools,
      },
      extractTaskFeatures(text, { intent: 'general_chat', mode: activeMode }),
      {
        onRouting: (decision) => {
          // 更新模型指示器
          setLastUsedModel({
            provider: decision.provider,
            model: decision.modelName,
            displayName: decision.modelDisplayName || decision.modelName,
          });
        },
        onStart: () => {
          // 开始收到流式数据
        },
        onTool: (data) => {
          // Phase 10 Self-Editing: 如果是 memory 工具，立即执行并显示结果
          if (data.name.startsWith('memory_')) {
            if (data.status === 'running') {
              toolLog.text += (toolLog.text ? '\n' : '') + `🔧 调用记忆工具 \`${data.name}\` …`;
            } else if (data.status === 'done' && data.result) {
              // 解析并执行 memory 工具
              try {
                const args = JSON.parse(data.result);
                const result = executeMemoryTool(data.name, args);
                const resultMsg = result.success ? `✅ ${result.message}` : `❌ ${result.message}`;
                toolLog.text += (toolLog.text ? '\n' : '') + resultMsg;
              } catch {
                toolLog.text += (toolLog.text ? '\n' : '') + `✅ 记忆工具 \`${data.name}\` 完成`;
              }
            }
          } else {
            const line =
              data.status === 'running'
                ? `🔧 调用工具 \`${data.name}\` …`
                : `✅ 工具 \`${data.name}\` 完成`;
            toolLog.text += (toolLog.text ? '\n' : '') + line;
          }
          const prefix = toolLog.text ? toolLog.text + '\n\n' : '';
          setSessions((prev) => prev.map((s) => {
            if (s.id !== activeSessionId) return s;
            return {
              ...s,
              messages: s.messages.map((m) =>
                m.id === streamMsgId ? { ...m, content: prefix } : m
              ),
            };
          }));
        },
        onDelta: (data) => {
          streamContentRef.current = data.fullContent || '';
          // 实时更新占位消息内容（保留工具调用日志前缀）
          const prefix = toolLog.text ? toolLog.text + '\n\n' : '';
          const currentContent = prefix + (data.fullContent || '');
          setSessions((prev) => prev.map((s) => {
            if (s.id !== activeSessionId) return s;
            return {
              ...s,
              messages: s.messages.map((m) =>
                m.id === streamMsgId ? { ...m, content: currentContent } : m
              ),
            };
          }));
        },
        onDone: () => {
          setIsProcessing(false);
          setThinkingSteps([]);
          setActiveTaskSteps([]);
          streamAbortRef.current = null;
          // 从 AI 回复中提取文件改动（A 路线：本机目录写回）
          if (projectDir && streamContentRef.current) {
            const extracted = extractChanges(streamContentRef.current);
            if (extracted.length > 0) {
              setPendingChanges((prev) => [
                ...prev,
                ...extracted.filter((e) => !prev.find((p) => p.path === e.path)),
              ]);
            }
          }
          streamContentRef.current = '';

          // Phase 10: 记忆架构 — 每轮对话后触发 Auto Extraction + Session Memory 更新
          const currentMessages = sessions.find(s => s.id === activeSessionId)?.messages || [];
          getMemoryManager().onTurnComplete(activeSessionId, currentMessages);
        },
        onError: (data) => {
          // 流式出错，更新占位消息为错误信息
          setSessions(prev => prev.map(s => {
            if (s.id !== activeSessionId) return s;
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
        },
      }
    );

    streamAbortRef.current = abortController;
  }, [activeMessages, activeSessionId, activeMode, projectDir, selectedFiles, uploadedFiles]);

  handleLLMStreamRef.current = handleLLMStream;

  const executeAndRespond = useCallback((intent: ParsedIntent, userMsg: ChatMessage, initialSteps: TaskStep[]) => {
    // 模拟分步执行
    const totalSteps = initialSteps.length;
    let currentStep = 0;

    const stepInterval = setInterval(() => {
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

        // 执行操作
        const result = executeAction(intent);
        const responseText = generateResponse(intent, result, activeMode);

        const assistantMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: responseText,
          timestamp: new Date().toISOString(),
          messageType: getMessageType(intent, result) as ChatMessage['messageType'],
          metadata: getMetadata(intent, result),
        };

        updateSessionMessages(activeSessionId, [...activeMessages, userMsg, assistantMsg]);
        setIsProcessing(false);
        setThinkingSteps([]);

        // 延迟清除任务步骤（让用户看到完成状态）
        setTimeout(() => setActiveTaskSteps([]), 2000);
      }
    }, 300 + Math.random() * 200);
  }, [activeMessages, activeSessionId, activeMode]);

  // ===== 操作确认回调 =====

  const handleApprove = () => {
    if (!pendingApproval) return;
    const { intent, metaPlan } = pendingApproval;

    // Meta-Agent 编排计划确认 → 执行 OrchestrationPlan
    if (metaPlan) {
      const confirmMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: `✅ 确认执行 Meta-Agent 编排方案: ${pendingApproval.request.action}`,
        timestamp: new Date().toISOString(),
        messageType: 'text',
      };

      updateSessionMessages(activeSessionId, [...activeMessages, confirmMsg]);
      setPendingApproval(null);
      setIsProcessing(true);

      // 直接执行编排计划
      (async () => {
        const results = await executeOrchestrationPlan(metaPlan);
        const responseText = formatMetaAgentResponse(metaPlan, results);
        const assistantMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: responseText,
          timestamp: new Date().toISOString(),
          messageType: getMetaAgentMessageType(metaPlan, results),
          metadata: getMetaAgentMetadata(metaPlan, results),
        };
        updateSessionMessages(activeSessionId, [...activeMessages, confirmMsg, assistantMsg]);
        setIsProcessing(false);
        setThinkingSteps([]);
        setActiveTaskSteps([]);
      })();
      return;
    }

    // 普通意图确认 → 执行 ParsedIntent
    const taskSteps = generateTaskSteps(intent.action, intent.params);

    // 添加用户确认消息
    const confirmMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: `✅ 确认执行: ${pendingApproval.request.action}`,
      timestamp: new Date().toISOString(),
      messageType: 'text',
    };

    updateSessionMessages(activeSessionId, [...activeMessages, confirmMsg]);
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

    updateSessionMessages(activeSessionId, [...activeMessages, rejectMsg]);
    setPendingApproval(null);
  };

  // ===== 事件处理 =====

  const handleSend = () => {
    if (inputValue.startsWith('/')) {
      // 如果是斜杠命令但还没选完，取第一个匹配
      const query = inputValue.slice(1).toLowerCase();
      const match = slashCommands.find(c => c.command.toLowerCase().includes(query));
      if (match) {
        handleSlashCommandSelect(match);
      }
      return;
    }
    processUserInput(inputValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlashMenu) return; // SlashCommandBar handles its own keys
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    processUserInput(suggestion);
  };

  const handleNewSession = () => {
    const newSession: ChatSession = {
      id: `session-${generateId()}`,
      title: '新对话',
      messages: [
        {
          id: `msg-${generateId()}`,
          role: 'assistant',
          content: '开始新的对话！告诉我你想做什么。\n\n输入 `/help` 查看所有命令。',
          timestamp: new Date().toISOString(),
          messageType: 'text',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: activeMode,
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);

    // Phase 10: 记忆架构 — 创建 Session Memory
    getMemoryManager().onSessionStart(newSession.id);
  };

  const handleDeleteSession = (sessionId: string) => {
    // Phase 10: 记忆架构 — 清理 Session Memory
    getMemoryManager().onSessionEnd(sessionId);
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      const remaining = sessions.filter(s => s.id !== sessionId);
      setActiveSessionId(remaining[0]?.id || 'session-default');
    }
  };

  const updateSessionMessages = (sessionId: string, messages: ChatMessage[]) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const firstUserMsg = messages.find(m => m.role === 'user' && !m.content.startsWith('✅'));
      const title = firstUserMsg
        ? firstUserMsg.content.slice(0, 20) + (firstUserMsg.content.length > 20 ? '...' : '')
        : s.title;
      return { ...s, messages, title, updatedAt: new Date().toISOString(), mode: activeMode };
    }));
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

  // ===== 渲染消息内容 =====

  const renderMessageContent = (msg: ChatMessage) => {
    // 操作确认卡片 — 最后一条 assistant 消息且待审批时，只显示审批提示
    if (pendingApproval && msg.id === activeMessages[activeMessages.length - 1]?.id && msg.role === 'assistant') {
      return <ApprovalPrompt request={pendingApproval.request} onApprove={handleApprove} onReject={handleReject} />;
    }

    if (msg.messageType === 'agent_card' && msg.metadata?.agent) {
      return (
        <div className="space-y-2">
          <MarkdownRenderer content={msg.content} />
          <AgentCard agent={msg.metadata.agent} />
        </div>
      );
    }

    if (msg.messageType === 'workflow_preview' && msg.metadata?.workflow) {
      return (
        <div className="space-y-2">
          <MarkdownRenderer content={msg.content} />
          <WorkflowPreview workflow={msg.metadata.workflow} onRefine={handleWorkflowRefine} />
        </div>
      );
    }

    if (msg.messageType === 'clarification' && msg.metadata?.clarification) {
      return (
        <div className="space-y-2">
          <Clarification
            message={msg.metadata.clarification}
            suggestions={msg.metadata.suggestions || quickSuggestions}
            onSelect={(suggestion: string) => handleSuggestionClick(suggestion)}
          />
        </div>
      );
    }

    return <MarkdownRenderer content={msg.content} />;
  };

  // ===== 页面渲染 =====

  return (
    <div className="flex-1 flex overflow-hidden h-full">
      {/* 侧栏 */}
      <div className={cn(
        'hidden md:flex flex-col bg-white border-r border-border transition-all duration-300',
        sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'
      )}>
        <div className="h-14 flex items-center justify-between px-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" />
            <span className="font-semibold text-text-primary">对话工作台</span>
          </div>
          <button
            onClick={handleNewSession}
            className="p-1.5 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors active:scale-[0.98]"
            title="新建对话"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => setActiveSessionId(session.id)}
              className={cn(
                'w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors group',
                activeSessionId === session.id
                  ? 'bg-accent-bg'
                  : 'hover:bg-bg-secondary'
              )}
            >
              <MessageSquare className="w-4 h-4 text-text-tertiary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-primary truncate">{session.title}</div>
                <div className="text-xs text-text-tertiary">
                  {session.messages.length} 条 · {session.mode || 'code'} 模式
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }}
                className="p-1 rounded-md text-text-tertiary hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                title="删除对话"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-border space-y-2">
          <div className="text-xs font-medium text-text-tertiary uppercase tracking-wider">快捷入口</div>
          <button
            onClick={() => {/* navigate to workflows */}}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors"
          >
            <Workflow className="w-4 h-4" />
            工作流列表 ({workflows.length})
          </button>
          <button
            onClick={() => {/* navigate to agents */}}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors"
          >
            <Bot className="w-4 h-4" />
            Agent 列表 ({agents.length})
          </button>
        </div>
      </div>

      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="hidden md:flex items-center justify-center w-6 bg-bg-secondary border-r border-border hover:bg-bg-hover transition-colors"
      >
        {sidebarOpen ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      {/* 主对话区 */}
      <div className="flex-1 flex flex-col bg-bg-secondary">
        {/* 顶栏 — 模式选择器 + 模型指示器 */}
        <div className="h-14 bg-white border-b border-border flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-accent" />
            <span className="font-semibold text-text-primary">
              {activeSession?.title || '对话工作台'}
            </span>
            <span className={cn(
              'px-2 py-0.5 text-xs font-medium rounded-full',
              activeMode === 'plan' ? 'bg-amber-50 text-amber-600' :
              activeMode === 'code' ? 'bg-violet-50 text-violet-600' :
              activeMode === 'debug' ? 'bg-red-50 text-red-600' :
              activeMode === 'ask' ? 'bg-emerald-50 text-emerald-600' :
              'bg-blue-50 text-blue-600'
            )}>
              {modeConfig.icon} {modeConfig.label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* 模型指示器 */}
            {lastUsedModel ? (
              <span
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-violet-50 text-violet-700 border border-violet-200 cursor-default"
                title={`当前模型: ${lastUsedModel.model} (${lastUsedModel.provider})`}
              >
                <Cpu className="w-3 h-3" />
                {lastUsedModel.displayName || lastUsedModel.model}
              </span>
            ) : routerEnabled ? (
              <span
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default"
                title="ACRouter 智能路由已启用，将根据任务自动选模型"
              >
                <Zap className="w-3 h-3" />
                自动路由
              </span>
            ) : defaultModelId ? (
              <span
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-blue-50 text-blue-700 border border-blue-200 cursor-default"
                title={`固定模型: ${defaultModelId}`}
              >
                <Cpu className="w-3 h-3" />
                {(() => {
                  const [chId, modelName] = defaultModelId.split(':');
                  const ch = channels.find(c => c.id === chId);
                  const m = ch?.models.find(m => m.name === modelName);
                  return m?.displayName || modelName;
                })()}
              </span>
            ) : null}
            <ModeSelector activeMode={activeMode} onModeChange={setActiveMode} />
            <span
              className="hidden sm:flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-bg-secondary text-text-tertiary border border-border"
              title="Meta-Skill 编排策略版本，随反思进化自动升级"
            >
              🧬 v{metaSkill.version}
            </span>
            <button
              onClick={handleNewSession}
              className="p-2 text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors md:hidden"
              title="新建对话"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 消息区 */}
        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-8 md:py-6">
          {/* 本机项目目录面板（A 路线：对话 AI 操作项目目录） */}
          <ProjectDirPanel
            projectName={projectDir?.name || null}
            fileTree={fileTree}
            selected={selectedFiles}
            dirBusy={dirBusy}
            dirError={dirError}
            changes={pendingChanges}
            onSelectDir={selectProjectDir}
            onToggleFile={toggleFile}
            onApplyChange={applyChange}
            onSkipChange={skipChange}
            onClearChanges={clearChanges}
          />

          <div className="max-w-3xl mx-auto space-y-4">
            {/* 首次欢迎区 */}
            {activeMessages.length <= 1 && !isProcessing && !pendingApproval && (
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center mx-auto mb-4 shadow-lg">
                  <Sparkles className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-xl font-semibold text-text-primary mb-2">对话式编程工作台</h2>
                <p className="text-sm text-text-secondary mb-2 max-w-md mx-auto">
                  用自然语言创建 Agent、编排工作流、管理配置。
                </p>
                <div className="inline-flex items-center gap-1 px-3 py-1 bg-violet-50 text-violet-600 rounded-full text-xs font-medium mb-4">
                  当前模式: {modeConfig.icon} {modeConfig.label} — {modeConfig.description}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg mx-auto">
                  {quickSuggestions.map((suggestion, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="flex items-center gap-2 px-4 py-3 text-sm text-text-secondary bg-white border border-border hover:border-accent hover:bg-accent-bg rounded-xl transition-all active:scale-[0.98]"
                    >
                      <Lightbulb className="w-4 h-4 text-accent flex-shrink-0" />
                      <span className="truncate">{suggestion}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 消息列表 */}
            {activeMessages.slice(activeMessages.length <= 1 ? 0 : 0).map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  'flex gap-3',
                  msg.role === 'user' ? 'flex-row-reverse' : ''
                )}
              >
                <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center">
                  {msg.role === 'user' ? (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-pink-500 flex items-center justify-center text-white text-xs font-medium">
                      U
                    </div>
                  ) : (
                    <div className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center text-white',
                      activeMode === 'plan' ? 'bg-gradient-to-br from-amber-400 to-orange-500' :
                      activeMode === 'code' ? 'bg-gradient-to-br from-violet-500 to-pink-500' :
                      activeMode === 'debug' ? 'bg-gradient-to-br from-red-400 to-rose-500' :
                      'bg-gradient-to-br from-blue-400 to-indigo-500'
                    )}>
                      <span className="text-sm">{modeConfig.icon}</span>
                    </div>
                  )}
                </div>

                <div className={cn(
                  'max-w-[80%] md:max-w-2xl',
                  msg.role === 'user'
                    ? 'bg-accent text-white rounded-2xl rounded-tr-sm px-4 py-3'
                    : 'bg-white border border-border rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm'
                )}>
                  {/* 消息附件（对齐 WorkBuddy 的「引用对话中的文件」） */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {msg.attachments.map((a) => (
                        <span
                          key={a.id}
                          className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs max-w-[180px]',
                            msg.role === 'user' ? 'bg-white/15' : 'bg-bg-secondary border border-border text-text-secondary'
                          )}
                          title={`${a.name} · ${(a.size / 1024).toFixed(0)}KB`}
                        >
                          {a.kind === 'image' ? <ImageIcon className="w-3 h-3 shrink-0" /> : <FileText className="w-3 h-3 shrink-0" />}
                          <span className="truncate">{a.name}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {msg.role === 'user'
                    ? <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    : renderMessageContent(msg)
                  }
                </div>
              </div>
            ))}

            {/* 思考过程展示 */}
            {(thinkingSteps.length > 0 || isProcessing) && (
              <ThinkingIndicator
                steps={thinkingSteps}
                isThinking={isProcessing}
              />
            )}

            {/* 任务进度展示 */}
            {activeTaskSteps.length > 0 && (
              <TaskTracker steps={activeTaskSteps} />
            )}

            {/* 操作确认卡片 */}
            {pendingApproval && (
              <ApprovalPrompt
                request={pendingApproval.request}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 输入区 */}
        <div className="border-t border-border bg-white p-4 md:px-8 pb-[calc(16px+env(safe-area-inset-bottom))] md:pb-4">
          <div className="max-w-3xl mx-auto relative">
            {/* 斜杠命令下拉 */}
            {showSlashMenu && (
              <SlashCommandBar
                inputValue={inputValue}
                onSelect={handleSlashCommandSelect}
                onClose={() => setShowSlashMenu(false)}
              />
            )}

            {/* 已上传文件 chips */}
            {uploadedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {uploadedFiles.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg bg-bg-secondary border border-border text-xs text-text-secondary max-w-[220px]"
                  >
                    {f.kind === 'image' ? <ImageIcon className="w-3.5 h-3.5 shrink-0 text-accent" /> : <FileText className="w-3.5 h-3.5 shrink-0 text-accent" />}
                    <span className="truncate">{f.name}</span>
                    <span className="text-text-tertiary shrink-0">{(f.size / 1024).toFixed(0)}KB</span>
                    <button
                      type="button"
                      onClick={() => removeUploadedFile(f.id)}
                      className="shrink-0 ml-0.5 text-text-tertiary hover:text-red-500 transition-colors"
                      title="移除"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 隐藏的文件选择器 */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
              accept="*/*"
            />

            <div className="relative flex items-end gap-2 bg-bg-secondary rounded-2xl border border-border p-2 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent transition-all">
              {/* 左侧「+」附件菜单：添加文件 / 引用对话中的文件 */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => { setShowAttachMenu(v => !v); setShowConnectorMenu(false); }}
                  disabled={isProcessing}
                  className={cn(
                    'p-2 rounded-lg transition-colors disabled:opacity-50 shrink-0',
                    showAttachMenu ? 'bg-accent/10 text-accent' : 'text-text-tertiary hover:text-accent hover:bg-bg-hover'
                  )}
                  title="添加文件 / 引用对话中的文件"
                >
                  <Plus className="w-5 h-5" />
                </button>
                {showAttachMenu && (
                  <div className="absolute bottom-full left-0 mb-2 w-52 rounded-xl border border-border bg-bg-primary shadow-lg py-1 z-30">
                    <button
                      type="button"
                      onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      <Paperclip className="w-4 h-4 shrink-0" />
                      添加文件
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRefSelection(conversationAttachments.map(a => a.id)); setShowRefPicker(true); setShowAttachMenu(false); }}
                      disabled={conversationAttachments.length === 0}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title={conversationAttachments.length === 0 ? '当前对话还没有可引用的文件' : '从对话历史中引用已上传的文件'}
                    >
                      <MessageSquare className="w-4 h-4 shrink-0" />
                      引用对话中的文件
                      {conversationAttachments.length > 0 && (
                        <span className="ml-auto text-xs text-text-tertiary">{conversationAttachments.length}</span>
                      )}
                    </button>
                  </div>
                )}
              </div>

              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  activeMode === 'plan' ? '描述你的需求，我会帮你规划方案（不执行）...' :
                  activeMode === 'debug' ? '描述问题现象，我会自动诊断修复...' :
                  activeMode === 'orchestrator' ? '描述复杂任务，我会分解并协调执行...' :
                  activeMode === 'ask' ? '有什么问题尽管问，我会直接回答（不执行任何操作）...' :
                  '输入需求或 / 命令，如 /create-agent 或 "帮我创建Agent"'
                }
                rows={1}
                disabled={isProcessing}
                className="flex-1 bg-transparent resize-none outline-none text-sm text-text-primary placeholder:text-text-tertiary py-2 max-h-32 leading-relaxed disabled:opacity-50"
                style={{ height: 'auto', minHeight: '24px' }}
              />

              {/* 右侧工具：连接器引用 + 执行权限 */}
              <div className="flex items-center gap-1 shrink-0">
                {/* 连接器（MCP）引用菜单 */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => { setShowConnectorMenu(v => !v); setShowAttachMenu(false); }}
                    className={cn(
                      'p-2 rounded-lg transition-colors',
                      showConnectorMenu ? 'bg-accent/10 text-accent' : 'text-text-tertiary hover:text-accent hover:bg-bg-hover'
                    )}
                    title="引用连接器 / Agent / 工作流"
                  >
                    <Plug className="w-5 h-5" />
                  </button>
                  {showConnectorMenu && (
                    <div className="absolute bottom-full right-0 mb-2 w-64 rounded-xl border border-border bg-bg-primary shadow-lg py-1 z-30 max-h-80 overflow-y-auto">
                      <p className="px-3 pt-1.5 pb-1 text-xs font-semibold text-text-tertiary">连接器（MCP）</p>
                      {mcps.length === 0 && <p className="px-3 py-1.5 text-xs text-text-tertiary">暂无已配置连接器</p>}
                      {mcps.map((s) => (
                        <button key={s.id} type="button" onClick={() => insertRef(`@mcp:${s.name}`)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors">
                          <Plug className="w-3.5 h-3.5 shrink-0 text-accent" />
                          <span className="truncate">{s.name}</span>
                        </button>
                      ))}
                      <p className="px-3 pt-2 pb-1 text-xs font-semibold text-text-tertiary">Agent（专家）</p>
                      {agents.length === 0 && <p className="px-3 py-1.5 text-xs text-text-tertiary">暂无 Agent</p>}
                      {agents.slice(0, 12).map((a) => (
                        <button key={a.id} type="button" onClick={() => insertRef(`@agent:${a.name}`)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors">
                          <Bot className="w-3.5 h-3.5 shrink-0 text-accent" />
                          <span className="truncate">{a.name}</span>
                        </button>
                      ))}
                      <p className="px-3 pt-2 pb-1 text-xs font-semibold text-text-tertiary">工作流（技能）</p>
                      {workflows.length === 0 && <p className="px-3 py-1.5 text-xs text-text-tertiary">暂无工作流</p>}
                      {workflows.slice(0, 12).map((w) => (
                        <button key={w.id} type="button" onClick={() => insertRef(`@workflow:${w.name}`)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors">
                          <Workflow className="w-3.5 h-3.5 shrink-0 text-accent" />
                          <span className="truncate">{w.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 允许完全访问（执行权限） */}
                <button
                  type="button"
                  onClick={() => setAllowFullAccess(v => !v)}
                  className={cn(
                    'p-2 rounded-lg transition-colors shrink-0',
                    allowFullAccess
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'text-text-tertiary hover:text-emerald-600 hover:bg-bg-hover'
                  )}
                  title={allowFullAccess ? '允许完全访问：自动执行，跳过操作确认' : '已启用操作确认：执行前需你批准'}
                >
                  <ShieldCheck className="w-5 h-5" />
                </button>
              </div>

              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || isProcessing}
                className={cn(
                  'p-2 rounded-xl transition-colors active:scale-[0.98]',
                  inputValue.trim() && !isProcessing
                    ? 'bg-accent hover:bg-accent-hover text-white'
                    : 'bg-bg-tertiary text-text-tertiary cursor-not-allowed'
                )}
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-text-tertiary">
                {modeConfig.icon} {modeConfig.label} · {allowFullAccess
                  ? '完全访问（自动执行）'
                  : modeConfig.behavior === 'analyze_only' ? (activeMode === 'ask' ? '纯问答' : '仅规划') : modeConfig.behavior === 'execute_auto' ? '自动执行' : '执行需确认'}
              </p>
              <p className="text-xs text-text-tertiary flex items-center gap-1">
                {allowFullAccess && <ShieldCheck className="w-3 h-3 text-emerald-600" />}
                `/help` 查看命令
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ===== 路由仪表盘 Overlay ===== */}
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

      {/* ===== 引用对话中的文件 Overlay ===== */}
      {showRefPicker && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-primary border border-border rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-text-primary">引用对话中的文件</h2>
              <button
                onClick={() => setShowRefPicker(false)}
                className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-text-tertiary mb-3">
              勾选要加入当前对话上下文的历史附件，确认后会出现在输入框上方。
            </p>
            <div className="space-y-2">
              {conversationAttachments.map((a) => {
                const checked = refSelection.includes(a.id);
                return (
                  <label
                    key={a.id}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors',
                      checked ? 'border-accent bg-accent/5' : 'border-border hover:bg-bg-hover'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setRefSelection((prev) =>
                          e.target.checked ? [...prev, a.id] : prev.filter((id) => id !== a.id)
                        )
                      }
                      className="accent-accent"
                    />
                    {a.kind === 'image' ? <ImageIcon className="w-4 h-4 shrink-0 text-accent" /> : <FileText className="w-4 h-4 shrink-0 text-accent" />}
                    <span className="truncate text-sm text-text-secondary">{a.name}</span>
                    <span className="ml-auto text-xs text-text-tertiary shrink-0">{(a.size / 1024).toFixed(0)}KB</span>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowRefPicker(false)}
                className="px-4 py-2 text-sm rounded-lg border border-border text-text-secondary hover:bg-bg-hover transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmRefAttachments}
                disabled={refSelection.length === 0}
                className={cn(
                  'px-4 py-2 text-sm rounded-lg transition-colors',
                  refSelection.length > 0
                    ? 'bg-accent hover:bg-accent-hover text-white'
                    : 'bg-bg-tertiary text-text-tertiary cursor-not-allowed'
                )}
              >
                确认引用（{refSelection.length}）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
