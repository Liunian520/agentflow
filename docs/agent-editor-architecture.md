# LNAgent Agent 编辑器技术设计规范 (Agent Editor ADR)

> **版本**: v1.0  
> **状态**: Draft  
> **创建日期**: 2026-07-24  
> **关联文档**: [多 Agent 编排系统计划](./2026-07-23-autonomous-multi-agent-orchestration.md)

---

## 1. 概述

### 1.1 设计目标

将 LNAgent 从"表单式 Agent 配置"升级为"可视化 Agent 编辑器"，支持：

1. **节点式画布**: 拖拽编排 LLM、工具、记忆、条件等节点
2. **双模式编辑**: 画布模式 (Visual) + JSON 模式 (Code) 无缝切换
3. **实时调试**: 单步执行、断点、输入/输出检查、Token/Timing 统计
4. **标准化协议**: 基于 MCP + OpenAPI Schema 的工具描述
5. **分层记忆**: 工作记忆 / 情景记忆 / 语义记忆三级架构
6. **多 Agent 协作**: MoA (Mixture of Agents) 路由与编排

### 1.2 设计哲学

| 原则 | 说明 |
|------|------|
| **本地优先** | 所有编辑器逻辑在前端执行，Worker 仅做 LLM 代理和工具执行 |
| **协议标准** | 严格遵循 MCP、OpenAPI Function Calling、JSON Schema 标准 |
| **渐进增强** | 先实现核心节点，再扩展高级节点；画布先行，MoA 远期 |
| **隐私友好** | 记忆、会话数据本地存储，Worker 无状态 |
| **可观测** | 每个节点执行有完整日志、耗时、Token 消耗追踪 |

### 1.3 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 画布引擎 | React Flow (xyflow) | 节点拖拽、连线、缩放 |
| 状态管理 | Zustand | 编辑器状态 + 运行时状态 |
| 表单生成 | react-jsonschema-form | 根据 JSON Schema 自动生成配置表单 |
| 代码编辑器 | Monaco Editor | JSON/YAML 模式切换 |
| 类型安全 | TypeScript (严格模式) | 端到端类型定义 |
| 测试 | Vitest + Playwright | 单元测试 + E2E 画布交互测试 |

---

## 2. Agent 描述协议 (Agentflow Schema)

### 2.1 顶层结构

```json
{
  "$schema": "https://lnagent.dev/schemas/agentflow-v1.json",
  "version": "1.0.0",
  "id": "agent_001",
  "name": "代码审查助手",
  "description": "审查 PR 代码质量，提供改进建议",
  "metadata": {
    "author": "dev",
    "tags": ["code-review", "quality"],
    "createdAt": "2026-07-24T10:00:00Z",
    "updatedAt": "2026-07-24T10:00:00Z"
  },
  "graph": {
    "nodes": [...],
    "edges": [...]
  },
  "variables": [...],
  "triggers": [...]
}
```

### 2.2 节点定义

#### 基础节点结构

```json
{
  "id": "node_001",
  "type": "llm",
  "position": { "x": 200, "y": 300 },
  "config": { ... },
  "inputs": [
    { "id": "in_001", "label": "系统提示", "dataType": "string" }
  ],
  "outputs": [
    { "id": "out_001", "label": "生成文本", "dataType": "string" },
    { "id": "out_002", "label": "Token 消耗", "dataType": "number" }
  ]
}
```

#### 节点类型分类 (17 种)

| 分类 | 节点类型 | 说明 | 复杂度 |
|------|----------|------|--------|
| **输入输出** | `start` | 流程起点，接收外部输入 | ⭐ |
| | `end` | 流程终点，输出结果 | ⭐ |
| | `input` | 用户输入节点（多模态） | ⭐⭐ |
| | `output` | 格式化输出节点 | ⭐⭐ |
| **LLM 核心** | `llm` | 标准 LLM 文本生成 | ⭐⭐ |
| | `agent` | 自主决策 Agent（ReAct 模式） | ⭐⭐⭐ |
| | `subagent` | 子 Agent 调用 | ⭐⭐⭐ |
| | `a2a` | 跨 Agent 协议调用 | ⭐⭐⭐⭐ |
| **工具调用** | `tool` | 单个工具调用 | ⭐⭐ |
| | `http` | HTTP/REST API 调用 | ⭐⭐ |
| | `database` | 数据库查询 | ⭐⭐⭐ |
| | `knowledge` | 知识库/RAG 检索 | ⭐⭐⭐ |
| **逻辑控制** | `condition` | 条件分支 (if-else) | ⭐⭐ |
| | `loop` | 循环迭代 | ⭐⭐⭐ |
| | `parallel` | 并行执行 | ⭐⭐⭐ |
| **记忆系统** | `memory_read` | 从记忆系统检索 | ⭐⭐⭐ |
| | `memory_write` | 写入记忆系统 | ⭐⭐⭐ |
| **人工参与** | `human-in-loop` | 暂停等待人工确认 | ⭐⭐⭐ |
| **高级** | `subworkflow` | 子工作流引用 | ⭐⭐⭐⭐ |
| | `code` | 自定义代码执行 | ⭐⭐⭐ |

