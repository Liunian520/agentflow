/**
 * LLM 工作流设计器 — 用自然语言对话创建工作流
 *
 * 核心思路：
 * 1. 构造系统提示词，让 LLM 根据用户描述生成工作流结构 JSON
 * 2. 用 routedChatLLM（非流式）调用，获取完整 JSON 后解析
 * 3. 解析失败时降级为模板拼接（现有 actionExecutor 逻辑）
 * 4. 支持增量修改：在已有工作流基础上增删节点
 */

import { routedChatLLM } from '../api/llmApi';
import { extractTaskFeatures } from './modelRouter';
import { generateId } from './utils';
import type { WorkflowNode, WorkflowEdge, Workflow, NodeType } from '../types';
import { nodeTemplates } from '../data/mockData';

// ===== 可用节点类型说明（供 LLM 参考） =====

const NODE_TYPE_DESCRIPTION: Record<NodeType, { name: string; desc: string; icon: string; color: string; category: string }> = {
  start:       { name: '开始',       desc: '工作流入口，定义输入参数',                     icon: 'Play',      color: '#10b981', category: '基础控制' },
  end:         { name: '结束',       desc: '工作流结束，定义输出结果',                     icon: 'StopCircle', color: '#ef4444', category: '基础控制' },
  llm:         { name: 'LLM 调用',   desc: '调用大语言模型（如GPT/Claude/DeepSeek）',     icon: 'Brain',     color: '#3b82f6', category: 'AI 能力' },
  agent:       { name: 'Agent',      desc: '智能 Agent 节点，自主执行任务',                icon: 'Bot',       color: '#8b5cf6', category: 'AI 能力' },
  subagent:    { name: '子 Agent',   desc: '并行子 Agent，多 Agent 协作',                  icon: 'Users',     color: '#a855f7', category: 'AI 能力' },
  a2a:         { name: 'A2A 调用',   desc: '通过 A2A 协议调用外部 Agent（跨系统互操作）',  icon: 'Share2',    color: '#0891b2', category: 'AI 能力' },
  code:        { name: '代码执行',   desc: '执行 JavaScript/Python 代码处理数据',          icon: 'Code',      color: '#f59e0b', category: '数据处理' },
  template:    { name: '模板渲染',   desc: '用模板引擎渲染内容（如邮件模板）',             icon: 'FileText',  color: '#14b8a6', category: '数据处理' },
  variable:    { name: '变量设置',   desc: '设置和修改变量值',                              icon: 'Settings',  color: '#06b6d4', category: '数据处理' },
  http:        { name: 'HTTP 请求',  desc: '发送 HTTP 请求获取/提交数据',                  icon: 'Globe',     color: '#f97316', category: '外部调用' },
  database:    { name: '数据库查询', desc: '执行数据库 SQL 查询',                          icon: 'Database',  color: '#1e40af', category: '外部调用' },
  knowledge:   { name: '知识库检索', desc: '从知识库检索相关内容',                          icon: 'BookOpen',  color: '#84cc16', category: '外部调用' },
  condition:   { name: '条件分支',   desc: '根据条件走不同分支路径',                        icon: 'GitBranch', color: '#8b5cf6', category: '流程控制' },
  loop:        { name: '循环',       desc: '循环处理数据（固定次数/条件循环）',             icon: 'RefreshCw', color: '#ec4899', category: '流程控制' },
  subworkflow: { name: '子工作流',   desc: '调用另一个工作流作为子流程',                    icon: 'Layers',    color: '#6366f1', category: '流程控制' },
  'human-in-loop': { name: '人工审核', desc: '需要人工介入审核/确认',                      icon: 'User',      color: '#f43f5e', category: '交互与部署' },
  host:        { name: '远程主机',   desc: '在远程主机执行命令（SSH）',                     icon: 'Server',    color: '#6b7280', category: '交互与部署' },
};

// ===== 系统提示词 =====

