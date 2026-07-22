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
  | 'subworkflow'
  | 'subagent';

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
  source?: 'mcp' | 'local';       // Phase 6：工具来源
  mcpServerId?: string;           // 若为 MCP 工具，记录所属服务器
  inputSchema?: Record<string, any>; // MCP 工具的 JSON Schema
}

// ===== MCP 服务器与工具（Phase 6：MCP 工具集成） =====
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>; // JSON Schema 对象
}

export interface MCPServer {
  id: string;
  name: string;
  transport: 'streamable-http' | 'sse' | 'local-fs';
  url?: string;
  fsDir?: string;           // local-fs 模式：暴露给 AI 的服务器目录绝对路径
  headers?: Record<string, string>;
  enabled: boolean;
  status: 'connected' | 'disconnected' | 'error';
  lastError?: string;
  tools: MCPTool[];
  createdAt: string;
}

export interface AgentConfig {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens?: number;
  tools: string[];
  toolConfig?: Record<string, any>;
}

// ===== SubAgent 并行节点配置（Phase 5：多 Agent 并行编排） =====
export interface SubAgentDef {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  inputVariable?: string;   // 读取哪个变量作为输入；不填则使用全部变量上下文
  temperature?: number;
  maxTokens?: number;
  tools?: string[];         // 引用的 MCP 工具标识（如 "web-search"）
}

export interface SubAgentConfig {
  agents: SubAgentDef[];
  aggregatorPrompt?: string;  // 聚合提示（将各子 Agent 输出汇总为最终结论）
  outputVariable: string;
  parallel: boolean;          // 是否并行执行（默认 true）
}

export interface LLMConfig {
  channelId: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  userPrompt: string;
  outputVariable: string;
  tools?: string[]; // Phase 6：引用的 MCP 工具标识
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
  subagentConfig?: SubAgentConfig;
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
  // 对话式编程扩展字段
  messageType?: 'text' | 'agent_card' | 'workflow_preview' | 'action_confirm' | 'clarification' | 'execution_result' | 'ssh_result' | 'node_config';
  metadata?: Record<string, any>;
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

// ===== 对话式编程扩展类型 =====

// Agent 工作模式（对标 Kilo Code / Cline）
export type AgentMode = 'plan' | 'code' | 'debug' | 'orchestrator' | 'ask';

export interface ModeConfig {
  id: AgentMode;
  label: string;
  description: string;
  icon: string;
  color: string;
  behavior: 'analyze_only' | 'execute_with_approval' | 'execute_auto' | 'coordinate';
}

// 任务步骤（对标 Codex todo list）
export interface TaskStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  detail?: string;
  duration?: number;
}

// 操作确认类型
export interface ApprovalRequest {
  id: string;
  action: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  details?: Record<string, any>;
}

// 斜杠命令
export interface SlashCommand {
  id: string;
  command: string;
  label: string;
  description: string;
  mode?: AgentMode;
  icon: string;
  shortcut?: string;
}

// 思考过程步骤
export interface ThinkingStep {
  id: string;
  phase: 'analyzing' | 'planning' | 'executing' | 'validating';
  content: string;
  timestamp: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  mode?: AgentMode;
  context?: {
    activeAgentId?: string;
    activeWorkflowId?: string;
  };
}

// 意图解析类型
export type IntentAction =
  | 'create_agent'
  | 'update_agent'
  | 'delete_agent'
  | 'list_agents'
  | 'create_workflow'
  | 'update_workflow'
  | 'delete_workflow'
  | 'list_workflows'
  | 'add_node'
  | 'connect_nodes'
  | 'configure_node'
  | 'run_workflow'
  | 'ssh_command'
  | 'query_status'
  | 'general_chat'
  | 'unknown';

export interface ParsedIntent {
  action: IntentAction;
  params: Record<string, any>;
  confidence: number;
  clarification?: string;
  originalText: string;
}

export interface ActionResult {
  success: boolean;
  type: string;
  data?: Record<string, any>;
  error?: string;
}