### 2.3 核心节点配置 Schema

#### LLM 节点

```typescript
interface LLmNodeConfig {
  model: string;                    // 引用 Channel 中的模型
  systemPrompt: string;             // 系统提示（支持 {{变量}}）
  userPrompt: string;               // 用户提示（支持 {{变量}}）
  temperature: number;              // 0.0 - 2.0
  maxTokens: number;                // 最大输出 Token
  tools: string[];                  // 可用工具 ID 列表
  memoryProfile?: string;           // 关联的记忆配置
  streamOutput: boolean;            // 是否流式输出
  responseFormat?: 'text' | 'json' | 'structured';
  jsonSchema?: Record<string, any>; // structured output 的 Schema
}
```

#### Agent 节点

```typescript
interface AgentNodeConfig {
  model: string;
  systemPrompt: string;
  planningMode: 'react' | 'plan-and-execute' | 'reflection';
  maxIterations: number;            // 最大推理轮次 (1-10)
  tools: string[];
  memoryProfile?: string;
  autoToolSelect: boolean;          // Agent 自主选择工具
  stopCondition?: string;           // 自然语言描述的停止条件
}
```

#### Tool 节点

```typescript
interface ToolNodeConfig {
  toolSource: 'mcp' | 'local' | 'http';
  mcpServerId?: string;
  toolName?: string;
  httpConfig?: {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    bodyTemplate?: string;          // 支持 {{变量}}
  };
  inputMapping: Record<string, string>;  // 节点输入 → 工具参数映射
  outputMapping: Record<string, string>; // 工具返回 → 节点输出映射
  timeout: number;                  // 超时秒数
  retryPolicy?: {
    maxRetries: number;
    backoff: 'linear' | 'exponential';
  };
}
```

#### Memory 节点

```typescript
interface MemoryReadConfig {
  operation: 'search' | 'recall' | 'list';
  queryTemplate?: string;           // 搜索模板
  memoryType?: 'working' | 'episodic' | 'semantic';
  filters?: {
    tags?: string[];
    dateRange?: { start?: string; end?: string };
    minImportance?: number;
  };
  maxResults: number;
  outputFormat: 'text' | 'structured' | 'summary';
}

interface MemoryWriteConfig {
  operation: 'save' | 'update' | 'delete';
  memoryType: 'episodic' | 'semantic';
  contentTemplate: string;          // 支持 {{变量}}
  metadata?: {
    tags?: string[];
    importance?: number;
    ttl?: number;                   // 存活时间 (秒)
  };
  deduplicate: boolean;             // 是否自动去重
}
```

#### Condition 节点

```typescript
interface ConditionNodeConfig {
  branches: Array<{
    id: string;
    label: string;
    expression: string;             // JS 表达式: {{input}} > 0.5
    targetNodeIds: string[];        // 命中此分支时激活的下游节点
  }>;
  defaultBranch: {
    targetNodeIds: string[];
  };
  evaluationMode: 'sync' | 'async'; // 同步或异步评估
}
```

### 2.4 连线定义

```typescript
interface Edge {
  id: string;
  source: string;           // 源节点 ID
  sourceHandle: string;     // 源端口 ID
  target: string;           // 目标节点 ID
  targetHandle: string;     // 目标端口 ID
  condition?: {
    type: 'data' | 'control';
    expression?: string;    // 条件连线表达式
  };
  animated: boolean;
  label?: string;
}
```

### 2.5 变量系统

```typescript
interface Variable {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file';
  value?: any;
  source: 'input' | 'node_output' | 'constant' | 'template';
  ref?: {
    nodeId: string;
    outputId: string;
  };
  description?: string;
  sensitive?: boolean;      // 是否为敏感数据（API Key 等）
}
```