const SYSTEM_PROMPT = `你是 AgentFlow 工作流设计器。根据用户的自然语言描述，设计工作流的节点和连线结构。

## 可用节点类型
${Object.entries(NODE_TYPE_DESCRIPTION)
  .map(([type, info]) => `- "${type}" (${info.name}): ${info.desc} [icon=${info.icon}, color=${info.color}, category=${info.category}]`)
  .join('\n')}

## 规则
1. 每个工作流必须以 "start" 节点开头，以 "end" 节点结尾
2. 节点之间用连线(edges)串联，形成有向流程图
3. 尽量贴近用户描述的功能需求选择合适的节点类型
4. 条件分支节点可以有多个输出连线（用 label 区分，如"通过"/"拒绝"）
5. 每个节点要有合理的名称(name)和描述(description)
6. 为每个节点分配唯一的 id（格式 "node-xxx"，xxx 为随机字符串如 a1b2c3）
7. 连线 id 格式 "edge-xxx"

## 输出格式
严格输出 JSON，不要包含任何其他文本。JSON 结构如下：
{
  "name": "工作流名称",
  "description": "工作流描述",
  "nodes": [
    { "id": "node-xxx", "type": "节点类型", "name": "节点名称", "description": "节点描述" }
  ],
  "edges": [
    { "id": "edge-xxx", "source": "源节点id", "target": "目标节点id", "label": "连线标签(可选)" }
  ]
}

## 示例
用户说"帮我创建一个内容审核工作流：接收文本→AI判断是否合规→不合规则人工复审→输出结果"
你应该输出：
{
  "name": "内容审核流程",
  "description": "自动审核内容合规性，不合规时转人工复审",
  "nodes": [
    { "id": "node-start1", "type": "start", "name": "接收文本", "description": "接收待审核文本" },
    { "id": "node-llm1", "type": "llm", "name": "AI合规判断", "description": "用大模型判断文本是否合规" },
    { "id": "node-cond1", "type": "condition", "name": "合规判断", "description": "根据AI判断结果分支" },
    { "id": "node-human1", "type": "human-in-loop", "name": "人工复审", "description": "对不合规内容进行人工审核" },
    { "id": "node-llm2", "type": "llm", "name": "生成审核报告", "description": "汇总审核结果生成报告" },
    { "id": "node-end1", "type": "end", "name": "输出结果", "description": "输出审核结果" }
  ],
  "edges": [
    { "id": "edge-e1", "source": "node-start1", "target": "node-llm1" },
    { "id": "edge-e2", "source": "node-llm1", "target": "node-cond1" },
    { "id": "edge-e3", "source": "node-cond1", "target": "node-human1", "label": "不合规" },
    { "id": "edge-e4", "source": "node-cond1", "target": "node-llm2", "label": "合规" },
    { "id": "edge-e5", "source": "node-human1", "target": "node-llm2" },
    { "id": "edge-e6", "source": "node-llm2", "target": "node-end1" }
  ]
}`;

// 增量修改的系统提示词
const MODIFY_SYSTEM_PROMPT = `你是 AgentFlow 工作流修改器。用户希望对已有工作流进行修改。

## 当前工作流结构
{{CURRENT_WORKFLOW}}

## 可用节点类型
${Object.entries(NODE_TYPE_DESCRIPTION)
  .map(([type, info]) => `- "${type}" (${info.name}): ${info.desc}`)
  .join('\n')}

## 规则
1. 保持原有节点的 id 不变（除非明确要删除）
2. 新增节点的 id 格式 "node-xxx"
3. 新增连线的 id 格式 "edge-xxx"
4. 只输出需要的变化，格式如下：
{
  "name": "新工作流名称(如果改名)",
  "description": "新描述(如果改描述)",
  "addedNodes": [{ "id": "node-xxx", "type": "节点类型", "name": "节点名称", "description": "节点描述" }],
  "removedNodeIds": ["要删除的节点id"],
  "addedEdges": [{ "id": "edge-xxx", "source": "源id", "target": "目标id", "label": "标签(可选)" }],
  "removedEdgeIds": ["要删除的连线id"],
  "updatedNodes": [{ "id": "要更新的节点id", "name": "新名称", "description": "新描述" }]
}

如果某个字段没有变化，留空数组或省略。严格输出 JSON，不要包含任何其他文本。`;

// ===== 核心函数 =====

export interface WorkflowDesignResult {
  success: boolean;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  rawLLMOutput?: string;      // LLM 原始输出（用于调试）
  fallback?: boolean;         // 是否降级为模板拼接
  error?: string;
}

/**
 * 用 LLM 设计工作流（从自然语言描述创建）
 */
