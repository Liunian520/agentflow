import { create } from 'zustand';
import type { Workflow, Agent, ChatMessage, Plugin, Template, WorkflowNode, WorkflowEdge, NodeData, ToolConfig, User, Channel, RemoteHost, ExecutionState, ExecutionLog } from '../types';
import { mockWorkflows, mockAgents, mockPlugins, mockTemplates, mockMessages, nodeTemplates, mockHosts } from '../data/mockData';
import { generateId } from '../lib/utils';
import { sshApi } from '../api/sshApi';

// 超级管理员账号（硬编码）
const SUPER_ADMIN: User = {
  id: 'admin-001',
  username: 'Liunian',
  password: 'qq2232401260',
  role: 'admin',
  avatar: '👑',
  createdAt: '2024-01-01T00:00:00Z',
};

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
  login: (username: string, password: string) => boolean;
  logout: () => void;

  // Channels
  channels: Channel[];
  addChannel: (channel: Omit<Channel, 'id' | 'createdAt'>) => void;
  updateChannel: (id: string, updates: Partial<Channel>) => void;
  deleteChannel: (id: string) => void;
  toggleChannelEnabled: (id: string) => void;
  getAvailableModels: () => { channelId: string; channelName: string; model: { name: string; displayName: string } }[];

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
  stepExecution: () => void;
  addExecutionLog: (log: Omit<ExecutionLog, 'id' | 'timestamp'>) => void;
  setExecutionVariable: (name: string, value: any) => void;

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
  addMessage: (message: ChatMessage) => void;
  togglePlugin: (id: string) => void;
  addNodeFromTemplate: (template: WorkflowNode & { defaultData?: Partial<NodeData> }) => void;
  createWorkflow: (name: string, templateId?: string) => string;
  deleteWorkflow: (id: string) => void;
  duplicateWorkflow: (id: string) => string | null;
  updateWorkflow: (id: string, updates: Partial<Workflow>) => void;
  updateWorkflowNode: (workflowId: string, nodeId: string, updates: Partial<NodeData>) => void;
  duplicateWorkflowNode: (workflowId: string, nodeId: string) => void;
  removeWorkflowNode: (workflowId: string, nodeId: string) => void;
  addWorkflowEdge: (workflowId: string, edge: WorkflowEdge) => void;
  removeWorkflowEdge: (workflowId: string, edgeId: string) => void;
  addToolToNode: (workflowId: string, nodeId: string, tool: Omit<ToolConfig, 'id'>) => void;
  updateToolInNode: (workflowId: string, nodeId: string, toolId: string, updates: Partial<ToolConfig>) => void;
  removeToolFromNode: (workflowId: string, nodeId: string, toolId: string) => void;
  toggleToolEnabled: (workflowId: string, nodeId: string, toolId: string) => void;
  startRun: () => void;
  stopRun: () => void;

  createAgent: (agent: Omit<Agent, 'id' | 'createdAt'>) => void;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  deleteAgent: (id: string) => void;
}

const STORAGE_KEY = 'agentflow_user';

const loadUserFromStorage = (): User | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load user from storage:', e);
  }
  return null;
};