**变量引用语法**:
```
{{variableName}}           // 简单引用
{{nodeId.outputName}}      // 节点输出引用
{{variableName.path.to.key}} // 嵌套属性引用
{{variableName | filter}}   // 管道过滤 (upper, lower, json, truncate)
```

### 2.6 触发器

```typescript
interface Trigger {
  id: string;
  type: 'manual' | 'schedule' | 'event' | 'webhook';
  config: {
    schedule?: {
      cron: string;
      timezone: string;
    };
    event?: {
      source: 'memory' | 'channel' | 'system';
      pattern: string;         // 事件匹配模式
    };
    webhook?: {
      path: string;
      auth: 'none' | 'token' | 'hmac';
    };
  };
  enabled: boolean;
}
```

---

## 3. 节点组件库规范

### 3.1 组件面板结构

```
┌─────────────────────────────────┐
│  📦 组件库                      │
├─────────────────────────────────┤
│  🚀 触发器                      │
│    ├── 手动触发                  │
│    ├── 定时触发                  │
│    ├── 事件触发                  │
│    └── Webhook 触发              │
├─────────────────────────────────┤
│  🧠 AI 核心                     │
│    ├── LLM 对话                  │
│    ├── Agent 决策                │
│    ├── 子 Agent                  │
│    └── A2A 跨 Agent              │
├─────────────────────────────────┤
│  🔧 工具调用                     │
│    ├── MCP 工具集                │
│    ├── HTTP 请求                 │
│    ├── 数据库查询                │
│    └── 知识库检索                │
├─────────────────────────────────┤
│  💾 记忆系统                     │
│    ├── 记忆检索                  │
│    ├── 记忆写入                  │
│    └── 记忆摘要                  │
├─────────────────────────────────┤
│  ⚡ 逻辑控制                     │
│    ├── 条件分支                  │
│    ├── 循环迭代                  │
│    ├── 并行执行                  │
│    └── 等待/延时                 │
├─────────────────────────────────┤
│  👤 人工参与                     │
│    ├── 审批确认                  │
│    ├── 表单输入                  │
│    └── 消息通知                  │
├─────────────────────────────────┤
│  🏗️ 高级                        │
│    ├── 子工作流                  │
│    ├── 自定义代码                │
│    └── 变量操作                  │
└─────────────────────────────────┘
```

### 3.2 节点 UI 规范

每个节点包含以下 UI 元素：

```
┌──────────────────────────┐
│ 🟦 [Icon] 节点名称        │  ← 标题栏
├──────────────────────────┤
│                          │
│  配置预览 (精简信息)      │  ← 内容区
│  · 模型: GPT-4o          │
│  · 温度: 0.7             │
│  · 工具: 3 个            │
│                          │
├──●───────────────────────┤  ← 输入端口
│                          │
├──●───────────────────────┤  ← 输出端口
└──────────────────────────┘
     ↑                    ↑
   输入                  输出
```

### 3.3 节点视觉标识

| 类型 | 颜色 | 图标 |
|------|------|------|
| start | 🟢 emerald | Play |
| end | 🔴 red | StopCircle |
| llm | 🔵 blue | Brain |
| agent | 🟣 violet | Bot |
| tool | 🟡 amber | Wrench |
| memory | 🔷 cyan | Database |
| condition | 🟠 orange | GitBranch |
| loop | 🔴 rose | Repeat |
| parallel | ⚪ slate | Layers |
| human-in-loop | 🟡 yellow | UserCheck |
| code | ⚫ gray | Code2 |

---

## 4. 编辑器架构

### 4.1 组件层级