export async function designWorkflowFromDescription(
  userDescription: string,
): Promise<WorkflowDesignResult> {
  const result = await routedChatLLM(
    {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userDescription },
      ],
      temperature: 0.3,  // 低温度保证 JSON 输出稳定
      maxTokens: 2048,
    },
    extractTaskFeatures(userDescription, { intent: 'workflow_design' }),
  );

  if (!result.success || !result.content) {
    // LLM 调用失败 → 降级为模板拼接
    return fallbackDesign(userDescription, result.message || 'LLM 调用失败');
  }

  const parsed = parseWorkflowJSON(result.content);
  if (!parsed) {
    // JSON 解析失败 → 降级为模板拼接
    return fallbackDesign(userDescription, 'LLM 输出无法解析为 JSON', result.content);
  }

  // 补全节点的 icon/color/category/defaultData（LLM 不输出这些细节）
  const nodes = enrichNodes(parsed.nodes);
  // 确保首尾节点存在
  const { nodes: finalNodes, edges: finalEdges } = ensureStartEnd(nodes, parsed.edges);

  return {
    success: true,
    name: parsed.name || '新工作流',
    description: parsed.description || '通过对话创建的工作流',
    nodes: finalNodes,
    edges: finalEdges,
    rawLLMOutput: result.content,
  };
}

export interface WorkflowModifyResult {
  success: boolean;
  addedNodes: WorkflowNode[];
  removedNodeIds: string[];
  addedEdges: WorkflowEdge[];
  removedEdgeIds: string[];
  updatedNodes: Array<{ id: string; name?: string; description?: string }>;
  name?: string;
  description?: string;
  rawLLMOutput?: string;
  fallback?: boolean;
  error?: string;
}

/**
 * 用 LLM 增量修改工作流
 */
export async function modifyWorkflowWithDescription(
  currentWorkflow: Workflow,
  modificationDescription: string,
): Promise<WorkflowModifyResult> {
  const wfSummary = JSON.stringify({
    name: currentWorkflow.name,
    description: currentWorkflow.description,
    nodes: currentWorkflow.nodes.map((n) => ({
      id: n.id, type: n.type, name: n.name, description: n.description,
    })),
    edges: currentWorkflow.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target, label: e.label,
    })),
  }, null, 2);

  const systemPrompt = MODIFY_SYSTEM_PROMPT.replace('{{CURRENT_WORKFLOW}}', wfSummary);

  const result = await routedChatLLM(
    {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: modificationDescription },
      ],
      temperature: 0.3,
      maxTokens: 1536,
    },
    extractTaskFeatures(modificationDescription, { intent: 'workflow_modify' }),
  );

  if (!result.success || !result.content) {
    return { success: false, addedNodes: [], removedNodeIds: [], addedEdges: [], removedEdgeIds: [], updatedNodes: [], error: result.message || 'LLM 调用失败' };
  }

  const parsed = parseModifyJSON(result.content);
  if (!parsed) {
    return { success: false, addedNodes: [], removedNodeIds: [], addedEdges: [], removedEdgeIds: [], updatedNodes: [], rawLLMOutput: result.content, error: 'LLM 输出无法解析为修改 JSON' };
  }

  // 补全新增节点
  const addedNodes = enrichNodes(parsed.addedNodes || []);

  return {
    success: true,
    addedNodes,
    removedNodeIds: parsed.removedNodeIds || [],
    addedEdges: enrichEdges(parsed.addedEdges || []),
    removedEdgeIds: parsed.removedEdgeIds || [],
    updatedNodes: parsed.updatedNodes || [],
    name: parsed.name,
    description: parsed.description,
    rawLLMOutput: result.content,
  };
}

/**
 * 应用修改结果到工作流
 */
export function applyWorkflowModification(
  workflow: Workflow,
  modifyResult: WorkflowModifyResult,
): Workflow {
  const nodes = [...workflow.nodes];

  // 移除节点（同时移除关联连线）
  const removeSet = new Set(modifyResult.removedNodeIds);
  const filteredNodes = nodes.filter((n) => !removeSet.has(n.id));

  // 更新已有节点
  for (const update of modifyResult.updatedNodes) {
    const idx = filteredNodes.findIndex((n) => n.id === update.id);
    if (idx !== -1) {
      filteredNodes[idx] = {
        ...filteredNodes[idx],
        ...(update.name ? { name: update.name } : {}),
        ...(update.description ? { description: update.description } : {}),
      };
    }
  }

  // 新增节点
  filteredNodes.push(...modifyResult.addedNodes);

  const edges = [...workflow.edges];
  // 移除连线
  const filteredEdges = edges.filter((e) => !modifyResult.removedEdgeIds.includes(e.id));
  // 新增连线
  filteredEdges.push(...modifyResult.addedEdges);

  return {
    ...workflow,
    name: modifyResult.name || workflow.name,
    description: modifyResult.description || workflow.description,
    nodes: filteredNodes,
    edges: filteredEdges,
    updatedAt: new Date().toISOString(),
  };
}

