import type { FlowNode, FlowEdge, FlowNodeData } from '../types';
import { generateId } from './utils';

export const AGENTFLOW_VERSION = '1.0.0';

export interface AgentFlowJson {
  version: string;
  id: string;
  name: string;
  description?: string;
  graph: {
    nodes: AgentFlowNode[];
    edges: AgentFlowEdge[];
  };
}

export interface AgentFlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  config: Record<string, any>;
  label?: string;
}

export interface AgentFlowEdge {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
  label?: string;
  animated?: boolean;
}

export interface JsonParseResult {
  success: boolean;
  nodes: FlowNode[];
  edges: FlowEdge[];
  error?: string;
}

const NODE_TYPE_CONFIG_MAP: Record<string, string> = {
  start: 'startConfig',
  end: 'endConfig',
  llm: 'llmConfig',
  agent: 'agentConfig',
  code: 'codeConfig',
  http: 'httpConfig',
  tool: 'toolConfig',
  condition: 'conditionConfig',
  loop: 'loopConfig',
  variable: 'variableConfig',
  database: 'databaseConfig',
  host: 'hostConfig',
  knowledge: 'knowledgeConfig',
  template: 'templateConfig',
  human_in_loop: 'humanConfig',
  subworkflow: 'subworkflowConfig',
  subagent: 'subagentConfig',
  a2a: 'a2aConfig',
  memory_read: 'memoryReadConfig',
  memory_write: 'memoryWriteConfig',
};

function extractConfigFromData(data: FlowNodeData, nodeType: string): Record<string, any> {
  const configKey = NODE_TYPE_CONFIG_MAP[nodeType];
  const config: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === 'label' || key === 'description' || key === 'iconName' || key === 'type') {
      continue;
    }
    if (configKey && key === configKey) {
      return value || {};
    }
    config[key] = value;
  }

  return config;
}

function buildDataFromConfig(
  config: Record<string, any>,
  nodeType: string,
  label?: string
): FlowNodeData {
  const configKey = NODE_TYPE_CONFIG_MAP[nodeType];
  const data: FlowNodeData = {
    label: label || nodeType,
    description: '',
    iconName: 'Box',
    type: nodeType as any,
  };

  if (configKey) {
    (data as any)[configKey] = config;
  } else {
    Object.assign(data, config);
  }

  return data;
}

export function workflowToJson(
  nodes: FlowNode[],
  edges: FlowEdge[],
  options?: { workflowId?: string; workflowName?: string; workflowDescription?: string }
): string {
  const agentFlowNodes: AgentFlowNode[] = nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: { x: node.position.x, y: node.position.y },
    config: extractConfigFromData(node.data, node.type),
    label: node.data.label,
  }));

  const agentFlowEdges: AgentFlowEdge[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle || undefined,
    target: edge.target,
    targetHandle: edge.targetHandle || undefined,
    label: edge.label,
    animated: edge.animated,
  }));

  const agentFlow: AgentFlowJson = {
    version: AGENTFLOW_VERSION,
    id: options?.workflowId || `workflow_${generateId()}`,
    name: options?.workflowName || '未命名工作流',
    description: options?.workflowDescription,
    graph: {
      nodes: agentFlowNodes,
      edges: agentFlowEdges,
    },
  };

  return JSON.stringify(agentFlow, null, 2);
}

export function jsonToWorkflow(jsonString: string): JsonParseResult {
  try {
    const parsed = JSON.parse(jsonString);

    if (!parsed || typeof parsed !== 'object') {
      return { success: false, nodes: [], edges: [], error: 'JSON 必须是一个对象' };
    }

    if (!parsed.version || typeof parsed.version !== 'string') {
      return { success: false, nodes: [], edges: [], error: '缺少 version 字段或格式错误' };
    }

    if (!parsed.version.match(/^\d+\.\d+\.\d+$/)) {
      return { success: false, nodes: [], edges: [], error: `version 格式无效: ${parsed.version}` };
    }

    const majorVersion = parseInt(parsed.version.split('.')[0], 10);
    const expectedMajor = parseInt(AGENTFLOW_VERSION.split('.')[0], 10);
    if (majorVersion > expectedMajor) {
      return {
        success: false,
        nodes: [],
        edges: [],
        error: `不支持的版本: ${parsed.version}，当前支持的最高主版本: ${expectedMajor}`,
      };
    }

    if (!parsed.graph || typeof parsed.graph !== 'object') {
      return { success: false, nodes: [], edges: [], error: '缺少 graph 字段或格式错误' };
    }

    if (!Array.isArray(parsed.graph.nodes)) {
      return { success: false, nodes: [], edges: [], error: 'graph.nodes 必须是数组' };
    }

    if (!Array.isArray(parsed.graph.edges)) {
      return { success: false, nodes: [], edges: [], error: 'graph.edges 必须是数组' };
    }

    const flowNodes: FlowNode[] = parsed.graph.nodes.map((node: any, index: number) => {
      if (!node || typeof node !== 'object') {
        throw new Error(`节点 ${index} 格式无效`);
      }
      if (!node.id || typeof node.id !== 'string') {
        throw new Error(`节点 ${index} 缺少 id 字段`);
      }
      if (!node.type || typeof node.type !== 'string') {
        throw new Error(`节点 ${node.id} 缺少 type 字段`);
      }
      if (!node.position || typeof node.position !== 'object' ||
          typeof node.position.x !== 'number' || typeof node.position.y !== 'number') {
        throw new Error(`节点 ${node.id} 缺少有效的 position 字段`);
      }

      const config = node.config && typeof node.config === 'object' ? node.config : {};

      return {
        id: node.id,
        type: node.type,
        position: { x: node.position.x, y: node.position.y },
        data: buildDataFromConfig(config, node.type, node.label),
      };
    });

    const flowEdges: FlowEdge[] = parsed.graph.edges.map((edge: any, index: number) => {
      if (!edge || typeof edge !== 'object') {
        throw new Error(`边 ${index} 格式无效`);
      }
      if (!edge.id || typeof edge.id !== 'string') {
        throw new Error(`边 ${index} 缺少 id 字段`);
      }
      if (!edge.source || typeof edge.source !== 'string') {
        throw new Error(`边 ${edge.id} 缺少 source 字段`);
      }
      if (!edge.target || typeof edge.target !== 'string') {
        throw new Error(`边 ${edge.id} 缺少 target 字段`);
      }

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || null,
        targetHandle: edge.targetHandle || null,
        label: edge.label,
        animated: edge.animated || false,
      };
    });

    return { success: true, nodes: flowNodes, edges: flowEdges };
  } catch (err: any) {
    return {
      success: false,
      nodes: [],
      edges: [],
      error: err instanceof SyntaxError ? `JSON 解析错误: ${err.message}` : err.message || '未知错误',
    };
  }
}

export function validateJson(jsonString: string): { valid: boolean; error?: string } {
  const result = jsonToWorkflow(jsonString);
  return { valid: result.success, error: result.error };
}