```
AgentEditor/
├── CanvasArea/                    # 画布区域
│   ├── ReactFlowWrapper/          # React Flow 主画布
│   ├── MiniMap/                   # 小地图
│   ├── Toolbar/                   # 缩放/适应/撤销/重做
│   └── NodeRenderer/              # 动态渲染节点
├── ComponentPanel/                # 组件库面板
│   ├── SearchBar/                 # 搜索框
│   ├── CategoryTabs/              # 分类标签
│   └── ComponentList/             # 可拖拽组件列表
├── PropertiesPanel/               # 属性配置面板
│   ├── NodeConfigForm/            # 节点配置表单 (JSON Schema 驱动)
│   ├── InputOutputConfig/         # 端口配置
│   └── VariableBindings/          # 变量绑定
├── DebugPanel/                    # 调试面板
│   ├── ExecutionLog/              # 执行日志
│   ├── VariableInspector/         # 变量检查器
│   ├── TokenTracker/              # Token 消耗追踪
│   └── PerformanceStats/         # 性能统计
├── TopToolbar/                    # 顶部工具栏
│   ├── ModeSwitch/                # 画布/JSON 模式切换
│   ├── SaveLoad/                  # 保存/加载
│   ├── ExportImport/              # 导入/导出
│   └── TestControls/              # 测试运行/停止
└── StatusBar/                     # 状态栏
    ├── ZoomInfo/                  # 缩放信息
    ├── NodeCount/                 # 节点数量
    └── ValidationStatus/          # 验证状态
```

### 4.2 状态管理

```typescript
interface EditorState {
  // 画布状态
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  viewport: { x: number; y: number; zoom: number };
  history: HistoryStack;            // 撤销/重做栈
  
  // 配置状态
  agentMeta: AgentMetadata;
  variables: Variable[];
  triggers: Trigger[];
  
  // 调试状态
  isRunning: boolean;
  currentNodeId: string | null;
  breakpoints: Set<string>;
  executionLog: LogEntry[];
  variableValues: Map<string, any>;
  performanceMetrics: PerformanceMetrics;
  
  // UI 状态
  activePanel: 'components' | 'properties' | 'debug';
  viewMode: 'canvas' | 'json' | 'yaml';
  validationErrors: ValidationError[];
}
```

### 4.3 执行引擎

```typescript
class WorkflowEngine {
  // 编译: 图 → 执行计划
  compile(graph: AgentGraph): ExecutionPlan {
    // 1. 拓扑排序
    const sorted = topoSort(graph.nodes, graph.edges);
    
    // 2. 检测循环
    const cycles = detectCycles(graph);
    
    // 3. 分组并行层
    const layers = groupByParallel(sorted, graph.edges);
    
    // 4. 生成执行计划
    return { layers, variables, metadata };
  }
  
  // 执行: 逐步推进
  async execute(plan: ExecutionPlan, input: any): AsyncGenerator<ExecutionStep> {
    // 1. 初始化变量
    // 2. 逐层执行
    // 3. 每个节点: 读取输入 → 执行 → 写入输出
    // 4. 遇到条件分支: 评估表达式 → 激活对应下游
    // 5. 遇到循环: 迭代执行 → 聚合结果
    // 6. 遇到 parallel: 并行执行所有分支
    // 7. 遇到 human-in-loop: 暂停 → 等待外部信号
    // 8. 输出最终结果
  }
  
  // 调试: 单步执行
  async stepForward(): Promise<StepResult> { ... }
  async stepBackward(): Promise<StepResult> { ... }
  async runToBreakpoint(): Promise<void> { ... }
}
```

### 4.4 Worker 端执行

```typescript
// Worker 接收编译后的 AgentFlow，驱动执行
interface AgentFlowRequest {
  agentId: string;
  flow: CompiledFlow;               // 编译后的执行计划
  input: Record<string, any>;      // 用户输入
  sessionId: string;
  mode: 'run' | 'debug' | 'step';
}

interface AgentFlowResponse {
  status: 'running' | 'completed' | 'error' | 'paused';
  currentNodeId?: string;
  outputs: Record<string, any>;
  logs: LogEntry[];
  tokenUsage: TokenUsage;
  timing: {
    total: number;
    nodes: Record<string, number>;
  };
}
```

---

## 5. 记忆系统规范

### 5.1 三层记忆架构

```
┌─────────────────────────────────────────────┐
│              LNAgent 记忆系统               │
├─────────────────────────────────────────────┤
│                                             │
│  ① 工作记忆 (Working Memory)                │
│  ┌─────────────────────────────────────┐    │
│  │  · 当前对话上下文 (最近 N 轮)        │    │
│  │  · 短期缓存 (会话级)                │    │
│  │  · 类型: 内存                        │    │
│  │  · TTL: 会话生命周期                │    │
│  └─────────────────────────────────────┘    │
│           ↓ 自动压缩/摘要                    │
│  ② 情景记忆 (Episodic Memory)               │
│  ┌─────────────────────────────────────┐    │
│  │  · 历史对话摘要                     │    │
│  │  · 事件时间线                       │    │
│  │  · 检索方式: 向量相似度 + 关键词     │    │
│  │  · 存储: Cloudflare KV + Vector     │    │
│  └─────────────────────────────────────┘    │
│           ↓ 结构化抽取                      │
│  ③ 语义记忆 (Semantic Memory)              │
│  ┌─────────────────────────────────────┐    │
│  │  · 用户画像 (偏好/能力/角色)        │    │
│  │  · 知识图谱 (实体/关系)             │    │
│  │  · 工具使用经验                    │    │
│  │  · 存储: Cloudflare KV (结构化)    │    │
│  └─────────────────────────────────────┘    │
│                                             │
└─────────────────────────────────────────────┘
```

