export type NodeType =
  | 'start'
  | 'end'
  | 'llm'
  | 'agent'
  | 'code'
  | 'http'
  | 'condition'
  | 'loop'
  | 'variable'
  | 'database'
  | 'host'
  | 'knowledge'
  | 'template'
  | 'human-in-loop'
  | 'subworkflow';

export type VariableType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file';

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  value: any;
  description?: string;
}

export interface User {
  id: string;
  username: string;
  password: string;
  role: 'admin' | 'user';
  avatar?: string;
  createdAt: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  displayName: string;
}

export interface Channel {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'google' | 'deepseek' | 'azure' | 'custom';
  apiKey: string;
  baseUrl: string;
  models: ModelConfig[];
  enabled: boolean;
  createdAt: string;
}

export interface RemoteHost {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  authType: 'password' | 'privateKey';
  description?: string;
  tags: string[];
  enabled: boolean;
  createdAt: string;
  lastConnected?: string;
  status: 'online' | 'offline' | 'connecting';
}

export interface ToolConfig {
  id: string;
  name: string;
  type: 'http' | 'database' | 'email' | 'file' | 'custom';
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  description?: string;
  enabled: boolean;
}

export interface AgentConfig {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens?: number;
  tools: string[];
  toolConfig?: Record<string, any>;
}

export interface LLMConfig {
  channelId: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  userPrompt: string;
  outputVariable: string;
}

export interface CodeConfig {
  language: 'javascript' | 'python' | 'bash';
  code: string;
  inputVariables: string[];
  outputVariable: string;
  timeout: number;
}

export interface HttpConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  headers: Record<string, string>;
  body: string;
  bodyType: 'json' | 'form' | 'raw' | 'none';
  outputVariable: string;
  timeout: number;
}

export interface ConditionConfig {
  conditions: Array<{
    id: string;
    label: string;
    expression: string;
  }>;
  defaultLabel: string;
}

export interface LoopConfig {
  loopType: 'array' | 'count';
  arrayVariable?: string;
  count?: number;
  itemVariable: string;
  indexVariable: string;
}

export interface VariableConfig {
  operation: 'set' | 'append' | 'increment' | 'decrement';
  variableName: string;
  value: string;
  valueType: VariableType;
}

export interface DatabaseConfig {
  connectionId: string;
  queryType: 'select' | 'insert' | 'update' | 'delete';
  sql: string;
  outputVariable: string;
}

export interface HostConfig {
  hostId: string;
  operation: 'command' | 'upload' | 'download';
  command?: string;
  workDir?: string;
  localPath?: string;
  remotePath?: string;
  outputVariable: string;
  timeout: number;
}

export interface KnowledgeConfig {
  knowledgeBaseId: string;
  query: string;
  topK: number;
  outputVariable: string;
}

export interface HumanInLoopConfig {
  title: string;
  description: string;
  assignee: string;
  timeout: number;
  inputFields: Array<{
    id: string;
    label: string;
    type: 'text' | 'textarea' | 'select' | 'boolean';
    options?: string[];
    required: boolean;
  }>;
}

export interface SubworkflowConfig {
  workflowId: string;
  inputMapping: Record<string, string>;
  outputVariable: string;
}

export interface TemplateConfig {
  template: string;
  templateType: 'string' | 'json';
  outputVariable: string;
}

export interface StartConfig {
  inputs: Array<{
    id: string;
    name: string;
    type: VariableType;
    required: boolean;
    default?: any;
    description?: string;
  }>;
}

export interface EndConfig {
  outputs: Array<{
    id: string;
    name: string;
    type: VariableType;
    value: string;
  }>;
}

export interface NodeData {
  label: string;
  description: string;
  iconName: string;
  type: NodeType;
  templateId?: string;

  startConfig?: StartConfig;
  endConfig?: EndConfig;
  llmConfig?: LLMConfig;
  agentConfig?: AgentConfig;
  codeConfig?: CodeConfig;
  httpConfig?: HttpConfig;
  conditionConfig?: ConditionConfig;
  loopConfig?: LoopConfig;
  variableConfig?: VariableConfig;
  databaseConfig?: DatabaseConfig;
  hostConfig?: HostConfig;
  knowledgeConfig?: KnowledgeConfig;
  humanConfig?: HumanInLoopConfig;
  subworkflowConfig?: SubworkflowConfig;
  templateConfig?: TemplateConfig;

  tools?: ToolConfig[];
  triggerConfig?: {
    triggerType: 'webhook' | 'schedule' | 'manual';
    webhookUrl?: string;
    schedule?: string;
  };
  outputConfig?: {
    outputType: 'result' | 'notification';
    channels?: string[];
  };
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  defaultData?: Partial<NodeData>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface ExecutionLog {
  id: string;
  nodeId: string;
  nodeName: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  data?: any;
}

export interface ExecutionState {
  isRunning: boolean;
  currentNodeId: string | null;
  completedNodeIds: string[];
  variables: Record<string, any>;
  logs: ExecutionLog[];
  startTime: string | null;
  endTime: string | null;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'paused';
  error?: string;
  iterationCount?: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: string;
  updatedAt: string;
  status: 'draft' | 'published' | 'running' | 'paused';
  runs: number;
  variables: Variable[];
  metaSkill?: {
    taskDecomposition: string;
    agentEngineering: string;
    workflowOrchestration: string;
    version: number;
    evidence: string[];
  };
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  avatar: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  createdAt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  agentId?: string;
  toolName?: string;
  toolArgs?: any;
  toolResult?: any;
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  author: string;
  downloads: number;
  stars: number;
  version: string;
  installed: boolean;
  tags: string[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  thumbnail: string;
  category: string;
  author: string;
  uses: number;
  nodes: number;
  tags: string[];
}