// ===== Skill-MAS Meta-Agent 扩展类型 =====

// Meta-Skill 三层编排策略（基于 Skill-MAS 论文）
export interface MetaSkillEvolution {
  version: number;            // 进化后的版本号
  timestamp: string;
  trigger: string;            // 触发原因（如 "累积 3 次失败"）
  summary: string;            // 本次改进的自然语言摘要
  changes: {
    decomposition: string[];
    engineering: string[];
    orchestration: string[];
  };
  basedOnTraces: number;      // 基于多少条轨迹提炼
}

export interface MetaSkill {
  decomposition: string;    // Task Decomposition — 任务分解策略
  engineering: string;      // Agent Engineering — Agent 工程策略
  orchestration: string;    // Workflow Orchestration — 工作流编排策略
  version: number;
  updatedAt: string;
  evolutions?: MetaSkillEvolution[]; // 进化历史（闭环学习记录）
}

// 编排计划 — Meta-Agent 输出的结构化指令
export interface OrchestrationPlan {
  intent: IntentAction | 'smart_orchestrate';
  confidence: number;
  subTasks: SubTask[];
  agents: PlannedAgent[];
  workflow: PlannedWorkflow | null;
  clarifications: string[];
  reasoning: string;        // Meta-Agent 的思考过程
  source: 'intent_parser' | 'meta_agent'; // 来源标识
}

export interface SubTask {
  id: string;
  action: IntentAction;
  params: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: ActionResult;
}

export interface PlannedAgent {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  temperature: number;
  avatar: string;
}

export interface PlannedWorkflow {
  name: string;
  description: string;
  nodes: PlannedNode[];
  edges: PlannedEdge[];
}

export interface PlannedNode {
  type: NodeType;
  name: string;
  description: string;
  config?: Record<string, any>;
}

export interface PlannedEdge {
  sourceIndex: number;  // 在 nodes 数组中的索引
  targetIndex: number;
  label?: string;
}

// 执行轨迹 — 用于 Experience Memory Bank
export interface ExecutionTrace {
  id: string;
  timestamp: string;
  userInput: string;
  plan: OrchestrationPlan;
  outcome: 'success' | 'partial' | 'failure';
  resultData: Record<string, any>;
  failureModes?: string[];
  agentIds?: string[];
  workflowId?: string;
  duration?: number;
}

// ===== ACRouter 自进化模型路由类型（基于 Agent-as-a-Router 论文 C-A-F 闭环） =====

export type RouterCategory =
  | 'creative' | 'reasoning' | 'code'
  | 'chat' | 'orchestration' | 'multilingual'
  | 'extraction' | 'recall_select' | 'dream_consolidation';

// (C) Context — 任务特征
export interface TaskFeatures {
  intent: string;          // general_chat | smart_orchestrate | agent_chat | workflow_llm_node | reflection | plan_evaluation
  mode?: AgentMode;
  category: RouterCategory;
  keywords: string[];
  inputLength: number;
  hasCode: boolean;
  hasWorkflowKeywords: boolean;
  inputFingerprint: string; // 原文摘要，用于 kNN 相似度检索
}

// 路由池候选（每个模型 = 一个 bandit arm）
export interface RoutingPoolEntry {
  channelId: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  displayName: string;
}

// (A) Action — 路由决策结果
export interface RoutingDecision {
  channelId: string;
  modelName: string;
  modelDisplayName?: string; // 显示名称（如 "DeepSeek V3"）
  provider: string;
  baseUrl: string;
  apiKey: string;
  reasoning: string;        // 为何选它（可读说明）
  alternatives: { modelName: string; score: number }[];
  explored: boolean;        // 是否 ε 探索（非贪心选择）
  strategy?: 'statistical' | 'knn' | 'cold_start' | 'manual'; // 选模型策略
}

// (F) Feedback — 模型级表现记录
export interface RouterRecord {
  id: string;
  timestamp: string;
  taskFeatures: TaskFeatures;
  channelId: string;
  modelName: string;
  provider: string;
  outcome: 'success' | 'partial' | 'failure';
  score: number;            // composite 0..1
  latencyMs: number;
  estTokens: number;
}