### 5.2 记忆操作接口

```typescript
interface MemoryEngine {
  // 写入
  save(input: {
    type: 'episodic' | 'semantic';
    content: string;
    metadata?: { tags: string[]; importance: number; source: string };
  }): Promise<MemoryEntry>;
  
  // 检索 (多路召回)
  retrieve(query: {
    text?: string;
    filters?: { type?: string; tags?: string[]; dateRange?: [Date, Date] };
    strategy?: 'hybrid' | 'vector' | 'keyword';
    topK?: number;
  }): Promise<MemoryEntry[]>;
  
  // 更新
  update(id: string, patches: Partial<MemoryEntry>): Promise<void>;
  
  // 删除
  delete(id: string): Promise<void>;
  
  // 压缩/摘要
  compress(sessionId: string): Promise<Summary>;
  
  // 记忆统计
  stats(): Promise<{
    totalEntries: number;
    byType: Record<string, number>;
    byImportance: Record<string, number>;
  }>;
}
```

### 5.3 记忆检索策略

```typescript
interface RetrievalStrategy {
  // Hybrid 检索 (默认)
  async hybrid(query: string): Promise<MemoryEntry[]> {
    // Step 1: 向量检索 (语义相似度)
    const vectorResults = await vectorSearch(query, topK=10);
    
    // Step 2: 关键词检索 (精确匹配)
    const keywordResults = await keywordSearch(query, topK=10);
    
    // Step 3: RRF 融合排序
    const fused = rrfFusion(vectorResults, keywordResults);
    
    // Step 4: 重要性加权
    return importanceWeighting(fused);
  }
  
  // 向量检索
  async vectorSearch(query: string, topK: number): Promise<ScoredEntry[]> {
    const embedding = await generateEmbedding(query);
    const results = await vectorStore.search(embedding, topK);
    return results.map(r => ({ ...r, score: cosineSimilarity(embedding, r.vector) }));
  }
  
  // 关键词检索
  async keywordSearch(query: string, topK: number): Promise<ScoredEntry[]> {
    // SQLite FTS5 or Cloudflare Vector
    return ftsSearch(query, topK);
  }
}
```

---

## 6. 工具系统规范

### 6.1 工具注册中心

```typescript
interface ToolRegistry {
  // 注册工具
  register(tool: ToolDefinition): void;
  
  // 批量注册 MCP 工具
  registerMCPServer(server: MCPServer): Promise<void>;
  
  // 注销工具
  unregister(toolId: string): void;
  
  // 查询工具
  list(filter?: {
    category?: ToolCategory;
    source?: 'mcp' | 'local' | 'http';
    available?: boolean;
  }): ToolDefinition[];
  
  // 搜索工具 (Tool Search)
  search(query: string): ToolDefinition[];
  
  // 执行工具
  execute(toolId: string, args: Record<string, any>): Promise<ToolResult>;
}

interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  source: 'mcp' | 'local' | 'http';
  inputSchema: JSONSchema;       // 输入参数 Schema
  outputSchema?: JSONSchema;     // 输出格式 Schema
  executor: ToolExecutor;
  metadata?: {
    tags: string[];
    version: string;
    author: string;
    rateLimit?: { maxCalls: number; windowSeconds: number };
  };
}

type ToolCategory =
  | 'search' | 'file' | 'database' | 'api' | 'browser'
  | 'system' | 'knowledge' | 'memory' | 'communication';
```

### 6.2 Tool Search 机制

