import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Workflow, Agent, ChatMessage, Plugin, Template, WorkflowNode, WorkflowEdge, NodeData, ToolConfig, User, Channel, RemoteHost, ExecutionState, ExecutionLog, MetaSkill, ExecutionTrace, SubAgentDef, MCPServer, MCPTool, RouterRecord, SessionMemory, FactualMemory, ExperientialReflection, DreamLog, MemoryAuditEntry, HandoffSummary, FlowNode, FlowEdge, NodeExecutionStatus } from '../types';
import { mockPlugins, mockTemplates, nodeTemplates } from '../data/mockData';
import { generateId } from '../lib/utils';
import { sshApi } from '../api/sshApi';
import { hashPassword, verifyPassword } from '../lib/passwordUtils';
import { getChannelForModel, getAvailableChannelFromStore, routedChatLLM, sendA2ATask, streamA2ATask } from '../api/llmApi';
import { INITIAL_META_SKILL } from '../lib/metaSkill';
import { extractTaskFeatures } from '../lib/modelRouter';
import { BUILTIN_TOOL_SCHEMAS } from '../lib/builtinTools';
import { MEMORY_TOOL_SCHEMAS } from '../lib/memory/selfEditing';
import { workflowApi } from '../api/workflowApi';
import { agentApi } from '../api/agentApi';
import { channelApi } from '../api/channelApi';
import { getAgentRuntimeRegistry } from '../lib/agentRuntime';
import { getAgentMessageBus } from '../lib/agentMessageBus';
import { getAgentScheduler } from '../lib/agentScheduler';

// ===== 工作流执行辅助：表达式求值 / 模板替换 / 值转换 =====

/** 将 {{var}} 模板与裸变量名注入沙箱求值布尔表达式，任何异常都返回 false（安全兜底） */
function evalConditionExpression(expr: string, vars: Record<string, any>): boolean {
  if (!expr || !expr.trim()) return false;
  try {
    // {{var}} / {{a.b}} → vars["var"]
    const normalized = expr.replace(/\{\{\s*([\w.$]+)\s*\}\}/g, (_m, k) => `__vars[${JSON.stringify(k)}]`);
    // 将合法标识符的变量以局部常量形式暴露，支持裸变量名 (如 count > 5)
    const keys = Object.keys(vars).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
    const header = keys.map((k) => `var ${k} = __vars[${JSON.stringify(k)}];`).join('');
    // eslint-disable-next-line no-new-func
    const fn = new Function('__vars', `"use strict"; ${header} try { return !!(${normalized}); } catch(_e) { return false; }`);
    return fn(vars);
  } catch {
    return false;
  }
}

/** 替换字符串中的 {{var}} 模板为变量值 */
function substituteTemplate(input: string, vars: Record<string, any>): string {
  if (!input) return input;
  return input.replace(/\{\{\s*([\w.$]+)\s*\}\}/g, (_m, k) => {
    const v = vars[k];
    return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}

/** 按 valueType 将字符串值转换为运行期真实值 */
function coerceValue(raw: string, valueType?: string): any {
  if (valueType === 'number') {
    const n = Number(raw);
    return Number.isNaN(n) ? 0 : n;
  }
  if (valueType === 'boolean') return raw === 'true' || raw === '1';
  if (valueType === 'object' || valueType === 'array') {
    try { return JSON.parse(raw); } catch { return valueType === 'array' ? [] : {}; }
  }
  return raw;
}

// ===== 检查点（命名快照，持久化） =====
export interface Checkpoint {
  id: string;
  label: string;
  timestamp: string;
  nodes: any[];
  edges: any[];
}

// 预置渠道模板
export const providerPresets: Record<string, { baseUrl: string; models: { name: string; displayName: string }[] }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { name: 'gpt-4o', displayName: 'GPT-4o' },
      { name: 'gpt-4-turbo', displayName: 'GPT-4 Turbo' },
      { name: 'gpt-3.5-turbo', displayName: 'GPT-3.5 Turbo' },
    ],
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { name: 'claude-3-5-sonnet', displayName: 'Claude 3.5 Sonnet' },
      { name: 'claude-3-opus', displayName: 'Claude 3 Opus' },
      { name: 'claude-3-haiku', displayName: 'Claude 3 Haiku' },
    ],
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1',
    models: [
      { name: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
      { name: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash' },
    ],
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { name: 'deepseek-chat', displayName: 'DeepSeek V3' },
      { name: 'deepseek-reasoner', displayName: 'DeepSeek R1' },
    ],
  },
  azure: {
    baseUrl: '',
    models: [],
  },
  custom: {
    baseUrl: '',
    models: [],
  },
};

interface AppState {
  // Auth
  currentUser: User | null;
  isFirstTime: boolean; // 是否首次使用（无管理员账号）
  setupAdmin: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;

  // Channels
  channels: Channel[];
  addChannel: (channel: Omit<Channel, 'id' | 'createdAt'>) => Promise<void>;
  updateChannel: (id: string, updates: Partial<Channel>) => Promise<void>;
  deleteChannel: (id: string) => Promise<void>;
  toggleChannelEnabled: (id: string) => void;
  getAvailableModels: () => { channelId: string; channelName: string; provider: string; model: { name: string; displayName: string } }[];

  // 模型路由与选择
  defaultModelId: string | null;     // 手动指定默认模型（格式: channelId:modelName），null = ACRouter 自动路由
  routerEnabled: boolean;            // ACRouter 自动路由开关，false = 使用 defaultModelId
  visionModelId: string | null;      // 识图模型（格式: channelId:modelName），当对话含图片且当前模型不支持视觉时自动切换
  theme: 'light' | 'dark' | 'system';// 界面主题
  setDefaultModelId: (id: string | null) => void;
  setRouterEnabled: (enabled: boolean) => void;
  setVisionModelId: (id: string | null) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;

  // Remote Hosts
  hosts: RemoteHost[];
  addHost: (host: Omit<RemoteHost, 'id' | 'createdAt' | 'status'>) => void;
  updateHost: (id: string, updates: Partial<RemoteHost>) => void;
  deleteHost: (id: string) => void;
  toggleHostEnabled: (id: string) => void;
  testHostConnection: (id: string) => Promise<boolean>;
  connectHost: (id: string) => Promise<boolean>;
  disconnectHost: (id: string) => void;

  // Execution
  executionState: ExecutionState;
  startExecution: () => void;
  pauseExecution: () => void;
  resumeExecution: () => void;
  stopExecution: () => void;
  stepExecution: () => Promise<void>;
  addExecutionLog: (log: Omit<ExecutionLog, 'id' | 'timestamp'>) => void;
  setExecutionVariable: (name: string, value: any) => void;

  executionVariables: Record<string, any>;
  setExecutionVariables: (variables: Record<string, any>) => void;
  clearExecutionVariables: () => void;

  workflows: Workflow[];
  agents: Agent[];
  plugins: Plugin[];
  templates: Template[];
  messages: ChatMessage[];
  nodeTemplates: WorkflowNode[];
  currentWorkflowId: string | null;
  currentAgentId: string | null;
  sidebarCollapsed: boolean;
  selectedNodeId: string | null;
  isRunning: boolean;

  setCurrentWorkflow: (id: string | null) => void;
  setCurrentAgent: (id: string | null) => void;
  toggleSidebar: () => void;
  setSelectedNode: (id: string | null) => void;
  addMessage: (message: ChatMessage) => Promise<void>;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  togglePlugin: (id: string) => void;
  addNodeFromTemplate: (template: WorkflowNode & { defaultData?: Partial<NodeData> }) => void;
  createWorkflow: (name: string, templateId?: string) => Promise<string>;
  deleteWorkflow: (id: string) => Promise<void>;
  duplicateWorkflow: (id: string) => Promise<string | null>;
  updateWorkflow: (id: string, updates: Partial<Workflow>) => Promise<void>;
  updateWorkflowNode: (workflowId: string, nodeId: string, updates: Partial<NodeData>) => void;
  duplicateWorkflowNode: (workflowId: string, nodeId: string) => void;
  removeWorkflowNode: (workflowId: string, nodeId: string) => void;
  addWorkflowEdge: (workflowId: string, edge: WorkflowEdge) => void;
  removeWorkflowEdge: (workflowId: string, edgeId: string) => void;
  addToolToNode: (workflowId: string, nodeId: string, tool: Omit<ToolConfig, 'id'>) => void;
  updateToolInNode: (workflowId: string, nodeId: string, toolId: string, updates: Partial<ToolConfig>) => void;
  removeToolFromNode: (workflowId: string, nodeId: string, toolId: string) => void;
  toggleToolEnabled: (workflowId: string, nodeId: string, toolId: string) => void;

  // 检查点（命名快照，Undo/Checkpoint）
  checkpoints: Record<string, Checkpoint[]>;
  addCheckpoint: (workflowId: string, label: string, snapshot: { nodes: any[]; edges: any[] }) => void;
  deleteCheckpoint: (workflowId: string, checkpointId: string) => void;
  startRun: () => void;
  stopRun: () => void;

  // ===== Workflow Editor (React Flow) =====
  workflowEditorNodes: FlowNode[];
  workflowEditorEdges: FlowEdge[];
  workflowEditorSelectedNodeId: string | null;
  workflowEditorSelectedEdgeId: string | null;
  workflowEditorPast: Array<{ nodes: FlowNode[]; edges: FlowEdge[] }>;
  workflowEditorFuture: Array<{ nodes: FlowNode[]; edges: FlowEdge[] }>;
  addWorkflowEditorNode: (node: Omit<FlowNode, 'id'> & { id?: string }) => void;
  updateWorkflowEditorNode: (id: string, updates: Partial<FlowNode>) => void;
  deleteWorkflowEditorNode: (id: string) => void;
  addWorkflowEditorEdge: (edge: Omit<FlowEdge, 'id'> & { id?: string }) => void;
  updateWorkflowEditorEdge: (id: string, updates: Partial<FlowEdge>) => void;
  deleteWorkflowEditorEdge: (id: string) => void;
  undoWorkflowEditor: () => void;
  redoWorkflowEditor: () => void;
  setWorkflowEditorSelectedNode: (id: string | null) => void;
  setWorkflowEditorSelectedEdge: (id: string | null) => void;
  loadWorkflowToEditor: (workflowId: string) => void;
  clearWorkflowEditor: () => void;

  // ===== 工作流调试器 =====
  breakpoints: string[];
  nodeExecutionStatuses: Record<string, NodeExecutionStatus>;
  toggleBreakpoint: (nodeId: string) => void;
  clearBreakpoints: () => void;
  setNodeExecutionStatus: (nodeId: string, status: NodeExecutionStatus) => void;
  clearNodeExecutionStatuses: () => void;

