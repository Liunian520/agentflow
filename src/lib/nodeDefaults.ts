/**
 * LNAgent AgentFlow 节点默认配置
 * 定义每种节点类型的默认值、端口、UI 属性
 */

import type { NodeConfig } from '../types';

export interface NodeTypeDefinition {
  type: string;
  category: NodeCategory;
  label: string;
  icon: string;
  color: string;
  defaultWidth: number;
  defaultHeight: number;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  defaultConfig: NodeConfig;
  configSchema: Record<string, any>;
}

export type NodeCategory =
  | 'trigger'
  | 'ai-core'
  | 'tool'
  | 'memory'
  | 'logic'
  | 'human'
  | 'advanced';

export interface PortDefinition {
  id: string;
  label: string;
  dataType: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file' | 'any';
}

export const NODE_TYPE_DEFINITIONS: Record<string, NodeTypeDefinition> = {
  // ===== 触发器 =====
  start: {
    type: 'start',
    category: 'trigger',
    label: '开始',
    icon: 'Play',
    color: 'emerald',
    defaultWidth: 180,
    defaultHeight: 80,
    inputs: [],
    outputs: [{ id: 'out', label: '输出', dataType: 'any' }],
    defaultConfig: {},
    configSchema: {
      type: 'object',
      properties: {
        inputSchema: { type: 'object', title: '输入结构' },
        defaultValues: { type: 'object', title: '默认值' },
      },
    },
  },

  end: {
    type: 'end',
    category: 'trigger',
    label: '结束',
    icon: 'StopCircle',
    color: 'red',
    defaultWidth: 180,
    defaultHeight: 80,
    inputs: [{ id: 'in', label: '输入', dataType: 'any' }],
    outputs: [],
    defaultConfig: {
      outputTemplate: '{{input}}',
      responseFormat: 'text',
    },
    configSchema: {
      type: 'object',
      properties: {
        outputTemplate: { type: 'string', title: '输出模板', default: '{{input}}' },
        responseFormat: {
          type: 'string',
          enum: ['text', 'json', 'structured', 'stream'],
          title: '响应格式',
          default: 'text',
        },
      },
    },
  },

  // ===== AI 核心 =====
  llm: {
    type: 'llm',
    category: 'ai-core',
    label: 'LLM 对话',
    icon: 'Brain',
    color: 'blue',
    defaultWidth: 220,
    defaultHeight: 140,
    inputs: [{ id: 'in', label: '输入', dataType: 'string' }],
    outputs: [
      { id: 'text', label: '文本输出', dataType: 'string' },
      { id: 'tokens', label: 'Token 消耗', dataType: 'number' },
    ],
    defaultConfig: {
      model: 'gpt-4o',
      systemPrompt: '你是一个有帮助的 AI 助手。',
      userPrompt: '{{input}}',
      temperature: 0.7,
      maxTokens: 4096,
      tools: [],
      streamOutput: true,
      responseFormat: 'text',
    },
    configSchema: {
      type: 'object',
      required: ['model', 'systemPrompt', 'userPrompt'],
      properties: {
        model: { type: 'string', title: '模型' },
        systemPrompt: { type: 'string', title: '系统提示', widget: 'textarea' },
        userPrompt: { type: 'string', title: '用户提示', widget: 'textarea' },
        temperature: { type: 'number', title: '温度', minimum: 0, maximum: 2, default: 0.7 },
        maxTokens: { type: 'integer', title: '最大 Token', default: 4096 },
        tools: { type: 'array', items: { type: 'string' }, title: '可用工具' },
        streamOutput: { type: 'boolean', title: '流式输出', default: true },
        responseFormat: {
          type: 'string',
          enum: ['text', 'json', 'structured'],
          title: '响应格式',
        },
      },
    },
  },

  agent: {
    type: 'agent',
    category: 'ai-core',
    label: 'Agent 决策',
    icon: 'Bot',
    color: 'violet',
    defaultWidth: 220,
    defaultHeight: 180,
    inputs: [{ id: 'in', label: '输入', dataType: 'string' }],
    outputs: [
      { id: 'text', label: '决策输出', dataType: 'string' },
      { id: 'trace', label: '推理轨迹', dataType: 'array' },
      { id: 'tools', label: '工具调用历史', dataType: 'array' },
    ],
    defaultConfig: {
      name: '',
      description: '',
      model: 'gpt-4o',
      systemPrompt: '你是一个自主决策的 Agent，能够使用工具来完成任务。',
      temperature: 0.7,
      maxTokens: 4096,
      planningMode: 'react',
      maxIterations: 10,
      tools: [],
      autoSearchTools: false,
      enableMemory: false,
      memoryNamespace: 'agent',
      outputVariable: 'agent_output',
    },
    configSchema: {
      type: 'object',
      required: ['model', 'systemPrompt'],
      properties: {
        name: { type: 'string', title: 'Agent 名称' },
        description: { type: 'string', title: 'Agent 描述' },
        model: {
          type: 'string',
          title: '模型',
          default: 'auto',
          description: '设为 "auto" 则根据任务类型自动选择最优模型',
        },
        systemPrompt: { type: 'string', title: '系统提示', widget: 'textarea' },
        temperature: { type: 'number', title: '温度', minimum: 0, maximum: 2, default: 0.7 },
        maxTokens: { type: 'integer', title: '最大 Token', default: 4096 },
        planningMode: {
          type: 'string',
          enum: ['react', 'plan-and-execute', 'reflection'],
          title: '规划模式',
          default: 'react',
        },
        maxIterations: { type: 'integer', title: '最大迭代次数', default: 10, minimum: 1, maximum: 100 },
        tools: { type: 'array', items: { type: 'string' }, title: '可用工具列表' },
        autoSearchTools: { type: 'boolean', title: '自动搜索工具', default: false },
        enableMemory: { type: 'boolean', title: '启用记忆', default: false },
        memoryNamespace: { type: 'string', title: '记忆命名空间', default: 'agent' },
        outputVariable: { type: 'string', title: '输出变量名', default: 'agent_output' },
      },
    },
  },

  // ===== 工具调用 =====
  tool: {
    type: 'tool',
    category: 'tool',
    label: '工具调用',
    icon: 'Wrench',
    color: 'amber',
    defaultWidth: 200,
    defaultHeight: 120,
    inputs: [{ id: 'in', label: '输入参数', dataType: 'object' }],
    outputs: [{ id: 'result', label: '工具结果', dataType: 'object' }],
    defaultConfig: {
      toolSource: 'mcp',
      mcpServerId: '',
      toolName: '',
      inputMapping: {},
      outputMapping: {},
      outputVariable: 'tool_result',
      timeout: 30,
      retryPolicy: {
        maxRetries: 0,
        backoff: 'linear',
        backoffMs: 1000,
      },
      httpUrl: '',
      httpMethod: 'POST',
      httpHeaders: {},
    },
    configSchema: {
      type: 'object',
      required: ['toolSource', 'toolName'],
      properties: {
        toolSource: {
          type: 'string',
          enum: ['mcp', 'local', 'http'],
          title: '工具来源',
          default: 'mcp',
        },
        mcpServerId: { type: 'string', title: 'MCP 服务器', optionsFrom: 'mcpServers' },
        toolName: { type: 'string', title: '工具名称', optionsFrom: 'mcpTools' },
        outputVariable: { type: 'string', title: '输出变量名', default: 'tool_result' },
        inputMapping: {
          type: 'object',
          title: '输入映射',
          description: '节点输入字段 → 工具参数名',
        },
        outputMapping: {
          type: 'object',
          title: '输出映射',
          description: '工具返回字段 → 节点输出名',
        },
        timeout: { type: 'integer', title: '超时 (秒)', default: 30, minimum: 1 },
        retryPolicy: {
          type: 'object',
          title: '重试策略',
          properties: {
            maxRetries: { type: 'integer', title: '最大重试次数', default: 0, minimum: 0 },
            backoff: {
              type: 'string',
              enum: ['linear', 'exponential'],
              title: '退避方式',
              default: 'linear',
            },
            backoffMs: { type: 'integer', title: '初始退避 (ms)', default: 1000, minimum: 100 },
          },
        },
        httpUrl: { type: 'string', title: 'HTTP URL' },
        httpMethod: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          title: 'HTTP 方法',
          default: 'POST',
        },
        httpHeaders: { type: 'object', title: 'HTTP 请求头' },
      },
    },
  },

  http: {
    type: 'http',
    category: 'tool',
    label: 'HTTP 请求',
    icon: 'Globe',
    color: 'amber',
    defaultWidth: 200,
    defaultHeight: 120,
    inputs: [{ id: 'in', label: '请求体', dataType: 'object' }],
    outputs: [{ id: 'response', label: '响应', dataType: 'object' }],
    defaultConfig: {
      url: 'https://api.example.com/endpoint',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
      bodyType: 'json',
      outputVariable: 'http_output',
      timeout: 30,
      responseType: 'auto',
    },
    configSchema: {
      type: 'object',
      required: ['url', 'method'],
      properties: {
        url: { type: 'string', title: 'URL' },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          title: '方法',
          default: 'POST',
        },
        headers: { type: 'object', title: '请求头' },
        bodyType: {
          type: 'string',
          enum: ['none', 'json', 'form', 'raw'],
          title: 'Body 类型',
          default: 'json',
        },
        body: { type: 'string', title: 'Body 内容', widget: 'textarea' },
        outputVariable: { type: 'string', title: '输出变量名', default: 'http_output' },
        timeout: { type: 'integer', title: '超时 (秒)', default: 30, minimum: 1 },
        responseType: {
          type: 'string',
          enum: ['auto', 'json', 'text', 'blob'],
          title: '响应解析方式',
          default: 'auto',
        },
      },
    },
  },

  // ===== 记忆系统 =====
  memory_read: {
    type: 'memory_read',
    category: 'memory',
    label: '记忆读取',
    icon: 'Database',
    color: 'cyan',
    defaultWidth: 200,
    defaultHeight: 100,
    inputs: [{ id: 'in', label: '输入', dataType: 'any' }],
    outputs: [{ id: 'value', label: '记忆值', dataType: 'any' }],
    defaultConfig: {
      key: '',
      outputVariable: 'memory_value',
    },
    configSchema: {
      type: 'object',
      required: ['key'],
      properties: {
        key: {
          type: 'string',
          title: '记忆 Key',
          description: '支持 {{变量}} 模板',
        },
        outputVariable: {
          type: 'string',
          title: '输出变量名',
          default: 'memory_value',
        },
      },
    },
  },

  memory_write: {
    type: 'memory_write',
    category: 'memory',
    label: '记忆写入',
    icon: 'Save',
    color: 'cyan',
    defaultWidth: 200,
    defaultHeight: 120,
    inputs: [{ id: 'in', label: '输入', dataType: 'any' }],
    outputs: [{ id: 'result', label: '写入结果', dataType: 'object' }],
    defaultConfig: {
      key: '',
      value: '',
      tags: [],
      metadata: {},
      outputVariable: 'memory_result',
    },
    configSchema: {
      type: 'object',
      required: ['key', 'value'],
      properties: {
        key: {
          type: 'string',
          title: '记忆 Key',
          description: '支持 {{变量}} 模板',
        },
        value: {
          type: 'string',
          title: '值',
          description: '支持 {{变量}} 模板或变量名引用',
          widget: 'textarea',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          title: '标签',
          default: [],
        },
        metadata: {
          type: 'object',
          title: '元数据',
          default: {},
        },
        outputVariable: {
          type: 'string',
          title: '输出变量名',
          default: 'memory_result',
        },
      },
    },
  },

  memory_search: {
    type: 'memory_search',
    category: 'memory',
    label: '记忆搜索',
    icon: 'Search',
    color: 'cyan',
    defaultWidth: 200,
    defaultHeight: 100,
    inputs: [{ id: 'in', label: '输入', dataType: 'any' }],
    outputs: [{ id: 'results', label: '搜索结果', dataType: 'array' }],
    defaultConfig: {
      query: '',
      maxResults: 10,
      outputVariable: 'memory_results',
    },
    configSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          title: '搜索查询',
          description: '支持 {{变量}} 模板',
          widget: 'textarea',
        },
        maxResults: {
          type: 'integer',
          title: '最大结果数',
          default: 10,
          minimum: 1,
          maximum: 100,
        },
        outputVariable: {
          type: 'string',
          title: '输出变量名',
          default: 'memory_results',
        },
      },
    },
  },

  // ===== 逻辑控制 =====
  condition: {
    type: 'condition',
    category: 'logic',
    label: '条件分支',
    icon: 'GitBranch',
    color: 'orange',
    defaultWidth: 200,
    defaultHeight: 100,
    inputs: [{ id: 'in', label: '输入', dataType: 'any' }],
    outputs: [
      { id: 'true', label: '真分支', dataType: 'any' },
      { id: 'false', label: '假分支', dataType: 'any' },
    ],
    defaultConfig: {
      branches: [
        { id: 'branch_true', label: '是', expression: '{{input}} == true', targetNodeIds: [] },
      ],
      defaultBranch: { targetNodeIds: [] },
      evaluationMode: 'sync',
    },
    configSchema: {
      type: 'object',
      properties: {
        branches: {
          type: 'array',
          title: '条件分支',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', title: '分支 ID' },
              label: { type: 'string', title: '分支标签' },
              expression: { type: 'string', title: '表达式' },
              targetNodeIds: {
                type: 'array',
                items: { type: 'string' },
                title: '目标节点',
              },
            },
          },
        },
        evaluationMode: {
          type: 'string',
          enum: ['sync', 'async'],
          title: '评估模式',
        },
      },
    },
  },

  loop: {
    type: 'loop',
    category: 'logic',
    label: '循环迭代',
    icon: 'Repeat',
    color: 'rose',
    defaultWidth: 200,
    defaultHeight: 100,
    inputs: [{ id: 'collection', label: '集合', dataType: 'array' }],
    outputs: [{ id: 'results', label: '结果', dataType: 'array' }],
    defaultConfig: {
      loopType: 'forEach',
      maxIterations: 10,
      itemVariable: 'item',
      indexVariable: 'index',
    },
    configSchema: {
      type: 'object',
      required: ['loopType'],
      properties: {
        loopType: {
          type: 'string',
          enum: ['count', 'condition', 'forEach'],
          title: '循环类型',
        },
        maxIterations: { type: 'integer', title: '最大迭代数', default: 10 },
        itemVariable: { type: 'string', title: '当前项变量名' },
      },
    },
  },

  // ===== 人工参与 =====
  human_in_loop: {
    type: 'human_in_loop',
    category: 'human',
    label: '人工确认',
    icon: 'UserCheck',
    color: 'yellow',
    defaultWidth: 200,
    defaultHeight: 100,
    inputs: [{ id: 'in', label: '待确认内容', dataType: 'any' }],
    outputs: [{ id: 'decision', label: '决定', dataType: 'string' }],
    defaultConfig: {
      approvalType: 'confirm',
      timeout: 300,
      onTimeout: 'reject',
    },
    configSchema: {
      type: 'object',
      properties: {
        promptTemplate: { type: 'string', title: '提示模板' },
        approvalType: {
          type: 'string',
          enum: ['confirm', 'reject', 'edit', 'choose'],
          title: '审批类型',
        },
        timeout: { type: 'integer', title: '超时 (秒)' },
        onTimeout: {
          type: 'string',
          enum: ['approve', 'reject', 'error'],
          title: '超时处理',
        },
      },
    },
  },

  // ===== 高级 =====
  subagent: {
    type: 'subagent',
    category: 'advanced',
    label: '子 Agent',
    icon: 'Users',
    color: 'purple',
    defaultWidth: 240,
    defaultHeight: 200,
    inputs: [{ id: 'in', label: '任务', dataType: 'string' }],
    outputs: [
      { id: 'result', label: '最终结果', dataType: 'string' },
      { id: 'results', label: '各 Agent 结果', dataType: 'array' },
    ],
    defaultConfig: {
      subagentConfig: {
        mode: 'single',
        agents: [],
        routerStrategy: 'intent',
        aggregationMethod: 'best',
        outputVariable: 'sub_agent_output',
        inputVariable: '{{input}}',
        autoGenerate: false,
      },
    },
    configSchema: {
      type: 'object',
      required: ['agents'],
      properties: {
        autoGenerate: {
          type: 'boolean',
          title: '自动生成子 Agent',
          default: false,
          description: '开启后，执行前根据输入任务自动生成子 Agent 列表（覆盖手动配置）',
        },
        mode: {
          type: 'string',
          enum: ['single', 'router', 'parallel'],
          title: '执行模式',
          default: 'single',
          description: 'single: 单个子 Agent 执行; router: 智能路由选择; parallel: 多 Agent 并行执行',
        },
        agents: {
          type: 'array',
          title: '子 Agent 列表',
          items: {
            type: 'object',
            required: ['name', 'systemPrompt'],
            properties: {
              id: { type: 'string', title: 'ID' },
              name: { type: 'string', title: '名称' },
              description: { type: 'string', title: '描述' },
              model: { type: 'string', title: '模型', default: 'gpt-4o' },
              systemPrompt: { type: 'string', title: '系统提示', widget: 'textarea' },
              temperature: { type: 'number', title: '温度', minimum: 0, maximum: 2, default: 0.7 },
              maxTokens: { type: 'integer', title: '最大 Token' },
              maxIterations: { type: 'integer', title: '最大迭代次数', default: 10 },
              specialties: {
                type: 'array',
                items: { type: 'string' },
                title: '专长领域',
                description: '用于路由匹配的专长关键词',
              },
              capabilities: {
                type: 'array',
                items: { type: 'string' },
                title: '能力标签',
                description: 'Agent 具备的能力',
              },
              keywords: {
                type: 'array',
                items: { type: 'string' },
                title: '关键词',
                description: '用于关键词路由匹配',
              },
              tools: {
                type: 'array',
                items: { type: 'string' },
                title: '可用工具',
              },
              enableMemory: { type: 'boolean', title: '启用记忆', default: false },
              memoryNamespace: { type: 'string', title: '记忆命名空间', default: 'agent' },
              priority: { type: 'number', title: '优先级权重' },
            },
          },
        },
        routerStrategy: {
          type: 'string',
          enum: ['intent', 'keyword', 'roundRobin'],
          title: '路由策略',
          default: 'intent',
          description: 'router 模式下使用的路由策略',
        },
        aggregationMethod: {
          type: 'string',
          enum: ['first', 'all', 'best', 'vote'],
          title: '聚合方式',
          default: 'best',
          description: 'parallel 模式下的结果聚合方式',
        },
        outputVariable: {
          type: 'string',
          title: '输出变量名',
          default: 'sub_agent_output',
        },
        inputVariable: {
          type: 'string',
          title: '输入变量',
          default: '{{input}}',
          description: '支持变量模板',
        },
      },
    },
  },

  subworkflow: {
    type: 'subworkflow',
    category: 'advanced',
    label: '子工作流',
    icon: 'Network',
    color: 'purple',
    defaultWidth: 200,
    defaultHeight: 100,
    inputs: [{ id: 'in', label: '输入', dataType: 'any' }],
    outputs: [{ id: 'out', label: '输出', dataType: 'any' }],
    defaultConfig: {
      workflowId: '',
      mode: 'sync',
    },
    configSchema: {
      type: 'object',
      required: ['workflowId'],
      properties: {
        workflowId: { type: 'string', title: '工作流 ID' },
        inputMapping: { type: 'object', title: '输入映射' },
        outputMapping: { type: 'object', title: '输出映射' },
        mode: {
          type: 'string',
          enum: ['sync', 'async'],
          title: '执行模式',
        },
      },
    },
  },

  code: {
    type: 'code',
    category: 'advanced',
    label: '自定义代码',
    icon: 'Code2',
    color: 'gray',
    defaultWidth: 220,
    defaultHeight: 140,
    inputs: [{ id: 'in', label: '输入', dataType: 'any' }],
    outputs: [{ id: 'out', label: '输出', dataType: 'any' }],
    defaultConfig: {
      language: 'typescript',
      code: '// 在此编写自定义代码\nreturn input;',
      timeout: 10,
    },
    configSchema: {
      type: 'object',
      required: ['language', 'code'],
      properties: {
        language: {
          type: 'string',
          enum: ['javascript', 'typescript', 'python'],
          title: '语言',
        },
        code: { type: 'string', title: '代码', widget: 'code-editor' },
        timeout: { type: 'integer', title: '超时 (秒)', default: 10 },
      },
    },
  },
};