```typescript
// 参考 Hermes Agent: 按需加载，节省 Token
class ToolSearchEngine {
  private toolIndex: Map<string, ToolDescriptor>;
  
  // 工具描述 (轻量，注入 System Prompt)
  private descriptors: Array<{
    id: string;
    name: string;
    description: string;
    keywords: string[];           // 用于关键词匹配
    embedding: number[];          // 预计算的 embedding
  }>;
  
  // 根据用户意图动态选择工具
  getRelevantTools(userQuery: string, maxTools = 5): ToolDefinition[] {
    // 1. 分析意图特征
    const features = analyzeIntent(userQuery);
    
    // 2. 计算每个工具的相关性分数
    const scored = this.descriptors.map(desc => ({
      tool: this.registry.get(desc.id),
      score: this.calculateRelevance(features, desc)
    }));
    
    // 3. 取 Top-K
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxTools)
      .map(s => s.tool);
  }
  
  private calculateRelevance(features: IntentFeatures, desc: ToolDescriptor): number {
    // 信号 1: 关键词匹配 (0-1)
    const keywordScore = features.keywords
      .filter(k => desc.keywords.includes(k)).length / features.keywords.length;
    
    // 信号 2: 向量相似度 (0-1)
    const vectorScore = cosineSimilarity(features.embedding, desc.embedding);
    
    // 信号 3: 历史使用率 (0-1)
    const usageScore = this.getUsageScore(desc.id, features.context);
    
    // 加权融合
    return 0.4 * keywordScore + 0.4 * vectorScore + 0.2 * usageScore;
  }
}
```

---

## 7. 调试与可观测性

### 7.1 执行追踪

```typescript
interface ExecutionTrace {
  id: string;
  agentId: string;
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  status: 'running' | 'completed' | 'error' | 'paused';
  nodes: NodeExecutionRecord[];
  totalTokens: { input: number; output: number; cached: number };
  totalDuration: number;
  costEstimate: number;
}

interface NodeExecutionRecord {
  nodeId: string;
  nodeType: string;
  startedAt: string;
  endedAt: string;
  duration: number;
  status: 'success' | 'error' | 'skipped';
  input?: any;
  output?: any;
  error?: string;
  tokens?: { input: number; output: number };
  retries: number;
}
```

### 7.2 实时调试面板