  createAgent: (agent: Omit<Agent, 'id' | 'createdAt'>) => Promise<void>;
  updateAgent: (id: string, updates: Partial<Agent>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;

  // Meta-Skill (Skill-MAS)
  metaSkill: MetaSkill;
  updateMetaSkill: (skill: MetaSkill) => void;

  // Experience Bank
  experienceBank: ExecutionTrace[];
  addTrace: (trace: ExecutionTrace) => void;
  setExperienceBank: (traces: ExecutionTrace[]) => void;
  clearTraces: () => void;

  // Router Memory (ACRouter 模型级表现记忆)
  routerMemory: RouterRecord[];
  addRouterRecord: (record: RouterRecord) => void;
  clearRouterMemory: () => void;
  setRouterMemory: (records: RouterRecord[]) => void;

  // MCP Servers (Phase 6：MCP 工具集成)
  mcps: MCPServer[];
  addMCP: (server: Omit<MCPServer, 'id' | 'createdAt' | 'status' | 'tools'>) => void;
  updateMCP: (id: string, updates: Partial<MCPServer>) => void;
  deleteMCP: (id: string) => void;
  setMCPStatus: (id: string, status: MCPServer['status'], tools?: MCPTool[], lastError?: string) => void;

  // ===== 统一记忆架构（Phase 10：四层记忆 + 三个横切机制） =====

  // L0: Working Memory — 非持久化，会话内
  sessionMemories: Record<string, SessionMemory>;
  setSessionMemory: (sessionId: string, memory: SessionMemory) => void;
  clearSessionMemory: (sessionId: string) => void;

  // L1: Factual Memory — 持久化，跨会话事实
  factualMemory: FactualMemory[];
  addFactualMemory: (memory: Omit<FactualMemory, 'id' | 'createdAt' | 'updatedAt' | 'accessCount'>) => void;
  updateFactualMemory: (id: string, updates: Partial<FactualMemory>) => void;
  deleteFactualMemory: (id: string) => void;
  incrementFactualAccess: (id: string) => void;
  setFactualMemory: (memories: FactualMemory[]) => void;

  // L2-B: Experiential Reflections — 持久化
  experientialReflections: ExperientialReflection[];
  addExperientialReflection: (reflection: ExperientialReflection) => void;
  updateExperientialReflection: (id: string, updates: Partial<ExperientialReflection>) => void;
  deleteExperientialReflection: (id: string) => void;
  setExperientialReflections: (reflections: ExperientialReflection[]) => void;

  // 横切: Auto Extraction 光标 — 持久化
  extractionCursors: Record<string, string>;
  setExtractionCursor: (sessionId: string, messageId: string) => void;

  // 横切: Auto Dream 日志 — 持久化
  dreamLogs: DreamLog[];
  addDreamLog: (log: DreamLog) => void;

  // 横切: Handoff Summary 历史 — 持久化
  handoffSummaries: HandoffSummary[];
  addHandoffSummary: (summary: HandoffSummary) => void;

  // 横切: Memory Audit — 持久化
  memoryAuditLog: MemoryAuditEntry[];
  addMemoryAudit: (entry: Omit<MemoryAuditEntry, 'id' | 'timestamp'>) => void;
}

// ===== 工具解析辅助（Phase 6：将 MCP 工具标识解析为 OpenAI function 调用 schema） =====
// 解析工具 ID 为 OpenAI function schema，支持三类工具：
//   - 内置工具：builtin_xxx（来自 BUILTIN_TOOL_SCHEMAS）
//   - 记忆工具：memory_xxx（来自 MEMORY_TOOL_SCHEMAS）
//   - MCP 工具：serverName__toolName 或原始 toolName（来自已连接的 MCP server）
function resolveToolSchemas(toolIds?: string[]): any[] {
  if (!toolIds || toolIds.length === 0) return [];
  const result: any[] = [];

  // 1. 内置工具
  const builtinNames = new Set<string>();
  for (const id of toolIds) {
    if (id.startsWith('builtin_')) {
      builtinNames.add(id);
    }
  }
  if (builtinNames.size > 0) {
    for (const schema of BUILTIN_TOOL_SCHEMAS as any[]) {
      if (builtinNames.has(schema.function.name)) {
        result.push(schema);
      }
    }
  }

  // 2. 记忆工具
  const memoryNames = new Set<string>();
  for (const id of toolIds) {
    if (id.startsWith('memory_') && !id.includes('__')) {
      memoryNames.add(id);
    }
  }
  if (memoryNames.size > 0) {
    for (const schema of MEMORY_TOOL_SCHEMAS as any[]) {
      if (memoryNames.has(schema.name)) {
        result.push({ type: 'function', function: schema });
      }
    }
  }

  // 3. MCP 工具（含命名空间格式和原始名）
  const mcps = useStore.getState().mcps || [];
  const allMcpTools = mcps.flatMap((m) => (m.enabled ? m.tools : []));
  const mcpToolIds = new Set(toolIds.filter((id) => !id.startsWith('builtin_') && !(id.startsWith('memory_') && !id.includes('__'))));
  for (const id of mcpToolIds) {
    const sepIdx = id.indexOf('__');
    let serverHint = '';
    let toolName = id;
    if (sepIdx > 0) {
      serverHint = id.slice(0, sepIdx);
      toolName = id.slice(sepIdx + 2);
    }
    const matched = allMcpTools.find((t) => {
      if (sepIdx > 0) {
        const ownerMcp = mcps.find((m) => m.enabled && m.name === serverHint && m.tools.includes(t));
        return ownerMcp && t.name === toolName;
      }
      return t.name === toolName;
    });
    if (matched) {
      result.push({
        type: 'function',
        function: {
          name: id,
          description: matched.description,
          parameters:
            matched.inputSchema && typeof matched.inputSchema === 'object'
              ? matched.inputSchema
              : { type: 'object', properties: {} },
        },
      });
    }
  }

  return result;
}

const USER_STORAGE_KEY = 'lnagent_user';
const ADMIN_STORAGE_KEY = 'lnagent_admin';

// ===== 工作流云端同步（Debounced）=====
// 节点/边/工具等结构变更只改本地 state，需要 debounced 同步到后端
// 确保同一账号在不同设备上看到相同的工作流结构
const pendingWorkflowSyncs = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleWorkflowSync(workflowId: string) {
  // 清除之前的定时器
  const existing = pendingWorkflowSyncs.get(workflowId);
  if (existing) clearTimeout(existing);

  // 500ms debounce，避免频繁 API 调用
  const timer = setTimeout(async () => {
    pendingWorkflowSyncs.delete(workflowId);
    try {
      const state = useStore.getState();
      const wf = state.workflows.find((w) => w.id === workflowId);
      if (!wf) return;
      await workflowApi.update(workflowId, wf);
      console.debug(`[WorkflowSync] ${wf.name} 已同步到云端`);
    } catch (err) {
      // 后端异常：静默保留本地数据，下次启动时 useDataInit 会尝试恢复
      console.warn(`[WorkflowSync] 工作流 ${workflowId} 同步失败，本地数据已保留:`, err);
    }
  }, 500);

  pendingWorkflowSyncs.set(workflowId, timer);
}

function scheduleWorkflowSyncAll() {
  const state = useStore.getState();
  state.workflows.forEach((w) => scheduleWorkflowSync(w.id));
}

/** 立即同步所有待同步的工作流（登出/页面关闭前调用） */
function flushPendingWorkflowSyncs() {
  pendingWorkflowSyncs.forEach((timer, workflowId) => {
    clearTimeout(timer);
    pendingWorkflowSyncs.delete(workflowId);
  });
  const state = useStore.getState();
  state.workflows.forEach(async (w) => {
    try {
      await workflowApi.update(w.id, w);
    } catch {
      // 静默失败
    }
  });
}

/** 从 localStorage 加载当前登录用户 */
const loadUserFromStorage = (): User | null => {
  try {
    const stored = localStorage.getItem(USER_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.error('Failed to load user from storage:', e);
  }
  return null;
};

const saveUserToStorage = (user: User | null) => {
  try {
    if (user) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_STORAGE_KEY);
    }
  } catch (e) {
    console.error('Failed to save user to storage:', e);
  }
};

/** 从 localStorage 加载管理员凭据（哈希后的密码） */
interface StoredAdmin {
  id: string;
  username: string;
  passwordHash: string;
  role: 'admin' | 'user';
  avatar: string;
  createdAt: string;
}

const loadAdminFromStorage = (): StoredAdmin | null => {
  try {
    const stored = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.error('Failed to load admin from storage:', e);
  }
  return null;
};

const saveAdminToStorage = (admin: StoredAdmin) => {
  try {
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(admin));
  } catch (e) {
    console.error('Failed to save admin to storage:', e);
  }
};