/**
 * 获取节点类型定义
 */
export function getNodeTypeDefinition(type: string): NodeTypeDefinition | undefined {
  return NODE_TYPE_DEFINITIONS[type];
}

/**
 * 获取某分类下的所有节点类型
 */
export function getNodeTypesByCategory(category: NodeCategory): NodeTypeDefinition[] {
  return Object.values(NODE_TYPE_DEFINITIONS).filter((n) => n.category === category);
}

/**
 * 获取所有分类
 */
export const NODE_CATEGORIES: Array<{
  key: NodeCategory;
  label: string;
  icon: string;
}> = [
  { key: 'trigger', label: '触发器', icon: 'Play' },
  { key: 'ai-core', label: 'AI 核心', icon: 'Brain' },
  { key: 'tool', label: '工具调用', icon: 'Wrench' },
  { key: 'memory', label: '记忆系统', icon: 'Database' },
  { key: 'logic', label: '逻辑控制', icon: 'GitBranch' },
  { key: 'human', label: '人工参与', icon: 'UserCheck' },
  { key: 'advanced', label: '高级', icon: 'Network' },
];

/**
 * 创建节点的默认配置
 */
export function createDefaultNodeConfig(type: string): NodeConfig {
  const def = NODE_TYPE_DEFINITIONS[type];
  return def ? JSON.parse(JSON.stringify(def.defaultConfig)) : {};
}

/**
 * 创建节点的默认端口
 */
export function createDefaultPorts(type: string) {
  const def = NODE_TYPE_DEFINITIONS[type];
  return {
    inputs: def?.inputs.map((p) => ({ ...p })) || [],
    outputs: def?.outputs.map((p) => ({ ...p })) || [],
  };
}