```
┌─────────────────────────────────────────────────┐
│  🐛 调试控制台                                   │
├─────────────────────────────────────────────────┤
│                                                 │
│  ▶ 执行流程                                     │
│  ┌─────────────────────────────────────────┐    │
│  │  ✅ start → 输入接收 (2ms)              │    │
│  │  ✅ llm_1 → 意图识别 (1.2s, 350 tokens) │    │
│  │  🔧 tool_1 → 搜索工具 (300ms)           │    │
│  │  ⏳ agent_1 → 等待中...                  │    │
│  │  ⭕ condition_1 → 待执行                │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  🔍 变量检查器                                   │
│  ┌─────────────────────────────────────────┐    │
│  │  {{user_input}}: "帮我分析这段代码"     │    │
│  │  {{intent}}: "code_analysis"            │    │
│  │  {{search_results}}: [...]              │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  📊 性能统计                                     │
│  ┌─────────────────────────────────────────┐    │
│  │  总耗时: 1.52s  │  Token: 1,200         │    │
│  │  预估成本: $0.004  │  节点数: 5         │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 8. 实施路线图

### Phase 1: 核心画布 (2-3 周)

**目标**: 可用的节点式编辑器 MVP

- [ ] **Week 1: 画布基础**
  - [ ] 集成 React Flow，实现基础画布操作（拖拽/缩放/平移）
  - [ ] 实现组件库面板（搜索/分类/拖拽）
  - [ ] 实现属性配置面板（JSON Schema 驱动的自动表单）
  - [ ] 实现 5 种核心节点 (start/end/llm/tool/condition)

- [ ] **Week 2: 执行引擎**
  - [ ] 实现 WorkflowEngine 编译+执行框架
  - [ ] 实现变量系统（引用/绑定/管道）
  - [ ] 实现调试控制台（单步执行/日志输出）
  - [ ] 实现 JSON ↔ 画布双向同步

- [ ] **Week 3: 完善与测试**
  - [ ] 增加 6 种节点 (agent/memory_read/memory_write/http/knowledge/loop)
  - [ ] 实现 Tool Search 机制
  - [ ] 编写核心引擎单元测试
  - [ ] 编写画布交互 E2E 测试

### Phase 2: 高级能力 (2-3 周)

**目标**: 完整的 Agent 编排平台

- [ ] **Week 4: 记忆系统**
  - [ ] 实现三层记忆架构
  - [ ] 实现 Hybrid 检索引擎
  - [ ] 实现记忆压缩与摘要
  - [ ] 记忆系统与 Worker 端 KV 集成

- [ ] **Week 5: 多 Agent**
  - [ ] 实现 MoA 路由器
  - [ ] 实现 A2A 协议节点
  - [ ] 实现子 Agent 并行执行
  - [ ] Agent 模板市场 MVP

- [ ] **Week 6: 可观测性**
  - [ ] 完整执行追踪系统
  - [ ] Token/Cost 预估面板
  - [ ] 性能分析仪表盘
  - [ ] 导出执行报告 (PDF/JSON)

### Phase 3: 生态完善 (持续)

**目标**: 生产就绪的 Agent 平台

- [ ] 插件系统 (自定义节点开发 SDK)
- [ ] 版本控制 (Git-like 分支/合并)
- [ ] A/B 测试与评估
- [ ] 团队协作 (多人实时编辑)
- [ ] 部署与发布 (一键部署为 API)

---

## 9. 关键技术决策

### 9.1 为什么选择 React Flow?

| 对比项 | React Flow | ReactFlow (xyflow) | 自研方案 |
|--------|------------|-------------------|----------|
| 社区 | 旧版，维护较少 | 活跃，V12 重写 | N/A |
| 性能 | 中等 | 高 (虚拟渲染) | 最优 |
| 定制性 | 中 | 高 | 完全 |
| 生态 | 丰富 | 快速增长 | 需自建 |
| 结论 | ❌ | ✅ 推荐 | ❌ 成本过高 |

**决策**: 使用 @xyflow/react (React Flow V12+)

### 9.2 为什么 Worker 端执行而非前端?

| 方案 | 优点 | 缺点 |
|------|------|------|
| **前端执行** | 低延迟，无需通信 | 无法访问 MCP Server，Token 暴露 |
| **Worker 执行** | 安全，可访问 KV/MCP | 增加一次网络往返 |
| **混合方案** | 兼顾延迟与安全 | 架构复杂度高 |

**决策**: 采用混合方案——简单逻辑 (条件/循环) 前端执行，LLM/工具/记忆操作 Worker 执行

### 9.3 工具描述格式

遵循 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) 规范：

```json
{
  "name": "search_code",
  "description": "在代码库中搜索匹配的文件",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "搜索关键词" },
      "language": { "type": "string", "enum": ["typescript", "python", "rust"] }
    },
    "required": ["query"]
  }
}
```

---

## 10. 迁移指南

### 从现有 AgentConfig 迁移

```typescript
// 旧格式
{
  systemPrompt: "...",
  model: "gpt-4o",
  tools: ["memory_save", "web_search"],
  temperature: 0.7
}

// 新格式 (最小迁移)
{
  nodes: [
    { id: "start_1", type: "start", position: { x: 0, y: 0 }, config: {} },
    {
      id: "llm_1",
      type: "llm",
      position: { x: 200, y: 0 },
      config: {
        model: "gpt-4o",
        systemPrompt: "...",
        userPrompt: "{{input}}",
        temperature: 0.7,
        tools: ["memory_save", "web_search"]
      }
    },
    { id: "end_1", type: "end", position: { x: 400, y: 0 }, config: {} }
  ],
  edges: [
    { source: "start_1", target: "llm_1", sourceHandle: "out", targetHandle: "in" },
    { source: "llm_1", target: "end_1", sourceHandle: "out", targetHandle: "in" }
  ]
}
```

---

## 附录

### A. JSON Schema 完整示例

[agentflow-schema.json](./schemas/agentflow-v1.json)

### B. 节点配置默认值

[node-defaults.ts](./src/lib/nodeDefaults.ts)

### C. 工具分类目录

[tool-categories.md](./docs/tool-categories.md)

### D. 参考实现

| 项目 | 参考点 |
|------|--------|
| [Dify](https://github.com/langgenius/dify) | Workflow 节点设计、Agent 策略插件 |
| [Langflow](https://github.com/langflow-ai/langflow) | 画布交互、组件面板 |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | 记忆分层、Tool Search |
| [n8n](https://github.com/n8n-io/n8n) | 工作流执行引擎 |
| [MCP 规范](https://modelcontextprotocol.io/) | 工具协议标准 |