/** 判断是否首次使用 */
const checkFirstTime = (): boolean => {
  return !loadAdminFromStorage();
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
  // Auth
  currentUser: loadUserFromStorage(),
  isFirstTime: checkFirstTime(),
  setupAdmin: async (username, password) => {
    const passwordHash = await hashPassword(password);
    const admin: StoredAdmin = {
      id: `admin-${generateId()}`,
      username,
      passwordHash,
      role: 'admin',
      avatar: '👑',
      createdAt: new Date().toISOString(),
    };
    saveAdminToStorage(admin);
    // 自动登录
    const user: User = { ...admin, password: '' };
    set({ currentUser: user, isFirstTime: false });
    saveUserToStorage(user);
  },
  login: async (username, password) => {
    const admin = loadAdminFromStorage();
    if (!admin) {
      // 首次使用，需要先设置管理员
      set({ isFirstTime: true });
      return false;
    }
    const isMatch = await verifyPassword(password, admin.passwordHash);
    if (isMatch && username === admin.username) {
      const user: User = { ...admin, password: '' };
      set({ currentUser: user });
      saveUserToStorage(user);
      return true;
    }
    return false;
  },
  logout: () => {
    // 登出前先同步所有待同步的工作流
    flushPendingWorkflowSyncs();
    set({ currentUser: null });
    saveUserToStorage(null);
  },

  // Channels
  channels: [],
  addChannel: async (channel) => {
    const localChannel = { ...channel, id: `ch-${generateId()}`, createdAt: new Date().toISOString() };
    try {
      const created = await channelApi.create(channel);
      set((state) => ({ channels: [...state.channels, created] }));
    } catch (err) {
      // 后端异常：降级为本地保存，确保用户仍能使用
      console.warn('[addChannel] 后端同步失败，降级为本地保存:', err);
      set((state) => ({ channels: [...state.channels, localChannel] }));
    }
  },
  updateChannel: async (id, updates) => {
    const updated = { ...updates } as Channel;
    try {
      const remoteUpdated = await channelApi.update(id, updates);
      set((state) => ({
        channels: state.channels.map((c) => (c.id === id ? remoteUpdated : c)),
      }));
    } catch (err) {
      console.warn('[updateChannel] 后端同步失败，降级为本地更新:', err);
      set((state) => ({
        channels: state.channels.map((c) => (c.id === id ? { ...c, ...updated } : c)),
      }));
    }
  },
  deleteChannel: async (id) => {
    try {
      await channelApi.delete(id);
    } catch (err) {
      console.warn('[deleteChannel] 后端同步失败，仅本地删除:', err);
    }
    set((state) => ({
      channels: state.channels.filter((c) => c.id !== id),
    }));
  },
  toggleChannelEnabled: (id) =>
    set((state) => ({
      channels: state.channels.map((c) =>
        c.id === id ? { ...c, enabled: !c.enabled } : c
      ),
    })),
  getAvailableModels: () => {
    const channels = get().channels.filter((c) => c.enabled);
    const models: { channelId: string; channelName: string; provider: string; model: { name: string; displayName: string } }[] = [];
    channels.forEach((ch) => {
      ch.models.forEach((m) => {
        models.push({ channelId: ch.id, channelName: ch.name, provider: ch.provider, model: { name: m.name, displayName: m.displayName } });
      });
    });
    return models;
  },

  // 模型路由与选择
  defaultModelId: null,
  routerEnabled: true,
  visionModelId: null,
  theme: 'light',
  setDefaultModelId: (id) => set({ defaultModelId: id }),
  setRouterEnabled: (enabled) => set({ routerEnabled: enabled }),
  setVisionModelId: (id) => set({ visionModelId: id }),
  setTheme: (theme) => {
    set({ theme });
    // 立即应用到 DOM（切换 <html> 上的 .dark 类）
    import('../lib/theme').then(({ applyTheme }) => applyTheme(theme)).catch(() => {});
  },

  // Remote Hosts
  hosts: [],
  addHost: (host) =>
    set((state) => ({
      hosts: [
        ...state.hosts,
        {
          ...host,
          id: `host-${generateId()}`,
          createdAt: new Date().toISOString(),
          status: 'offline',
        },
      ],
    })),
  updateHost: (id, updates) =>
    set((state) => ({
      hosts: state.hosts.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    })),
  deleteHost: (id) =>
    set((state) => ({
      hosts: state.hosts.filter((h) => h.id !== id),
    })),
  toggleHostEnabled: (id) =>
    set((state) => ({
      hosts: state.hosts.map((h) =>
        h.id === id ? { ...h, enabled: !h.enabled } : h
      ),
    })),
  testHostConnection: async (id) => {
    const host = get().hosts.find((h) => h.id === id);
    if (!host) return false;
    set((state) => ({
      hosts: state.hosts.map((h) =>
        h.id === id ? { ...h, status: 'connecting' } : h
      ),
    }));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const success = host.host.length > 0;
    set((state) => ({
      hosts: state.hosts.map((h) =>
        h.id === id ? { ...h, status: success ? 'online' : 'offline', lastConnected: success ? new Date().toISOString() : h.lastConnected } : h
      ),
    }));
    return success;
  },
  connectHost: async (id) => {
    const host = get().hosts.find((h) => h.id === id);
    if (!host) return false;
    set((state) => ({
      hosts: state.hosts.map((h) =>
        h.id === id ? { ...h, status: 'connecting' } : h
      ),
    }));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    set((state) => ({
      hosts: state.hosts.map((h) =>
        h.id === id ? { ...h, status: 'online', lastConnected: new Date().toISOString() } : h
      ),
    }));
    return true;
  },
  disconnectHost: (id) =>
    set((state) => ({
      hosts: state.hosts.map((h) =>
        h.id === id ? { ...h, status: 'offline' } : h
      ),
    })),

  // Execution
  executionState: {
    isRunning: false,
    currentNodeId: null,
    completedNodeIds: [],
    variables: {},
    logs: [],
    startTime: null,
    endTime: null,
    status: 'idle',
  },
  startExecution: () => {
    const state = get();
    const workflow = state.workflows.find((w) => w.id === state.currentWorkflowId);
    if (!workflow) return;

    const startNode = workflow.nodes.find((n) => n.type === 'start');
    if (!startNode) {
      set({
        executionState: {
          isRunning: false,
          currentNodeId: null,
          completedNodeIds: [],
          variables: {},
          logs: [
            {
              id: `log-${generateId()}`,
              nodeId: '',
              nodeName: '系统',
              timestamp: new Date().toISOString(),
              level: 'error',
              message: '未找到开始节点，请在工作流中添加开始节点',
            },
          ],
          startTime: null,
          endTime: null,
          status: 'failed',
          error: '未找到开始节点',
        },
      });
      return;
    }

    const initVariables: Record<string, any> = {};
    if (startNode.defaultData?.startConfig?.inputs) {
      startNode.defaultData.startConfig.inputs.forEach((input) => {
        initVariables[input.name] = input.default ?? null;
      });
    }

    set({
      executionState: {
        isRunning: true,
        currentNodeId: startNode.id,
        completedNodeIds: [],
        variables: initVariables,
        logs: [
          {
            id: `log-${generateId()}`,
            nodeId: startNode.id,
            nodeName: startNode.name,
            timestamp: new Date().toISOString(),
            level: 'info',
            message: '工作流开始执行',
          },
        ],
        startTime: new Date().toISOString(),
        endTime: null,
        status: 'running',
        iterationCount: 0,
      },
    });

    setTimeout(() => {
      const currentState = get();
      if (!currentState.executionState.isRunning) return;
      get().stepExecution().catch((err) => { console.error('stepExecution error:', err); });
    }, 800);
  },
  pauseExecution: () =>
    set((state) => ({
      executionState: {
        ...state.executionState,
        isRunning: false,
        status: 'paused',
      },
    })),
  resumeExecution: () => {
    set((state) => ({
      executionState: {
        ...state.executionState,
        isRunning: true,
        status: 'running',
      },
    }));
    setTimeout(() => {
      get().stepExecution().catch((err) => { console.error('stepExecution error:', err); });
    }, 500);
  },
  stopExecution: () =>
    set((state) => ({
      executionState: {
        ...state.executionState,
        isRunning: false,
        status: state.executionState.status === 'running' ? 'failed' : state.executionState.status,
        endTime: new Date().toISOString(),
        error: state.executionState.status === 'running' ? '执行已停止' : undefined,
      },
    })),
  stepExecution: async () => {
    let currentNode: WorkflowNode | undefined;
    try {
    const state = get();
    const { executionState, currentWorkflowId, workflows } = state;
    if (!executionState.isRunning || !currentWorkflowId) return;

    // 防无限循环：限制最大步数
    const MAX_ITERATIONS = 1000;
    const currentIteration = (executionState.iterationCount || 0) + 1;
    if (currentIteration > MAX_ITERATIONS) {
      set((s) => ({
        executionState: {
          ...s.executionState,
          isRunning: false,
          status: 'failed',
          endTime: new Date().toISOString(),
          error: `执行超过最大步数限制 (${MAX_ITERATIONS})，可能存在循环引用`,
          logs: [
            ...s.executionState.logs,
            {
              id: `log-${generateId()}`,
              nodeId: '',
              nodeName: '系统',
              timestamp: new Date().toISOString(),
              level: 'error',
              message: `执行超过最大步数限制 (${MAX_ITERATIONS})，可能存在循环引用`,
            },
          ],
        },
      }));
      return;
    }

    const workflow = workflows.find((w) => w.id === currentWorkflowId);
    if (!workflow) return;

    currentNode = workflow.nodes.find((n) => n.id === executionState.currentNodeId);
    if (!currentNode) {
      set((s) => ({
        executionState: {
          ...s.executionState,
          isRunning: false,
          status: 'failed',
          endTime: new Date().toISOString(),
          error: '当前节点不存在',
        },
      }));
      return;
    }

    const nodeType = currentNode.type;
    const newLogs: ExecutionLog[] = [...executionState.logs];
    const newVariables = { ...executionState.variables };
    const newCompleted = [...executionState.completedNodeIds, currentNode.id];
    // 分支/循环节点可覆盖默认边路由：undefined=沿用默认取首边；string=指定目标节点；null=结束
    let nextNodeIdOverride: string | null | undefined = undefined;

    switch (nodeType) {
      case 'start':
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: `开始节点执行完成，初始化 ${currentNode.defaultData?.startConfig?.inputs?.length || 0} 个输入变量`,
          data: newVariables,
        });
        break;

      case 'llm': {
        const config = currentNode.defaultData?.llmConfig;
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `调用大模型: ${config?.model || '默认模型'}`,
        });

        // 真实 LLM 调用
        let llmResult: string;
        try {
          const targetModel = config?.model || 'gpt-4o';
          const channelInfo = config?.channelId
            ? (() => {
                const ch = get().channels.find(c => c.id === config.channelId && c.enabled);
                return ch ? { channelId: ch.id, provider: ch.provider, baseUrl: ch.baseUrl, apiKey: ch.apiKey } : null;
              })()
            : await getChannelForModel(targetModel) || await getAvailableChannelFromStore();

          if (!channelInfo) {
            // 没有可用渠道，使用模拟结果
            llmResult = `[模拟] 未配置 LLM 渠道，请在渠道设置中添加 API Key。当前时间: ${new Date().toLocaleTimeString()}`;
            newLogs.push({
              id: `log-${generateId()}`,
              nodeId: currentNode.id,
              nodeName: currentNode.name,
              timestamp: new Date().toISOString(),
              level: 'warn',
              message: '未找到可用的 LLM 渠道，使用模拟结果',
            });
          } else {
            // 组装消息
            const llmMessages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> = [];
            if (config?.systemPrompt) {
              llmMessages.push({ role: 'system', content: config.systemPrompt });
            }
            // 用变量替换 userPrompt 中的 {{变量名}} 模板
            let userContent = config?.userPrompt || '';
            userContent = substituteTemplate(userContent, newVariables);
            if (!userContent) {
              userContent = '请根据上下文继续处理任务';
            }
            llmMessages.push({ role: 'user', content: userContent });

            // Phase 6：解析 LLM 节点配置的 MCP 工具
            const llmTools = resolveToolSchemas(config?.tools);

            const result = await routedChatLLM({
              messages: llmMessages,
              temperature: config?.temperature ?? 0.7,
              maxTokens: config?.maxTokens ?? 2048,
              tools: llmTools,
            }, extractTaskFeatures(userContent, { intent: 'workflow_llm_node' }));

            if (result.success && result.content) {
              llmResult = result.content;
              newLogs.push({
                id: `log-${generateId()}`,
                nodeId: currentNode.id,
                nodeName: currentNode.name,
                timestamp: new Date().toISOString(),
                level: 'success',
                message: `大模型调用完成 (${result.provider}/${result.model})`,
                data: { provider: result.provider, model: result.model },
              });
            } else {
              llmResult = `[调用失败] ${result.message || '未知错误'}`;
              newLogs.push({
                id: `log-${generateId()}`,
                nodeId: currentNode.id,
                nodeName: currentNode.name,
                timestamp: new Date().toISOString(),
                level: 'error',
                message: `大模型调用失败: ${result.message}`,
                data: { provider: result.provider, model: result.model },
              });
            }
          }
        } catch (error: any) {
          llmResult = `[异常] ${error.message}`;
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'error',
            message: `LLM 调用异常: ${error.message}`,
          });
        }

        const outputVar = config?.outputVariable || 'llm_output';
        newVariables[outputVar] = llmResult;
        if (llmResult.startsWith('[调用失败]') || llmResult.startsWith('[异常]')) {
          newVariables[`${outputVar}__error`] = true;
        }
        break;
      }

      case 'agent': {
        const config = currentNode.defaultData?.agentConfig;
        const startTime = Date.now();
        const scheduler = getAgentScheduler();
        const registry = getAgentRuntimeRegistry();
        const agentId = (currentNode.defaultData as any)?.agentId || '';
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `Agent "${currentNode.name}" 开始执行任务...`,
        });

        // 真实 LLM 调用 — Agent 节点本质上是带 system prompt 的 LLM 调用
        try {
          // 动态调度：如果该 Agent 正忙，将任务加入队列
          const agentState = registry.getAgentState(agentId);
          if (agentState && agentState.status === 'busy') {
            const inputText = Object.entries(newVariables)
              .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
              .join('\n');
            const taskId = scheduler.enqueue({
              input: inputText,
              requiredCapabilities: agentState.capabilities,
              preferredModel: null,
              priority: 'normal',
            });

            // 等待任务完成（轮询，最多 60 秒）
            const waitStart = Date.now();
            while (Date.now() - waitStart < 60000) {
              const task = scheduler.getTask(taskId);
              if (task && (task.status === 'done' || task.status === 'failed')) {
                break;
              }
              await new Promise((r) => setTimeout(r, 500));
            }

            const task = scheduler.getTask(taskId);
            if (task?.status === 'done' && task.result) {
              newVariables['agent_result'] = {
                status: 'completed',
                output: task.result,
              };
              break;
            } else {
              // 队列任务失败或超时，不 fall-through 到直接 LLM 调用
              newVariables['agent_result'] = {
                status: 'failed',
                output: `队列任务${task?.status === 'failed' ? '失败' : '超时'}: ${task?.result || task?.error || '未知原因'}`,
              };
              newLogs.push({
                id: `log-${generateId()}`,
                nodeId: currentNode.id,
                nodeName: currentNode.name,
                timestamp: new Date().toISOString(),
                level: 'error',
                message: `Agent 队列任务${task?.status === 'failed' ? '失败' : '超时'}`,
              });
              break;
            }
          }

          const targetModel = config?.model || 'gpt-4o';
          const channelInfo = await getChannelForModel(targetModel) || await getAvailableChannelFromStore();

          if (!channelInfo) {
            newVariables['agent_result'] = {
              status: 'mock',
              output: `[模拟] 未配置 LLM 渠道。Agent 执行完成（模拟结果）`,
              steps: 0,
            };
            newLogs.push({
              id: `log-${generateId()}`,
              nodeId: currentNode.id,
              nodeName: currentNode.name,
              timestamp: new Date().toISOString(),
              level: 'warn',
              message: '未找到可用 LLM 渠道，使用模拟结果',
            });
          } else {
            // 组装 Agent 消息
            const agentMessages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> = [];
            const systemPrompt = substituteTemplate(config?.systemPrompt || '你是一个专业的 AI 助手。', newVariables);
            agentMessages.push({ role: 'system', content: systemPrompt });

            // 从变量中获取上下文作为输入
            const contextStr = Object.entries(newVariables)
              .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
              .join('\n');
            agentMessages.push({ role: 'user', content: contextStr || '请开始执行任务' });

            // Phase 6：解析 Agent 配置的 MCP 工具
            const agentTools = resolveToolSchemas(config?.tools);

            const result = await routedChatLLM({
              messages: agentMessages,
              temperature: config?.temperature ?? 0.5,
              maxTokens: config?.maxTokens ?? 2048,
              tools: agentTools,
            }, extractTaskFeatures(contextStr, { intent: 'workflow_llm_node' }));

            if (result.success && result.content) {
              newVariables['agent_result'] = {
                status: 'completed',
                output: result.content,
                model: result.model,
                provider: result.provider,
              };
              newLogs.push({
                id: `log-${generateId()}`,
                nodeId: currentNode.id,
                nodeName: currentNode.name,
                timestamp: new Date().toISOString(),
                level: 'success',
                message: `Agent 任务执行完成 (${result.provider}/${result.model})`,
                data: { output: result.content?.slice(0, 200) },
              });
              if (agentId) {
                registry.recordTaskResult(agentId, true, Date.now() - startTime);
              }
            } else {
              newVariables['agent_result'] = {
                status: 'failed',
                output: result.message || '未知错误',
              };
              newLogs.push({
                id: `log-${generateId()}`,
                nodeId: currentNode.id,
                nodeName: currentNode.name,
                timestamp: new Date().toISOString(),
                level: 'error',
                message: `Agent 执行失败: ${result.message}`,
              });
              if (agentId) {
                registry.recordTaskResult(agentId, false, Date.now() - startTime);
              }
            }
          }
        } catch (error: any) {
          newVariables['agent_result'] = {
            status: 'error',
            output: error.message,
          };
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'error',
            message: `Agent 执行异常: ${error.message}`,
          });
          if (agentId) {
            registry.recordTaskResult(agentId, false, Date.now() - startTime);
          }
        }
        break;
      }

      // ===== SubAgent 并行编排（Phase 5：多 Agent 并行执行） =====
      case 'subagent': {
        const config = currentNode.defaultData?.subagentConfig;
        const subAgents = config?.agents || [];

        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `SubAgent 并行编排：启动 ${subAgents.length} 个子 Agent${config?.parallel === false ? '（串行）' : '（并行）'}`,
        });

        if (subAgents.length === 0) {
          newVariables[config?.outputVariable || 'subagent_result'] = { agents: [], summary: '' };
          break;
        }

        // 全部变量上下文（未指定 inputVariable 时使用）
        const fullContext = Object.entries(newVariables)
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join('\n');

        // Agent 间消息总线集成
        const bus = getAgentMessageBus();
        const runtimeRegistry = getAgentRuntimeRegistry();

        // 为每个子 Agent 注册消息处理器
        subAgents.forEach((a: SubAgentDef, idx: number) => {
          const agentRuntimeId = `${currentNode.id}_sub_${idx}`;
          runtimeRegistry.register(agentRuntimeId, a.tools || [], 1);
          bus.subscribe(agentRuntimeId, (msg) => {
            if (msg.type === 'request' || msg.type === 'notify') {
              const contextKey = `__msg_from_${msg.fromAgentId}`;
              newVariables[contextKey] = msg.content;
            }
          });
        });

        // 单个子 Agent 执行函数
        const runOne = async (a: SubAgentDef) => {
          const targetModel = a.model || 'gpt-4o';
          const channelInfo = await getChannelForModel(targetModel) || await getAvailableChannelFromStore();
          if (!channelInfo) {
            return {
              name: a.name,
              status: 'mock',
              output: `[模拟] 未配置 LLM 渠道，子 Agent「${a.name}」使用模拟结果`,
              model: '',
            };
          }
          const input =
            a.inputVariable != null && newVariables[a.inputVariable] != null
              ? `${a.inputVariable}: ${typeof newVariables[a.inputVariable] === 'string' ? newVariables[a.inputVariable] : JSON.stringify(newVariables[a.inputVariable])}`
              : fullContext || '请开始执行任务';

          const messages = [
            { role: 'system' as const, content: substituteTemplate(a.systemPrompt || '你是一个专业的 AI 助手。', newVariables) },
            { role: 'user' as const, content: input },
          ];
          const tools = resolveToolSchemas(a.tools);

          const r = await routedChatLLM({
            messages,
            temperature: a.temperature ?? 0.5,
            maxTokens: a.maxTokens ?? 2048,
            tools,
          }, extractTaskFeatures(input, { intent: 'workflow_llm_node' }));

          return {
            name: a.name,
            status: r.success ? 'completed' : 'failed',
            output: r.success ? r.content : r.message || '未知错误',
            model: r.model || '',
          };
        };

        // 并行 / 串行调度
        let results: Array<{ name: string; status: string; output: string; model: string }>;
        try {
          if (config?.parallel === false) {
            results = [];
            for (const a of subAgents) results.push(await runOne(a));
          } else {
            results = await Promise.all(subAgents.map(runOne));
          }
        } catch (err: any) {
          newVariables['agent_result'] = {
            status: 'failed',
            output: `子Agent执行失败: ${err.message}`,
          };
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'error',
            message: `子Agent执行失败: ${err.message}`,
          });
          break;
        }

        // 聚合各子 Agent 输出
        const parts = results
          .map((r) => `## ${r.name}${r.status !== 'completed' ? ` (${r.status})` : ''}\n${r.output}`)
          .join('\n\n');
        let summary = parts;
        if (config?.aggregatorPrompt) {
          try {
            const aggChannel = await getAvailableChannelFromStore();
            if (aggChannel) {
              const agg = await routedChatLLM({
                messages: [
                  { role: 'system', content: config.aggregatorPrompt },
                  { role: 'user', content: parts },
                ],
                temperature: 0.3,
                maxTokens: 2048,
              }, extractTaskFeatures(parts, { intent: 'workflow_llm_node' }));
              if (agg.success && agg.content) summary = agg.content;
            }
          } catch {
            // 聚合失败则回退到原始拼接
          }
        }

        const completedCount = results.filter((r) => r.status === 'completed').length;
        newVariables[config?.outputVariable || 'subagent_result'] = {
          agents: results,
          summary,
          status:
            completedCount === results.length
              ? 'completed'
              : completedCount > 0
                ? 'partial'
                : 'failed',
        };
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: `SubAgent 编排完成：${subAgents.length} 个子 Agent，${completedCount} 个成功`,
        });
        // 清理 Runtime Registry
        subAgents.forEach((_, idx) => {
          const runtimeId = `${currentNode.id}_sub_${idx}`;
          runtimeRegistry.unregister(runtimeId);
          getAgentMessageBus().unsubscribe(runtimeId);
        });
        break;
      }

      // ===== A2A 协议节点（Phase 11：Agent-to-Agent 互操作） =====
      case 'a2a': {
        const config = currentNode.defaultData?.a2aConfig;
        if (!config?.agentUrl) {
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'error',
            message: 'A2A 节点未配置 agentUrl',
          });
          newVariables[config?.outputVariable || 'a2a_result'] = { error: '未配置 Agent URL' };
          break;
        }

        // 模板替换：将 {{变量名}} 替换为实际变量值
        let messageText = config.message || '';
        messageText = substituteTemplate(messageText, newVariables);

        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `A2A 调用：${config.agentUrl}${config.streaming ? '（流式）' : ''}${config.skillId ? ` skill=${config.skillId}` : ''}`,
        });

        try {
          if (config.streaming) {
            // 流式模式
            let fullText = '';
            let finalState = 'completed';
            await streamA2ATask(
              config.agentUrl,
              messageText,
              {
                onDelta: (data) => {
                  fullText = data.fullText;
                  finalState = data.state;
                },
                onDone: (data) => {
                  fullText = data.response;
                  finalState = data.state;
                },
                onError: (msg) => {
                  finalState = 'failed';
                  fullText = fullText || `A2A 流式错误: ${msg}`;
                },
              },
              {
                skillId: config.skillId,
                authHeaders: config.authHeaders,
              },
            );
            newVariables[config.outputVariable || 'a2a_result'] = {
              response: fullText,
              state: finalState,
              agentUrl: config.agentUrl,
            };
          } else {
            // 非流式模式
            const result = await sendA2ATask(
              config.agentUrl,
              messageText,
              {
                skillId: config.skillId,
                authHeaders: config.authHeaders,
              },
            );
            if (result.success) {
              newVariables[config.outputVariable || 'a2a_result'] = {
                response: result.response || '',
                state: result.state || 'completed',
                agentUrl: config.agentUrl,
              };
            } else {
              throw new Error(result.error || 'A2A 任务失败');
            }
          }

          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'success',
            message: `A2A 调用完成`,
          });
        } catch (err: any) {
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'error',
            message: `A2A 调用失败: ${err.message}`,
          });
          newVariables[config.outputVariable || 'a2a_result'] = {
            error: err.message,
            state: 'failed',
            agentUrl: config.agentUrl,
          };
        }
        break;
      }

      case 'code': {
        const config = currentNode.defaultData?.codeConfig;
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `执行 ${config?.language || 'javascript'} 代码`,
        });

        const outputVar = config?.outputVariable || 'code_output';

        // 代码执行通过后端代理（SSH 连接后执行）
        // 如果没有配置远程主机，使用 LLM 来"解释"代码逻辑
        try {
          // 尝试通过已连接的 SSH 主机执行
          const connectedHosts = get().hosts.filter((h: any) => h.status === 'online');
          if (connectedHosts.length > 0 && config?.code) {
            const host = connectedHosts[0];
            // 变量替换
            let code = substituteTemplate(config.code, newVariables);

            // 通过 SSH API 执行代码
            const command = config.language === 'python'
              ? `python3 -c '${code.replace(/'/g, "'\\''")}'`
              : config.language === 'bash'
              ? code
              : `node -e '${code.replace(/'/g, "'\\''")}'`;

            const sshResult = await sshApi.execute({
              hostId: host.id,
              command,
            });

            if (sshResult.success) {
              newVariables[outputVar] = {
                stdout: sshResult.stdout || '',
                stderr: sshResult.stderr || '',
                exitCode: 0,
              };
              newLogs.push({
                id: `log-${generateId()}`,
                nodeId: currentNode.id,
                nodeName: currentNode.name,
                timestamp: new Date().toISOString(),
                level: 'success',
                message: `代码在主机 ${host.name} 上执行完成`,
                data: { host: host.name, stdout: sshResult.stdout?.slice(0, 200) },
              });
            } else {
              newVariables[outputVar] = {
                error: sshResult.message || '执行失败',
                stderr: sshResult.stderr || '',
                exitCode: 1,
              };
              newLogs.push({
                id: `log-${generateId()}`,
                nodeId: currentNode.id,
                nodeName: currentNode.name,
                timestamp: new Date().toISOString(),
                level: 'error',
                message: `代码执行失败: ${sshResult.message}`,
              });
            }
          } else {
            // 没有可用的 SSH 主机 — 如果有 LLM 渠道，用 LLM 解释代码意图
            const channelInfo = await getAvailableChannelFromStore();
            if (channelInfo && config?.code) {
              let code = substituteTemplate(config.code, newVariables);

              const result = await routedChatLLM({
                messages: [
                  { role: 'system', content: `你是一个代码执行助手。用户会给你一段 ${config.language || 'javascript'} 代码和输入变量，请模拟执行这段代码并返回结果。只输出执行结果，不要解释。` },
                  { role: 'user', content: `代码:\n${code}\n\n变量:\n${JSON.stringify(newVariables)}` },
                ],
                temperature: 0.1,
                maxTokens: 2048,
              }, extractTaskFeatures(code, { intent: 'workflow_llm_node' }));

              newVariables[outputVar] = result.success ? { result: result.content } : { error: result.message };
              newLogs.push({
                id: `log-${generateId()}`,
                nodeId: currentNode.id,
                nodeName: currentNode.name,
                timestamp: new Date().toISOString(),
                level: result.success ? 'success' : 'error',
                message: result.success
                  ? `代码由 LLM 模拟执行完成 (无 SSH 主机可用)`
                  : `代码执行失败: ${result.message}`,
              });
            } else {
              // 完全模拟
              newVariables[outputVar] = { result: '[模拟] 无可用主机或 LLM 渠道', simulated: true };
              newLogs.push({
                id: `log-${generateId()}`,
                nodeId: currentNode.id,
                nodeName: currentNode.name,
                timestamp: new Date().toISOString(),
                level: 'warn',
                message: '无 SSH 主机或 LLM 渠道，使用模拟结果',
              });
            }
          }
        } catch (error: any) {
          newVariables[outputVar] = { error: error.message };
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'error',
            message: `代码执行异常: ${error.message}`,
          });
        }
        break;
      }

      case 'http': {
        const config = currentNode.defaultData?.httpConfig;
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `发送 ${config?.method || 'GET'} 请求: ${config?.url || '未配置 URL'}`,
        });

        // 真实 HTTP 请求
        try {
          // 变量替换 {{变量名}} 模板
          let url = substituteTemplate(config?.url || '', newVariables);

          if (!url) {
            newLogs.push({
              id: `log-${generateId()}`,
              nodeId: currentNode.id,
              nodeName: currentNode.name,
              timestamp: new Date().toISOString(),
              level: 'error',
              message: '未配置请求 URL',
            });
            const outputVar = config?.outputVariable || 'http_response';
            newVariables[outputVar] = { error: '未配置 URL' };
          } else {
            const method = config?.method || 'GET';
            const headers: Record<string, string> = config?.headers || {};
            let body: string | undefined;

            if (method !== 'GET') {
              if (config?.bodyType === 'json' && config?.body) {
                // 变量替换
                body = substituteTemplate(config.body, newVariables);
                headers['Content-Type'] = 'application/json';
              } else if (config?.body) {
                body = config.body;
              }
            }

            const response = await fetch(url, {
              method,
              headers,
              body,
              signal: AbortSignal.timeout(config?.timeout || 10000),
            });

            const outputVar = config?.outputVariable || 'http_response';

            if (response.ok) {
              const contentType = response.headers.get('content-type') || '';
              let data: any;
              if (contentType.includes('application/json')) {
                data = await response.json();
              } else {
                data = await response.text();
              }

              newVariables[outputVar] = {
                status: response.status,
                data,
                headers: Object.fromEntries(response.headers.entries()),
              };
              newLogs.push({
                id: `log-${generateId()}`,
                nodeId: currentNode.id,
                nodeName: currentNode.name,
                timestamp: new Date().toISOString(),
                level: 'success',
                message: `HTTP 请求成功 (${response.status})`,
                data: { status: response.status },
              });
            } else {
              const errorText = await response.text().catch(() => '');
              newVariables[outputVar] = {
                status: response.status,
                error: errorText.slice(0, 500),
              };
              newLogs.push({
                id: `log-${generateId()}`,
                nodeId: currentNode.id,
                nodeName: currentNode.name,
                timestamp: new Date().toISOString(),
                level: 'error',
                message: `HTTP 请求失败 (${response.status}): ${errorText.slice(0, 100)}`,
                data: { status: response.status },
              });
            }
          }
        } catch (error: any) {
          const outputVar = config?.outputVariable || 'http_response';
          newVariables[outputVar] = { error: error.message };
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'error',
            message: `HTTP 请求异常: ${error.message}`,
          });
        }
        break;
      }

      case 'host': {
        const config = currentNode.defaultData?.hostConfig;
        const host = state.hosts.find((h) => h.id === config?.hostId);
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: config?.operation === 'command'
            ? `在远程主机 ${host?.name || config?.hostId} 执行命令: ${config.command?.slice(0, 50) || '未配置命令'}`
            : `远程主机文件操作`,
        });

        if (!host) {
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'error',
            message: '未找到配置的远程主机',
          });
          break;
        }

        if (config?.operation === 'command' && config.command) {
          try {
            await sshApi.connect({
              hostId: host.id,
              host: host.host,
              port: host.port,
              username: host.username,
              authType: host.authType,
              password: host.password,
              privateKey: host.privateKey,
            });

            const result = await sshApi.execute({
              hostId: host.id,
              command: config.command,
            });

            const outputVar = config?.outputVariable || 'host_output';
            newVariables[outputVar] = {
              exitCode: result.success ? 0 : 1,
              stdout: result.stdout || '',
              stderr: result.stderr || '',
            };

            if (result.success) {
              newLogs.push({
                id: `log-${generateId()}`,
                nodeId: currentNode.id,
                nodeName: currentNode.name,
                timestamp: new Date().toISOString(),
                level: 'success',
                message: `远程执行完成 (exit code: 0)`,
                data: { exitCode: 0, stdout: result.stdout },
              });
            } else {
              newLogs.push({
                id: `log-${generateId()}`,
                nodeId: currentNode.id,
                nodeName: currentNode.name,
                timestamp: new Date().toISOString(),
                level: 'error',
                message: `远程执行失败: ${result.message || result.stderr}`,
                data: { exitCode: 1, stderr: result.stderr },
              });
            }
          } catch (error: any) {
            newLogs.push({
              id: `log-${generateId()}`,
              nodeId: currentNode.id,
              nodeName: currentNode.name,
              timestamp: new Date().toISOString(),
              level: 'error',
              message: `SSH 执行异常: ${error.message}`,
            });
          }
        } else {
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'warn',
            message: '未配置命令操作',
          });
        }
        break;
      }

      case 'condition': {
        const config = currentNode.defaultData?.conditionConfig;
        const conditions = config?.conditions || [];
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `条件判断，共 ${conditions.length} 个分支`,
        });

        // 逐条求值，命中首个为真的分支；都不命中走默认分支
        let matchedLabel = config?.defaultLabel || '默认分支';
        for (const cond of conditions) {
          const result = evalConditionExpression(cond.expression, newVariables);
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `分支「${cond.label}」: ${cond.expression || '(空)'} → ${result}`,
          });
          if (result) { matchedLabel = cond.label; break; }
        }

        // 依据命中分支的 label / sourceHandle 选择对应出边
        const outEdges = workflow.edges.filter((e) => e.source === currentNode.id);
        const matchedEdge =
          outEdges.find((e) => e.label === matchedLabel || e.sourceHandle === matchedLabel) ||
          outEdges.find((e) => (e.label || '').includes(matchedLabel)) ||
          outEdges[0];
        nextNodeIdOverride = matchedEdge ? matchedEdge.target : null;

        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: `匹配分支: ${matchedLabel}`,
        });
        break;
      }

      case 'loop': {
        const config = currentNode.defaultData?.loopConfig;
        const loopStateKey = `__loop_${currentNode.id}`;
        const total = config?.loopType === 'count'
          ? Math.max(0, Number(config?.count) || 0)
          : (Array.isArray(newVariables[config?.arrayVariable || '']) ? (newVariables[config?.arrayVariable || ''] as any[]).length : 0);

        const prev = (newVariables[loopStateKey] as { index: number } | undefined);
        const index = prev ? prev.index : 0;

        const outEdges = workflow.edges.filter((e) => e.source === currentNode.id);
        // 循环体出边：label/handle 含 body/循环/loop；退出出边：含 done/exit/结束/完成
        const bodyEdge =
          outEdges.find((e) => /body|循环|loop|item|迭代/i.test(`${e.label || ''}${e.sourceHandle || ''}`)) || outEdges[0];
        const exitEdge =
          outEdges.find((e) => /done|exit|结束|完成|end|out/i.test(`${e.label || ''}${e.sourceHandle || ''}`)) ||
          outEdges.find((e) => e !== bodyEdge) || null;

        if (index < total && bodyEdge) {
          // 注入当前迭代变量
          if (config?.indexVariable) newVariables[config.indexVariable] = index;
          if (config?.loopType === 'array' && config?.itemVariable) {
            const arr = newVariables[config?.arrayVariable || ''] as any[];
            newVariables[config.itemVariable] = arr?.[index];
          } else if (config?.itemVariable) {
            newVariables[config.itemVariable] = index;
          }
          newVariables[loopStateKey] = { index: index + 1 };
          nextNodeIdOverride = bodyEdge.target;
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `循环第 ${index + 1}/${total} 次`,
          });
        } else {
          // 循环结束：清理状态，走退出边
          delete newVariables[loopStateKey];
          nextNodeIdOverride = exitEdge ? exitEdge.target : null;
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'success',
            message: total === 0 ? '循环范围为空，跳过' : `循环完成，共 ${total} 次`,
          });
        }
        break;
      }

      case 'variable': {
        const config = currentNode.defaultData?.variableConfig;
        const name = config?.variableName;
        if (!name) {
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'warn',
            message: '变量节点未配置变量名',
          });
          break;
        }
        const op = config?.operation || 'set';
        const resolvedRaw = substituteTemplate(config?.value || '', newVariables);
        const resolved = coerceValue(resolvedRaw, config?.valueType);
        let finalValue: any;
        switch (op) {
          case 'append': {
            const cur = newVariables[name];
            if (Array.isArray(cur)) finalValue = [...cur, resolved];
            else if (typeof cur === 'string') finalValue = cur + String(resolved);
            else if (cur === undefined) finalValue = [resolved];
            else finalValue = [cur, resolved];
            break;
          }
          case 'increment': finalValue = (Number(newVariables[name]) || 0) + (Number(resolved) || 1); break;
          case 'decrement': finalValue = (Number(newVariables[name]) || 0) - (Number(resolved) || 1); break;
          case 'set':
          default: finalValue = resolved; break;
        }
        newVariables[name] = finalValue;
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: `变量 ${op}: ${name} = ${typeof finalValue === 'object' ? JSON.stringify(finalValue) : finalValue}`,
        });
        break;
      }

      case 'knowledge': {
        const kConfig = currentNode.defaultData?.knowledgeConfig;
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `检索知识库: ${kConfig?.query || '未指定查询'}`,
        });
        const kOutputVar = kConfig?.outputVariable || 'knowledge_result';
        try {
          // 注：需要 embedding 才能检索，这里先回退到关键词搜索
          const docs = await fetch('/api/knowledge').then(r => r.json());
          const query = (kConfig?.query || '').toLowerCase();
          const results = query
            ? docs.filter((d: any) => d.content.toLowerCase().includes(query) || d.title.toLowerCase().includes(query))
            : docs.slice(0, 3);
          newVariables[kOutputVar] = results;
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'success',
            message: `知识库检索完成，返回 ${results.length} 条记录`,
            data: { rows: results.length },
          });
        } catch (e) {
          newVariables[kOutputVar] = [];
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'error',
            message: `知识库检索失败`,
          });
        }
        break;
      }

      case 'database': {
        const config = currentNode.defaultData?.databaseConfig;
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `执行 ${config?.queryType || 'select'} 查询`,
        });
        const outputVar = config?.outputVariable || 'db_result';
        try {
          // 先只支持查询 LNAgent 自身的 SQLite 数据库
          const query = config?.sql || 'SELECT 1';
          const result = await fetch('/api/db/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
          }).then(r => r.json());
          newVariables[outputVar] = result.rows || [];
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'success',
            message: `数据库查询完成，返回 ${(result.rows || []).length} 条记录`,
            data: { rows: (result.rows || []).length },
          });
        } catch (e) {
          newVariables[outputVar] = [];
          newLogs.push({
            id: `log-${generateId()}`,
            nodeId: currentNode.id,
            nodeName: currentNode.name,
            timestamp: new Date().toISOString(),
            level: 'error',
            message: `数据库查询失败`,
          });
        }
        break;
      }

      case 'human_in_loop': {
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'warn',
          message: '等待人工审核...',
        });
        // 通过边路由找到下一个节点 ID，resume 时从下一节点开始
        const outgoingEdges = workflow.edges.filter(e => e.source === currentNode.id);
        const nextEdge = outgoingEdges[0]; // 简单取第一条出边
        const nextNodeId = nextEdge?.target || '';
        set((s) => ({
          executionState: {
            ...s.executionState,
            isRunning: false,
            status: 'paused',
            logs: newLogs,
            completedNodeIds: newCompleted,
            variables: newVariables,
            currentNodeId: nextNodeId || s.executionState.currentNodeId,
          },
        }));
        return;
      }

      case 'end': {
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: '工作流执行完成',
        });
        set((s) => ({
          executionState: {
            ...s.executionState,
            isRunning: false,
            status: 'completed',
            logs: newLogs,
            completedNodeIds: newCompleted,
            variables: newVariables,
            currentNodeId: null,
            endTime: new Date().toISOString(),
          },
        }));
        return;
      }

      default:
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: '节点执行完成',
        });
    }

    const nextEdges = workflow.edges.filter((e) => e.source === currentNode.id);
    let nextNodeId: string | null = null;

    if (nextNodeIdOverride !== undefined) {
      // condition/loop 节点已显式决定路由（可能为 null 表示结束）
      nextNodeId = nextNodeIdOverride;
    } else if (nextEdges.length > 0) {
      nextNodeId = nextEdges[0].target;
    }

    if (!nextNodeId) {
      newLogs.push({
        id: `log-${generateId()}`,
        nodeId: currentNode.id,
        nodeName: currentNode.name,
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: '没有后续节点，执行结束',
      });
      set((s) => ({
        executionState: {
          ...s.executionState,
          isRunning: false,
          status: 'completed',
          logs: newLogs,
          completedNodeIds: newCompleted,
          variables: newVariables,
          currentNodeId: null,
          endTime: new Date().toISOString(),
        },
      }));
      return;
    }

    set((s) => ({
      executionState: {
        ...s.executionState,
        currentNodeId: nextNodeId,
        completedNodeIds: newCompleted,
        variables: newVariables,
        logs: newLogs,
        iterationCount: currentIteration,
      },
    }));

    setTimeout(async () => {
      const currentState = get();
      if (currentState.executionState.isRunning && currentState.executionState.status === 'running') {
        get().stepExecution().catch((err: any) => { console.error('stepExecution error:', err); });
      }
    }, 500);
    } catch (err: any) {
      set((s) => ({
        executionState: {
          ...s.executionState,
          isRunning: false,
          status: 'failed',
          logs: [
            ...s.executionState.logs,
            {
              id: generateId(),
              nodeId: currentNode?.id || '',
              nodeName: currentNode?.name || '',
              timestamp: new Date().toISOString(),
              level: 'error',
              message: `执行异常: ${err.message}`,
            },
          ],
        },
      }));
    }
  },

  addExecutionLog: (log) =>
    set((state) => ({
      executionState: {
        ...state.executionState,
        logs: [
          ...state.executionState.logs,
          {
            ...log,
            id: `log-${generateId()}`,
            timestamp: new Date().toISOString(),
          },
        ],
      },
    })),
  setExecutionVariable: (name, value) =>
    set((state) => ({
      executionState: {
        ...state.executionState,
        variables: {
          ...state.executionState.variables,
          [name]: value,
        },
      },
      executionVariables: {
        ...state.executionVariables,
        [name]: value,
      },
    })),

  executionVariables: {},
  setExecutionVariables: (variables) =>
    set((state) => ({
      executionVariables: { ...state.executionVariables, ...variables },
      executionState: {
        ...state.executionState,
        variables: { ...state.executionState.variables, ...variables },
      },
    })),
  clearExecutionVariables: () =>
    set((state) => ({
      executionVariables: {},
      executionState: {
        ...state.executionState,
        variables: {},
      },
    })),

  workflows: [],
  agents: [],
  plugins: mockPlugins,
  templates: mockTemplates,
  messages: [],
  nodeTemplates: nodeTemplates,
  currentWorkflowId: null,
  currentAgentId: null,
  sidebarCollapsed: false,
  selectedNodeId: null,
  isRunning: false,

  setCurrentWorkflow: (id) => set({ currentWorkflowId: id }),
  setCurrentAgent: (id) => set({ currentAgentId: id }),
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  setSelectedNode: (id) => set({ selectedNodeId: id }),

  addMessage: async (message) => {
    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });
    } catch (e) {
      console.warn('Failed to persist message:', e);
    }
    set((state) => ({ messages: [...state.messages, message] }));
  },
  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),

  addNodeFromTemplate: (template) => {
    const currentWorkflowId = get().currentWorkflowId;
    if (!currentWorkflowId) return;
    const newNode: WorkflowNode = {
      id: `node-${generateId()}`,
      type: template.type,
      name: template.name,
      description: template.description,
      icon: template.icon,
      color: template.color,
      category: template.category,
      defaultData: template.defaultData,
    };
    set((state) => ({
      workflows: state.workflows.map((w) =>
        w.id === currentWorkflowId
          ? { ...w, nodes: [...w.nodes, newNode], updatedAt: new Date().toISOString() }
          : w
      ),
    }));
    scheduleWorkflowSync(currentWorkflowId);
  },

  togglePlugin: (id) =>
    set((state) => ({
      plugins: state.plugins.map((p) =>
        p.id === id ? { ...p, installed: !p.installed } : p
      ),
    })),

  createWorkflow: async (name, templateId) => {
    const template = templateId ? get().templates.find((t) => t.id === templateId) : null;
    const payload = {
      name,
      description: template?.description || '新创建的工作流',
      nodes: [],
      edges: [],
      status: 'draft',
      runs: 0,
      variables: {},
    };
    const created = await workflowApi.create(payload);
    set((state) => ({
      workflows: [created, ...state.workflows],
      currentWorkflowId: created.id,
    }));
    return created.id;
  },

  deleteWorkflow: async (id) => {
    await workflowApi.delete(id);
    set((state) => ({
      workflows: state.workflows.filter((w) => w.id !== id),
      currentWorkflowId:
        state.currentWorkflowId === id
          ? state.workflows.find((w) => w.id !== id)?.id || null
          : state.currentWorkflowId,
    }));
  },

  duplicateWorkflow: async (id) => {
    const source = get().workflows.find((w) => w.id === id);
    if (!source) return null;
    const payload = {
      ...source,
      name: `${source.name} 副本`,
      runs: 0,
    };
    const created = await workflowApi.create(payload);
    set((state) => ({ workflows: [created, ...state.workflows] }));
    return created.id;
  },

  updateWorkflow: async (id, updates) => {
    const updated = await workflowApi.update(id, updates);
    set((state) => ({
      workflows: state.workflows.map((w) =>
        w.id === id ? updated : w
      ),
    }));
  },

  updateWorkflowNode: (workflowId, nodeId, updates) => {
    set((state) => ({
      workflows: state.workflows.map((w) => {
        if (w.id !== workflowId) return w;
        return {
          ...w,
          nodes: w.nodes.map((n) => {
            if (n.id !== nodeId) return n;
            const { label, description, ...configUpdates } = updates as any;
            const newDefaultData = { ...(n.defaultData || {}), ...configUpdates };
            if (label !== undefined) newDefaultData.label = label;
            if (description !== undefined) newDefaultData.description = description;
            return {
              ...n,
              name: label || n.name,
              description: description !== undefined ? description : n.description,
              defaultData: newDefaultData as any,
            };
          }),
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    scheduleWorkflowSync(workflowId);
  },

  duplicateWorkflowNode: (workflowId, nodeId) => {
    set((state) => ({
      workflows: state.workflows.map((w) => {
        if (w.id !== workflowId) return w;
        const node = w.nodes.find((n) => n.id === nodeId);
        if (!node) return w;
        const newNode: WorkflowNode = {
          ...node,
          id: `node-${generateId()}`,
          name: `${node.name} (副本)`,
        };
        return {
          ...w,
          nodes: [...w.nodes, newNode],
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    scheduleWorkflowSync(workflowId);
  },

  removeWorkflowNode: (workflowId, nodeId) => {
    set((state) => ({
      workflows: state.workflows.map((w) =>
        w.id === workflowId
          ? {
              ...w,
              nodes: w.nodes.filter((n) => n.id !== nodeId),
              edges: w.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
              updatedAt: new Date().toISOString(),
            }
          : w
      ),
    }));
    scheduleWorkflowSync(workflowId);
  },

  addWorkflowEdge: (workflowId, edge) => {
    set((state) => ({
      workflows: state.workflows.map((w) =>
        w.id === workflowId
          ? { ...w, edges: [...w.edges, edge], updatedAt: new Date().toISOString() }
          : w
      ),
    }));
    scheduleWorkflowSync(workflowId);
  },

  removeWorkflowEdge: (workflowId, edgeId) => {
    set((state) => ({
      workflows: state.workflows.map((w) =>
        w.id === workflowId
          ? { ...w, edges: w.edges.filter((e) => e.id !== edgeId), updatedAt: new Date().toISOString() }
          : w
      ),
    }));
    scheduleWorkflowSync(workflowId);
  },

  addToolToNode: (workflowId, nodeId, tool) => {
    set((state) => ({
      workflows: state.workflows.map((w) => {
        if (w.id !== workflowId) return w;
        return {
          ...w,
          nodes: w.nodes.map((n) => {
            if (n.id !== nodeId) return n;
            const newTool: ToolConfig = { ...tool, id: `tool-${generateId()}` };
            const existingTools = (n as any).tools || [];
            return { ...n, tools: [...existingTools, newTool] } as any;
          }),
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    scheduleWorkflowSync(workflowId);
  },

  updateToolInNode: (workflowId, nodeId, toolId, updates) => {
    set((state) => ({
      workflows: state.workflows.map((w) => {
        if (w.id !== workflowId) return w;
        return {
          ...w,
          nodes: w.nodes.map((n) => {
            if (n.id !== nodeId) return n;
            const tools = (n as any).tools || [];
            return {
              ...n,
              tools: tools.map((t: ToolConfig) =>
                t.id === toolId ? { ...t, ...updates } : t
              ),
            } as any;
          }),
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    scheduleWorkflowSync(workflowId);
  },

  removeToolFromNode: (workflowId, nodeId, toolId) => {
    set((state) => ({
      workflows: state.workflows.map((w) => {
        if (w.id !== workflowId) return w;
        return {
          ...w,
          nodes: w.nodes.map((n) => {
            if (n.id !== nodeId) return n;
            const tools = (n as any).tools || [];
            return {
              ...n,
              tools: tools.filter((t: ToolConfig) => t.id !== toolId),
            } as any;
          }),
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    scheduleWorkflowSync(workflowId);
  },

  toggleToolEnabled: (workflowId, nodeId, toolId) => {
    set((state) => ({
      workflows: state.workflows.map((w) => {
        if (w.id !== workflowId) return w;
        return {
          ...w,
          nodes: w.nodes.map((n) => {
            if (n.id !== nodeId) return n;
            const tools = (n as any).tools || [];
            return {
              ...n,
              tools: tools.map((t: ToolConfig) =>
                t.id === toolId ? { ...t, enabled: !t.enabled } : t
              ),
            } as any;
          }),
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    scheduleWorkflowSync(workflowId);
  },

  addCheckpoint: (workflowId, label, snapshot) =>
    set((state) => {
      const list = state.checkpoints[workflowId] || [];
      const checkpoint: Checkpoint = {
        id: `cp-${generateId()}`,
        label: label.trim() || `检查点 ${list.length + 1}`,
        timestamp: new Date().toISOString(),
        nodes: JSON.parse(JSON.stringify(snapshot.nodes || [])),
        edges: JSON.parse(JSON.stringify(snapshot.edges || [])),
      };
      return {
        checkpoints: {
          ...state.checkpoints,
          [workflowId]: [...list, checkpoint],
        },
      };
    }),

  deleteCheckpoint: (workflowId, checkpointId) =>
    set((state) => {
      const list = state.checkpoints[workflowId] || [];
      return {
        checkpoints: {
          ...state.checkpoints,
          [workflowId]: list.filter((c) => c.id !== checkpointId),
        },
      };
    }),

  startRun: () => set({ isRunning: true }),
  stopRun: () => set({ isRunning: false }),

  createAgent: async (agent) => {
    const created = await agentApi.create(agent);
    set((state) => ({ agents: [...state.agents, created] }));
    // 自动注册到 Runtime Registry
    const registry = getAgentRuntimeRegistry();
    const capabilities = (agent.tools || []).map(t => t);
    if (agent.description) {
      const desc = agent.description.toLowerCase();
      if (desc.includes('代码') || desc.includes('code')) capabilities.push('code');
      if (desc.includes('写') || desc.includes('write')) capabilities.push('writing');
      if (desc.includes('分析') || desc.includes('analyze')) capabilities.push('reasoning');
      if (desc.includes('搜索') || desc.includes('search')) capabilities.push('search');
    }
    registry.register(created.id, capabilities);
  },

  updateAgent: async (id, updates) => {
    const updated = await agentApi.update(id, updates);
    set((state) => ({
      agents: state.agents.map((a) => (a.id === id ? updated : a)),
    }));
  },

  deleteAgent: async (id) => {
    getAgentRuntimeRegistry().unregister(id);
    await agentApi.delete(id);
    set((state) => ({
      agents: state.agents.filter((a) => a.id !== id),
      currentAgentId: state.currentAgentId === id ? null : state.currentAgentId,
    }));
  },

  // Meta-Skill (Skill-MAS)
  metaSkill: INITIAL_META_SKILL,
  updateMetaSkill: (skill) => set({ metaSkill: skill }),

  // Experience Bank
  experienceBank: [],
  addTrace: (trace) =>
    set((state) => ({ experienceBank: [...state.experienceBank, trace] })),
  setExperienceBank: (traces) => set({ experienceBank: traces }),
  clearTraces: () => set({ experienceBank: [] }),

  // Router Memory (ACRouter 模型级表现记忆)
  routerMemory: [],
  addRouterRecord: (record) =>
    set((state) => ({ routerMemory: [...state.routerMemory, record] })),
  clearRouterMemory: () => set({ routerMemory: [] }),
  setRouterMemory: (records) => set({ routerMemory: records }),

  // MCP Servers
  mcps: [],

  // 检查点（命名快照）
  checkpoints: {},
  addMCP: (server) =>
    set((state) => ({
      mcps: [
        ...state.mcps,
        {
          ...server,
          id: generateId(),
          status: 'disconnected',
          tools: [],
          createdAt: new Date().toISOString(),
        },
      ],
    })),
  updateMCP: (id, updates) =>
    set((state) => ({
      mcps: state.mcps.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),
  deleteMCP: (id) =>
    set((state) => ({ mcps: state.mcps.filter((m) => m.id !== id) })),
  setMCPStatus: (id, status, tools, lastError) =>
    set((state) => ({
      mcps: state.mcps.map((m) =>
        m.id === id
          ? { ...m, status, tools: tools ?? m.tools, lastError: lastError ?? m.lastError }
          : m,
      ),
    })),

  // ===== 统一记忆架构（Phase 10） =====

  // L0: Working Memory（非持久化）
  sessionMemories: {},
  setSessionMemory: (sessionId, memory) =>
    set((state) => ({
      sessionMemories: { ...state.sessionMemories, [sessionId]: memory },
    })),
  clearSessionMemory: (sessionId) =>
    set((state) => {
      const mems = { ...state.sessionMemories };
      delete mems[sessionId];
      return { sessionMemories: mems };
    }),

  // L1: Factual Memory（持久化）
  factualMemory: [],
  addFactualMemory: (memory) =>
    set((state) => ({
      factualMemory: [
        ...state.factualMemory,
        {
          ...memory,
          id: `fm-${generateId()}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          accessCount: 0,
        },
      ],
    })),
  updateFactualMemory: (id, updates) =>
    set((state) => ({
      factualMemory: state.factualMemory.map((m) =>
        m.id === id ? { ...m, ...updates, updatedAt: new Date().toISOString() } : m
      ),
    })),
  deleteFactualMemory: (id) =>
    set((state) => ({
      factualMemory: state.factualMemory.filter((m) => m.id !== id),
    })),
  incrementFactualAccess: (id) =>
    set((state) => ({
      factualMemory: state.factualMemory.map((m) =>
        m.id === id
          ? { ...m, accessCount: m.accessCount + 1, lastAccessedAt: new Date().toISOString() }
          : m
      ),
    })),
  setFactualMemory: (memories) => set({ factualMemory: memories }),

  // L2-B: Experiential Reflections（持久化）
  experientialReflections: [],
  addExperientialReflection: (reflection) =>
    set((state) => ({
      experientialReflections: [...state.experientialReflections, reflection],
    })),
  updateExperientialReflection: (id, updates) =>
    set((state) => ({
      experientialReflections: state.experientialReflections.map((r) =>
        r.id === id ? { ...r, ...updates } : r
      ),
    })),
  deleteExperientialReflection: (id) =>
    set((state) => ({
      experientialReflections: state.experientialReflections.filter((r) => r.id !== id),
    })),
  setExperientialReflections: (reflections) => set({ experientialReflections: reflections }),

  // 横切: Auto Extraction 光标（持久化）
  extractionCursors: {},
  setExtractionCursor: (sessionId, messageId) =>
    set((state) => ({
      extractionCursors: { ...state.extractionCursors, [sessionId]: messageId },
    })),

  // 横切: Auto Dream 日志（持久化）
  dreamLogs: [],
  addDreamLog: (log) =>
    set((state) => ({ dreamLogs: [...state.dreamLogs, log] })),

  // 横切: Handoff Summary 历史（持久化）
  handoffSummaries: [],
  addHandoffSummary: (summary) =>
    set((state) => ({ handoffSummaries: [...state.handoffSummaries, summary] })),

  // 横切: Memory Audit 日志（持久化）
  memoryAuditLog: [],
  addMemoryAudit: (entry) =>
    set((state) => ({
      memoryAuditLog: [
        ...state.memoryAuditLog,
        {
          ...entry,
          id: `audit-${generateId()}`,
          timestamp: new Date().toISOString(),
        },
      ],
    })),

  // ===== Workflow Editor (React Flow) =====
  workflowEditorNodes: [],
  workflowEditorEdges: [],
  workflowEditorSelectedNodeId: null,
  workflowEditorSelectedEdgeId: null,
  workflowEditorPast: [],
  workflowEditorFuture: [],

  addWorkflowEditorNode: (node) => {
    const state = get();
    const newNode: FlowNode = {
      ...node,
      id: node.id || `node-${generateId()}`,
    };
    const snapshot = { nodes: state.workflowEditorNodes, edges: state.workflowEditorEdges };
    const newPast = [...state.workflowEditorPast, snapshot].slice(-50);
    set({
      workflowEditorNodes: [...state.workflowEditorNodes, newNode],
      workflowEditorPast: newPast,
      workflowEditorFuture: [],
    });
  },

  updateWorkflowEditorNode: (id, updates) => {
    const state = get();
    const snapshot = { nodes: state.workflowEditorNodes, edges: state.workflowEditorEdges };
    const newPast = [...state.workflowEditorPast, snapshot].slice(-50);
    set({
      workflowEditorNodes: state.workflowEditorNodes.map((n) =>
        n.id === id ? { ...n, ...updates } : n
      ),
      workflowEditorPast: newPast,
      workflowEditorFuture: [],
    });
  },

  deleteWorkflowEditorNode: (id) => {
    const state = get();
    const snapshot = { nodes: state.workflowEditorNodes, edges: state.workflowEditorEdges };
    const newPast = [...state.workflowEditorPast, snapshot].slice(-50);
    set({
      workflowEditorNodes: state.workflowEditorNodes.filter((n) => n.id !== id),
      workflowEditorEdges: state.workflowEditorEdges.filter((e) => e.source !== id && e.target !== id),
      workflowEditorPast: newPast,
      workflowEditorFuture: [],
      workflowEditorSelectedNodeId: state.workflowEditorSelectedNodeId === id ? null : state.workflowEditorSelectedNodeId,
    });
  },

  addWorkflowEditorEdge: (edge) => {
    const state = get();
    const newEdge: FlowEdge = {
      ...edge,
      id: edge.id || `edge-${generateId()}`,
    };
    const snapshot = { nodes: state.workflowEditorNodes, edges: state.workflowEditorEdges };
    const newPast = [...state.workflowEditorPast, snapshot].slice(-50);
    set({
      workflowEditorEdges: [...state.workflowEditorEdges, newEdge],
      workflowEditorPast: newPast,
      workflowEditorFuture: [],
    });
  },

  updateWorkflowEditorEdge: (id, updates) => {
    const state = get();
    const snapshot = { nodes: state.workflowEditorNodes, edges: state.workflowEditorEdges };
    const newPast = [...state.workflowEditorPast, snapshot].slice(-50);
    set({
      workflowEditorEdges: state.workflowEditorEdges.map((e) =>
        e.id === id ? { ...e, ...updates } : e
      ),
      workflowEditorPast: newPast,
      workflowEditorFuture: [],
    });
  },

  deleteWorkflowEditorEdge: (id) => {
    const state = get();
    const snapshot = { nodes: state.workflowEditorNodes, edges: state.workflowEditorEdges };
    const newPast = [...state.workflowEditorPast, snapshot].slice(-50);
    set({
      workflowEditorEdges: state.workflowEditorEdges.filter((e) => e.id !== id),
      workflowEditorPast: newPast,
      workflowEditorFuture: [],
      workflowEditorSelectedEdgeId: state.workflowEditorSelectedEdgeId === id ? null : state.workflowEditorSelectedEdgeId,
    });
  },

  undoWorkflowEditor: () => {
    const state = get();
    if (state.workflowEditorPast.length === 0) return;
    const previous = state.workflowEditorPast[state.workflowEditorPast.length - 1];
    const newPast = state.workflowEditorPast.slice(0, -1);
    const currentSnapshot = { nodes: state.workflowEditorNodes, edges: state.workflowEditorEdges };
    set({
      workflowEditorNodes: previous.nodes,
      workflowEditorEdges: previous.edges,
      workflowEditorPast: newPast,
      workflowEditorFuture: [currentSnapshot, ...state.workflowEditorFuture],
      workflowEditorSelectedNodeId: null,
      workflowEditorSelectedEdgeId: null,
    });
  },

  redoWorkflowEditor: () => {
    const state = get();
    if (state.workflowEditorFuture.length === 0) return;
    const next = state.workflowEditorFuture[0];
    const newFuture = state.workflowEditorFuture.slice(1);
    const currentSnapshot = { nodes: state.workflowEditorNodes, edges: state.workflowEditorEdges };
    set({
      workflowEditorNodes: next.nodes,
      workflowEditorEdges: next.edges,
      workflowEditorPast: [...state.workflowEditorPast, currentSnapshot].slice(-50),
      workflowEditorFuture: newFuture,
      workflowEditorSelectedNodeId: null,
      workflowEditorSelectedEdgeId: null,
    });
  },

  setWorkflowEditorSelectedNode: (id) =>
    set({ workflowEditorSelectedNodeId: id, workflowEditorSelectedEdgeId: null }),

  setWorkflowEditorSelectedEdge: (id) =>
    set({ workflowEditorSelectedEdgeId: id, workflowEditorSelectedNodeId: null }),

  loadWorkflowToEditor: (workflowId) => {
    const state = get();
    const workflow = state.workflows.find((w) => w.id === workflowId);
    if (!workflow) return;

    const flowNodes: FlowNode[] = workflow.nodes.map((node, index) => ({
      id: node.id,
      type: node.type,
      position: { x: 100 + (index % 3) * 250, y: 100 + Math.floor(index / 3) * 200 },
      data: {
        label: node.name,
        description: node.description,
        iconName: node.icon,
        type: node.type,
        ...node.defaultData,
      } as FlowNodeData,
    }));

    const flowEdges: FlowEdge[] = workflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
      label: edge.label,
      animated: false,
    }));

    set({
      workflowEditorNodes: flowNodes,
      workflowEditorEdges: flowEdges,
      workflowEditorPast: [],
      workflowEditorFuture: [],
      workflowEditorSelectedNodeId: null,
      workflowEditorSelectedEdgeId: null,
    });
  },

  clearWorkflowEditor: () =>
    set({
      workflowEditorNodes: [],
      workflowEditorEdges: [],
      workflowEditorPast: [],
      workflowEditorFuture: [],
      workflowEditorSelectedNodeId: null,
      workflowEditorSelectedEdgeId: null,
    }),

  // ===== 工作流调试器 =====
  breakpoints: [],
  nodeExecutionStatuses: {},

  toggleBreakpoint: (nodeId: string) =>
    set((state) => {
      const hasBreakpoint = state.breakpoints.includes(nodeId);
      return {
        breakpoints: hasBreakpoint
          ? state.breakpoints.filter((id) => id !== nodeId)
          : [...state.breakpoints, nodeId],
      };
    }),

  clearBreakpoints: () => set({ breakpoints: [] }),

  setNodeExecutionStatus: (nodeId: string, status: NodeExecutionStatus) =>
    set((state) => ({
      nodeExecutionStatuses: {
        ...state.nodeExecutionStatuses,
        [nodeId]: status,
      },
    })),

  clearNodeExecutionStatuses: () => set({ nodeExecutionStatuses: {} }),
    }),
    {
      name: 'lnagent-data',
      // 持久化核心业务数据 + UI 状态 + 认证信息
      // 后端连接异常时，前端仍能保留 channels/agents/workflows 等核心数据
      partialize: (state) => ({
        // 认证
        currentUser: state.currentUser,
        isFirstTime: state.isFirstTime,
        // 核心业务数据（必须持久化，否则刷新即丢失）
        channels: state.channels,
        workflows: state.workflows,
        agents: state.agents,
        hosts: state.hosts,
        mcps: state.mcps,
        metaSkill: state.metaSkill,
        // 模型路由与偏好
        defaultModelId: state.defaultModelId,
        routerEnabled: state.routerEnabled,
        visionModelId: state.visionModelId,
        theme: state.theme,
        // UI 状态
        currentWorkflowId: state.currentWorkflowId,
        currentAgentId: state.currentAgentId,
        sidebarCollapsed: state.sidebarCollapsed,
        // 记忆系统（持久化层）
        factualMemory: state.factualMemory,
        experientialReflections: state.experientialReflections,
        routerMemory: state.routerMemory,
        // sessionMemories 不持久化（L0 仅存活于会话内）
      }),
      // 存储序列化冲突时静默处理
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          try {
            return JSON.parse(str);
          } catch {
            localStorage.removeItem(name);
            return null;
          }
        },
        setItem: (name, value) => {
          try {
            localStorage.setItem(name, JSON.stringify(value));
            return;
          } catch (e) {
            console.warn('localStorage 配额超限，对本次写入的新数据渐进裁剪后重试:', e);
          }
          // 关键：裁剪的是「本次要写入的新值」而非磁盘旧值，避免丢失最新业务数据。
          // 按「体积大 + 可再生」优先级逐步丢弃非核心字段，尽量保住 workflows/agents/channels 等核心数据。
          const v: any = value;
          const trimSteps: Array<() => void> = [
            () => { if (v.state?.memoryAuditLog) v.state.memoryAuditLog = v.state.memoryAuditLog.slice(-50); },
            () => { if (v.state?.dreamLogs) v.state.dreamLogs = v.state.dreamLogs.slice(-10); },
            () => { if (v.state?.routerMemory?.length > 200) v.state.routerMemory = v.state.routerMemory.slice(-200); },
            () => { if (v.state?.experienceBank?.length > 100) v.state.experienceBank = v.state.experienceBank.slice(-100); },
            () => { if (v.state?.experientialReflections?.length > 50) v.state.experientialReflections = v.state.experientialReflections.slice(-50); },
            () => { if (v.state?.messages?.length > 100) v.state.messages = v.state.messages.slice(-100); },
            () => { if (v.state?.checkpoints) v.state.checkpoints = {}; },
            () => { if (v.state?.routerMemory) v.state.routerMemory = []; },
            () => { if (v.state?.experienceBank) v.state.experienceBank = []; },
            () => { if (v.state?.handoffSummaries) v.state.handoffSummaries = []; },
          ];
          for (const step of trimSteps) {
            try {
              step();
              localStorage.setItem(name, JSON.stringify(v));
              console.warn('裁剪后写入成功，已丢弃部分历史/经验数据以腾出空间');
              return;
            } catch {
              // 继续下一级裁剪
            }
          }
          // 兜底：仍写不下，尽量只保留最核心字段
          try {
            const core = {
              state: {
                currentUser: v.state?.currentUser,
                isFirstTime: v.state?.isFirstTime,
                workflows: v.state?.workflows,
                agents: v.state?.agents,
                channels: v.state?.channels,
                hosts: v.state?.hosts,
                defaultModelId: v.state?.defaultModelId,
                routerEnabled: v.state?.routerEnabled,
                theme: v.state?.theme,
              },
              version: v.version,
            };
            localStorage.setItem(name, JSON.stringify(core));
            console.warn('仅保留核心业务数据写入');
          } catch {
            console.error('localStorage 写入彻底失败，保留磁盘上已有数据不清空');
            // 不再 removeItem，避免把用户之前成功保存的数据也抹掉
          }
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
      // 首次加载时：如果 localStorage 无数据，使用 mock 数据
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AppState> | null;
        if (!persisted || Object.keys(persisted).length === 0) {
          return currentState;
        }
        // 合并：persisted 只覆盖 UI 状态，业务数据由 App.tsx 的 useDataInit 从后端加载
        return { ...currentState, ...persisted };
      },
    },
  ),
);