// ===== JSON 解析 =====

function parseWorkflowJSON(raw: string): {
  name?: string;
  description?: string;
  nodes: Array<{ id: string; type: string; name: string; description: string }>;
  edges: Array<{ id: string; source: string; target: string; label?: string }>;
} | null {
  // 尝试提取 JSON 块（可能被 markdown code fence 包裹）
  const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) ||
    raw.match(/\{[\s\S]*"nodes"[\s\S]*\}/);

  if (!jsonMatch) return null;

  try {
    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const obj = JSON.parse(jsonStr);

    // 基本结构校验
    if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) return null;

    // 校验每个 node 必有 id + type
    for (const node of obj.nodes) {
      if (!node.id || !node.type) return null;
      // 确保 type 是合法的 NodeType
      if (!NODE_TYPE_DESCRIPTION[node.type as NodeType]) return null;
    }

    // 校验每个 edge 必有 id + source + target
    for (const edge of obj.edges) {
      if (!edge.id || !edge.source || !edge.target) return null;
      // source/target 必须指向存在的 node
      const nodeIds = obj.nodes.map((n: any) => n.id);
      if (!nodeIds.includes(edge.source) || !nodeIds.includes(edge.target)) return null;
    }

    return obj;
  } catch {
    return null;
  }
}

function parseModifyJSON(raw: string): {
  name?: string;
  description?: string;
  addedNodes?: Array<{ id: string; type: string; name: string; description: string }>;
  removedNodeIds?: string[];
  addedEdges?: Array<{ id: string; source: string; target: string; label?: string }>;
  removedEdgeIds?: string[];
  updatedNodes?: Array<{ id: string; name?: string; description?: string }>;
} | null {
  const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) ||
    raw.match(/\{[\s\S]*\}/);

  if (!jsonMatch) return null;

  try {
    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const obj = JSON.parse(jsonStr);
    // 基本校验：至少有 addedNodes 或 removedNodeIds 或 addedEdges 或 removedEdgeIds
    if (!obj.addedNodes && !obj.removedNodeIds && !obj.addedEdges && !obj.removedEdgeIds && !obj.updatedNodes) {
      // 可能只是改了 name/description，也是有效的
      if (!obj.name && !obj.description) return null;
    }
    return obj;
  } catch {
    return null;
  }
}

// ===== 节点补全 =====

function enrichNodes(
  rawNodes: Array<{ id: string; type: string; name: string; description: string }>,
): WorkflowNode[] {
  return rawNodes.map((n) => {
    const typeInfo = NODE_TYPE_DESCRIPTION[n.type as NodeType];
    // 从模板获取 defaultData
    const template = nodeTemplates.find((t) => t.type === n.type);

    return {
      id: n.id,
      type: n.type as NodeType,
      name: n.name || typeInfo?.name || n.type,
      description: n.description || typeInfo?.desc || '',
      icon: typeInfo?.icon || 'Circle',
      color: typeInfo?.color || '#6b7280',
      category: typeInfo?.category || '其他',
      defaultData: template?.defaultData ? { ...template.defaultData, label: n.name, description: n.description } : undefined,
    };
  });
}

function enrichEdges(
  rawEdges: Array<{ id: string; source: string; target: string; label?: string }>,
): WorkflowEdge[] {
  return rawEdges.map((e) => ({
    id: e.id || `edge-${generateId()}`,
    source: e.source,
    target: e.target,
    label: e.label,
  }));
}

// ===== 确保有 start/end =====