// 聚合统计（per model × category）
export interface ModelPerfStats {
  modelKey: string;         // `${provider}:${modelName}`
  category: RouterCategory;
  samples: number;
  avgScore: number;
  successRate: number;
  avgLatency: number;
  avgCost: number;          // avg estTokens
}

// ===== 统一记忆架构类型（Phase 10：四层记忆 + 三个横切机制） =====

// L0: Working Memory — 10 个固定 section（参考 Claude Code Session Memory）
export type SessionSectionKey =
  | 'current_state'    // 当前正在做什么
  | 'task_spec'        // 用户原始需求+约束
  | 'files'            // 已读/已写/已改文件清单
  | 'workflow'         // 当前编排方案+执行进度
  | 'errors'           // 遇到的问题及解决方式
  | 'learnings'        // 本会话学到的用户偏好/纠正
  | 'key_results'      // 已产出的重要输出
  | 'worklog'          // 按时间序的关键操作
  | 'pending'          // 未完成的任务
  | 'context_summary'; // 压缩后的历史对话要点

export interface SessionMemory {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  tokenEstimate: number;
  toolCallCount: number;
  sections: Record<SessionSectionKey, string>;
  lastCompactAt?: string;
}

// L1: Factual Memory — 4 类事实记忆（参考 Claude Code Auto Memory Extraction）
export type FactualMemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface FactualMemory {
  id: string;
  type: FactualMemoryType;
  content: string;
  tags: string[];
  keywords: string[];
  source: 'auto_extraction' | 'auto_extraction_fallback' | 'user_edit' | 'auto_dream';
  sessionId?: string;
  messageId?: string;
  createdAt: string;
  updatedAt: string;
  accessCount: number;
  lastAccessedAt?: string;
  importance: number;  // 0..1
}

// L2-B: Experiential Reflection — 编排经验反思（Skill-MAS Selective Reflection 升级）
export interface ExperientialReflection {
  id: string;
  timestamp: string;
  trigger: string;
  summary: string;
  principles: string[];
  layer: 'decomposition' | 'engineering' | 'orchestration' | 'general';
  basedOnTraceIds: string[];
  basedOnTraceCount: number;
  consolidatedFromTraces?: boolean;
}

// 横切: Auto Extraction 结果
export interface ExtractionResult {
  extracted: FactualMemory[];
  method: 'llm' | 'keyword_fallback' | 'skipped_self_edit';
  cursorUpdated: boolean;
  processedMessageUuid?: string;
  skipped?: boolean;
  reason?: string;
}

// 横切: Dynamic Recall 结果
export interface RecallResult {
  candidates: { memory: FactualMemory; score: number; reason: string }[];
  selected: FactualMemory[];  // ≤ 5 条
  injectedContext: string;
}

// 横切: Handoff Summary（参考 Codex 上下文压缩）
export interface HandoffSummary {
  id: string;
  timestamp: string;
  sessionId: string;
  summary: string;
  preservedMessageCount: number;
  compactedMessageCount: number;
  triggerTokenCount: number;
}

// 横切: Auto Dream 日志（参考 Claude Code tengu_onyx_plover）
export interface DreamLog {
  id: string;
  timestamp: string;
  phase: 'orientation' | 'gather_signal' | 'consolidation' | 'prune';
  summary: string;
  changes: {
    factualMerged: number;
    factualPruned: number;
    tracesConsolidated: number;
    reflectionsMerged: number;
  };
  duration: number;
}

// 横切: Memory Audit 日志
export interface MemoryAuditEntry {
  id: string;
  timestamp: string;
  layer: 'L0' | 'L1' | 'L2' | 'L3';
  action: 'create' | 'update' | 'delete' | 'merge' | 'prune' | 'recall';
  targetId: string;
  targetType: string;
  before?: string;
  after?: string;
  source: 'auto' | 'user' | 'dream' | 'extraction' | 'reflection' | 'self_edit';
}