const saveUserToStorage = (user: User | null) => {
  try {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {
    console.error('Failed to save user to storage:', e);
  }
};

export const useStore = create<AppState>((set, get) => ({
  // Auth
  currentUser: loadUserFromStorage(),
  login: (username, password) => {
    if (username === SUPER_ADMIN.username && password === SUPER_ADMIN.password) {
      const user = { ...SUPER_ADMIN, password: '' };
      set({ currentUser: user });
      saveUserToStorage(user);
      return true;
    }
    return false;
  },
  logout: () => {
    set({ currentUser: null });
    saveUserToStorage(null);
  },

  // Channels
  channels: [],
  addChannel: (channel) =>
    set((state) => ({
      channels: [
        ...state.channels,
        {
          ...channel,
          id: `ch-${generateId()}`,
          createdAt: new Date().toISOString(),
        },
      ],
    })),
  updateChannel: (id, updates) =>
    set((state) => ({
      channels: state.channels.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })),
  deleteChannel: (id) =>
    set((state) => ({
      channels: state.channels.filter((c) => c.id !== id),
    })),
  toggleChannelEnabled: (id) =>
    set((state) => ({
      channels: state.channels.map((c) =>
        c.id === id ? { ...c, enabled: !c.enabled } : c
      ),
    })),
  getAvailableModels: () => {
    const channels = get().channels.filter((c) => c.enabled);
    const models: { channelId: string; channelName: string; model: { name: string; displayName: string } }[] = [];
    channels.forEach((ch) => {
      ch.models.forEach((m) => {
        models.push({ channelId: ch.id, channelName: ch.name, model: { name: m.name, displayName: m.displayName } });
      });
    });
    return models;
  },

  // Remote Hosts
  hosts: mockHosts,
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
      get().stepExecution();
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
      get().stepExecution();
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

    const currentNode = workflow.nodes.find((n) => n.id === executionState.currentNodeId);
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
        const mockResult = `这是大模型生成的结果，基于提示词生成的模拟响应。当前时间: ${new Date().toLocaleTimeString()}`;
        const outputVar = config?.outputVariable || 'llm_output';
        newVariables[outputVar] = mockResult;
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: `大模型调用完成，输出写入变量 \`${outputVar}\``,
          data: { [outputVar]: mockResult },
        });
        break;
      }

      case 'agent': {
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Agent 开始执行任务...',
        });
        newVariables['agent_result'] = {
          status: 'completed',
          output: 'Agent 任务执行完成',
          steps: 3,
        };
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: 'Agent 任务执行完成',
          data: { steps: 3, tools_called: 2 },
        });
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
        newVariables[outputVar] = { result: 42, processed: true };
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: `代码执行完成，输出写入变量 \`${outputVar}\``,
          data: { [outputVar]: newVariables[outputVar] },
        });
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
        const outputVar = config?.outputVariable || 'http_response';
        newVariables[outputVar] = {
          status: 200,
          data: { success: true, message: '模拟响应' },
          headers: { 'content-type': 'application/json' },
        };
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: `HTTP 请求成功 (200)`,
          data: { status: 200, responseTime: '123ms' },
        });
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
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `条件判断，共 ${config?.conditions?.length || 0} 个分支`,
        });
        const matchedBranch = config?.conditions?.[0]?.label || '默认分支';
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: `匹配分支: ${matchedBranch}`,
        });
        break;
      }

      case 'loop': {
        const config = currentNode.defaultData?.loopConfig;
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: config?.loopType === 'count'
            ? `循环开始，共 ${config.count} 次`
            : `数组循环开始`,
        });
        break;
      }

      case 'variable': {
        const config = currentNode.defaultData?.variableConfig;
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: `变量 ${config?.operation || 'set'}: ${config?.variableName || '未命名'}`,
        });
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
        newVariables[outputVar] = [{ id: 1, name: '示例数据' }];
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: `数据库查询完成，返回 1 条记录`,
          data: { rows: 1 },
        });
        break;
      }

      case 'human-in-loop': {
        newLogs.push({
          id: `log-${generateId()}`,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          timestamp: new Date().toISOString(),
          level: 'warn',
          message: '等待人工审核...',
        });
        set((s) => ({
          executionState: {
            ...s.executionState,
            isRunning: false,
            status: 'paused',
            logs: newLogs,
            completedNodeIds: newCompleted,
            variables: newVariables,
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

    if (nextEdges.length > 0) {
      if (nodeType === 'condition' && nextEdges.length > 1) {
        nextNodeId = nextEdges[0].target;
      } else {
        nextNodeId = nextEdges[0].target;
      }
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
        await get().stepExecution();
      }
    }, 500);
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
    })),

  workflows: mockWorkflows,
  agents: mockAgents,
  plugins: mockPlugins,
  templates: mockTemplates,
  messages: mockMessages,
  nodeTemplates: nodeTemplates,
  currentWorkflowId: mockWorkflows[0]?.id || null,
  currentAgentId: null,
  sidebarCollapsed: false,
  selectedNodeId: null,
  isRunning: false,

  setCurrentWorkflow: (id) => set({ currentWorkflowId: id }),
  setCurrentAgent: (id) => set({ currentAgentId: id }),
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  setSelectedNode: (id) => set({ selectedNodeId: id }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

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
  },

  togglePlugin: (id) =>
    set((state) => ({
      plugins: state.plugins.map((p) =>
        p.id === id ? { ...p, installed: !p.installed } : p
      ),
    })),

  createWorkflow: (name, templateId) => {
    const template = templateId ? get().templates.find((t) => t.id === templateId) : null;
    const newWorkflow: Workflow = {
      id: `wf-${generateId()}`,
      name,
      description: template?.description || '新创建的工作流',
      nodes: [],
      edges: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'draft',
      runs: 0,
      variables: [],
    };
    set((state) => ({
      workflows: [newWorkflow, ...state.workflows],
      currentWorkflowId: newWorkflow.id,
    }));
    return newWorkflow.id;
  },

  deleteWorkflow: (id) =>
    set((state) => ({
      workflows: state.workflows.filter((w) => w.id !== id),
      currentWorkflowId:
        state.currentWorkflowId === id
          ? state.workflows.find((w) => w.id !== id)?.id || null
          : state.currentWorkflowId,
    })),

  duplicateWorkflow: (id) => {
    const source = get().workflows.find((w) => w.id === id);
    if (!source) return null;
    const newId = `wf-${generateId()}`;
    const newWorkflow: Workflow = {
      ...source,
      id: newId,
      name: `${source.name} 副本`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runs: 0,
    };
    set((state) => ({ workflows: [newWorkflow, ...state.workflows] }));
    return newId;
  },

  updateWorkflow: (id, updates) =>
    set((state) => ({
      workflows: state.workflows.map((w) =>
        w.id === id ? { ...w, ...updates, updatedAt: new Date().toISOString() } : w
      ),
    })),

  updateWorkflowNode: (workflowId, nodeId, updates) =>
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
    })),

  duplicateWorkflowNode: (workflowId, nodeId) =>
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
    })),

  removeWorkflowNode: (workflowId, nodeId) =>
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
    })),

  addWorkflowEdge: (workflowId, edge) =>
    set((state) => ({
      workflows: state.workflows.map((w) =>
        w.id === workflowId
          ? { ...w, edges: [...w.edges, edge], updatedAt: new Date().toISOString() }
          : w
      ),
    })),

  removeWorkflowEdge: (workflowId, edgeId) =>
    set((state) => ({
      workflows: state.workflows.map((w) =>
        w.id === workflowId
          ? { ...w, edges: w.edges.filter((e) => e.id !== edgeId), updatedAt: new Date().toISOString() }
          : w
      ),
    })),

  addToolToNode: (workflowId, nodeId, tool) =>
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
    })),

  updateToolInNode: (workflowId, nodeId, toolId, updates) =>
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
    })),

  removeToolFromNode: (workflowId, nodeId, toolId) =>
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
    })),

  toggleToolEnabled: (workflowId, nodeId, toolId) =>
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
    })),

  startRun: () => set({ isRunning: true }),
  stopRun: () => set({ isRunning: false }),

  createAgent: (agent) =>
    set((state) => ({
      agents: [
        ...state.agents,
        {
          ...agent,
          id: `agent-${generateId()}`,
          createdAt: new Date().toISOString(),
        },
      ],
    })),

  updateAgent: (id, updates) =>
    set((state) => ({
      agents: state.agents.map((a) => (a.id === id ? { ...a, ...updates } : a)),
    })),

  deleteAgent: (id) =>
    set((state) => ({
      agents: state.agents.filter((a) => a.id !== id),
      currentAgentId: state.currentAgentId === id ? null : state.currentAgentId,
    })),
}));