function ensureStartEnd(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const hasStart = nodes.some((n) => n.type === 'start');
  const hasEnd = nodes.some((n) => n.type === 'end');

  let finalNodes = [...nodes];
  let finalEdges = [...edges];

  // 没有 start → 自动在最前面插入，并连到第一个非 start 节点
  if (!hasStart) {
    const startNode: WorkflowNode = {
      id: 'node-auto-start',
      type: 'start',
      name: '开始',
      description: '工作流入口',
      icon: 'Play',
      color: '#10b981',
      category: '基础控制',
      defaultData: nodeTemplates.find((t) => t.type === 'start')?.defaultData,
    };
    finalNodes.unshift(startNode);
    const firstNonStart = nodes[0]?.id;
    if (firstNonStart) {
      finalEdges.unshift({ id: 'edge-auto-start', source: startNode.id, target: firstNonStart });
    }
  }

  // 没有 end → 自动在最后插入，并从最后一个非 end 节点连到它
  if (!hasEnd) {
    const endNode: WorkflowNode = {
      id: 'node-auto-end',
      type: 'end',
      name: '结束',
      description: '工作流结束',
      icon: 'StopCircle',
      color: '#ef4444',
      category: '基础控制',
      defaultData: nodeTemplates.find((t) => t.type === 'end')?.defaultData,
    };
    finalNodes.push(endNode);
    // 找最后一个没有出边的非 end 节点
    const sourcesWithEdges = new Set(finalEdges.map((e) => e.source));
    const lastNoOut = finalNodes.filter((n) => n.type !== 'end' && !sourcesWithEdges.has(n.id)).pop();
    if (lastNoOut) {
      finalEdges.push({ id: 'edge-auto-end', source: lastNoOut.id, target: endNode.id });
    }
  }

  return { nodes: finalNodes, edges: finalEdges };
}

// ===== 降级模板拼接（fallback） =====

function fallbackDesign(
  userDescription: string,
  error: string,
  rawLLMOutput?: string,
): WorkflowDesignResult {
  // 简单的关键词→节点映射
  const keywordNodeMap: Record<string, NodeType> = {
    'ai': 'llm', '大模型': 'llm', 'llm': 'llm', '判断': 'condition', '审核': 'human-in-loop',
    '人工': 'human-in-loop', '分支': 'condition', '条件': 'condition', '循环': 'loop',
    'http': 'http', '请求': 'http', '数据库': 'database', 'sql': 'database',
    '知识库': 'knowledge', '代码': 'code', '执行': 'code', 'agent': 'agent', '智能体': 'agent',
  };

  const lower = userDescription.toLowerCase();
  const detectedTypes: NodeType[] = [];
  for (const [kw, type] of Object.entries(keywordNodeMap)) {
    if (lower.includes(kw) && !detectedTypes.includes(type)) {
      detectedTypes.push(type);
    }
  }

  // 构建节点序列：start → detected → end
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  // start
  const startTemplate = nodeTemplates.find((t) => t.type === 'start')!;
  const startId = `node-${generateId()}`;
  nodes.push({ ...startTemplate, id: startId });

  let prevId = startId;
  for (const type of detectedTypes) {
    const template = nodeTemplates.find((t) => t.type === type);
    if (!template) continue;
    const nodeId = `node-${generateId()}`;
    nodes.push({ ...template, id: nodeId });
    edges.push({ id: `edge-${generateId()}`, source: prevId, target: nodeId });
    prevId = nodeId;
  }

  // end
  const endTemplate = nodeTemplates.find((t) => t.type === 'end')!;
  const endId = `node-${generateId()}`;
  nodes.push({ ...endTemplate, id: endId });
  edges.push({ id: `edge-${generateId()}`, source: prevId, target: endId });

  // 如果没有检测到任何中间节点，至少加一个 llm
  if (detectedTypes.length === 0) {
    const llmTemplate = nodeTemplates.find((t) => t.type === 'llm')!;
    const llmId = `node-${generateId()}`;
    nodes.splice(1, 0, { ...llmTemplate, id: llmId });
    edges.splice(0, edges.length,
      { id: `edge-${generateId()}`, source: startId, target: llmId },
      { id: `edge-${generateId()}`, source: llmId, target: endId },
    );
  }

  // 推断名称
  const nameMatch = userDescription.match(/(?:创建|设计|帮我|做一个)\s*(?:一个)?(.{2,20}?)(?:工作流|流程|pipeline)/);
  const name = nameMatch ? nameMatch[1].trim() : '新工作流';

  return {
    success: true,
    name,
    description: `通过对话创建的工作流（${error}，已降级为模板拼接）`,
    nodes,
    edges,
    rawLLMOutput,
    fallback: true,
  };
}
