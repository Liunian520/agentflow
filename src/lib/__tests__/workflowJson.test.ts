import { describe, it, expect } from 'vitest';
import { workflowToJson, jsonToWorkflow, validateJson, AGENTFLOW_VERSION } from '../workflowJson';
import type { FlowNode, FlowEdge } from '../../types';

const mockNodes: FlowNode[] = [
  {
    id: 'node_start',
    type: 'start',
    position: { x: 100, y: 100 },
    data: {
      label: '开始',
      description: '工作流起点',
      iconName: 'Play',
      type: 'start',
      startConfig: {
        inputs: [
          { id: 'in1', name: 'userInput', type: 'string', required: true },
        ],
      },
    },
  },
  {
    id: 'node_llm',
    type: 'llm',
    position: { x: 350, y: 100 },
    data: {
      label: 'LLM 调用',
      description: '调用大语言模型',
      iconName: 'Brain',
      type: 'llm',
      llmConfig: {
        model: 'gpt-4o',
        systemPrompt: '你是一个助手',
        userPrompt: '你好',
        temperature: 0.7,
        maxTokens: 2048,
        outputVariable: 'llm_output',
      },
    },
  },
  {
    id: 'node_end',
    type: 'end',
    position: { x: 600, y: 100 },
    data: {
      label: '结束',
      description: '工作流终点',
      iconName: 'Stop',
      type: 'end',
      endConfig: {
        outputs: [
          { id: 'out1', name: 'result', type: 'string', value: '{{llm_output}}' },
        ],
      },
    },
  },
];

const mockEdges: FlowEdge[] = [
  {
    id: 'edge_1',
    source: 'node_start',
    target: 'node_llm',
    sourceHandle: 'out',
    targetHandle: 'in',
    label: '开始→LLM',
  },
  {
    id: 'edge_2',
    source: 'node_llm',
    target: 'node_end',
    sourceHandle: 'out',
    targetHandle: 'in',
    animated: true,
  },
];

describe('workflowJson', () => {
  describe('workflowToJson', () => {
    it('should convert nodes and edges to valid JSON string', () => {
      const json = workflowToJson(mockNodes, mockEdges, {
        workflowId: 'test_workflow',
        workflowName: '测试工作流',
        workflowDescription: '这是一个测试工作流',
      });

      const parsed = JSON.parse(json);

      expect(parsed.version).toBe(AGENTFLOW_VERSION);
      expect(parsed.id).toBe('test_workflow');
      expect(parsed.name).toBe('测试工作流');
      expect(parsed.description).toBe('这是一个测试工作流');
      expect(parsed.graph.nodes).toHaveLength(3);
      expect(parsed.graph.edges).toHaveLength(2);
    });

    it('should include node positions correctly', () => {
      const json = workflowToJson(mockNodes, mockEdges);
      const parsed = JSON.parse(json);

      expect(parsed.graph.nodes[0].position.x).toBe(100);
      expect(parsed.graph.nodes[0].position.y).toBe(100);
      expect(parsed.graph.nodes[1].position.x).toBe(350);
      expect(parsed.graph.nodes[1].position.y).toBe(100);
    });

    it('should include node labels', () => {
      const json = workflowToJson(mockNodes, mockEdges);
      const parsed = JSON.parse(json);

      expect(parsed.graph.nodes[0].label).toBe('开始');
      expect(parsed.graph.nodes[1].label).toBe('LLM 调用');
    });

    it('should extract config from node data based on type', () => {
      const json = workflowToJson(mockNodes, mockEdges);
      const parsed = JSON.parse(json);

      const startNode = parsed.graph.nodes.find((n: any) => n.type === 'start');
      const llmNode = parsed.graph.nodes.find((n: any) => n.type === 'llm');

      expect(startNode.config.inputs).toBeDefined();
      expect(startNode.config.inputs).toHaveLength(1);
      expect(llmNode.config.model).toBe('gpt-4o');
      expect(llmNode.config.systemPrompt).toBe('你是一个助手');
    });

    it('should include edge properties correctly', () => {
      const json = workflowToJson(mockNodes, mockEdges);
      const parsed = JSON.parse(json);

      expect(parsed.graph.edges[0].source).toBe('node_start');
      expect(parsed.graph.edges[0].target).toBe('node_llm');
      expect(parsed.graph.edges[0].sourceHandle).toBe('out');
      expect(parsed.graph.edges[0].targetHandle).toBe('in');
      expect(parsed.graph.edges[0].label).toBe('开始→LLM');
      expect(parsed.graph.edges[1].animated).toBe(true);
    });

    it('should generate default id and name when not provided', () => {
      const json = workflowToJson(mockNodes, mockEdges);
      const parsed = JSON.parse(json);

      expect(parsed.id).toBeDefined();
      expect(typeof parsed.id).toBe('string');
      expect(parsed.id.length).toBeGreaterThan(0);
      expect(parsed.name).toBe('未命名工作流');
    });

    it('should produce pretty-printed JSON with indentation', () => {
      const json = workflowToJson(mockNodes, mockEdges);
      expect(json).toContain('\n');
      expect(json).toContain('  ');
    });

    it('should handle empty nodes and edges', () => {
      const json = workflowToJson([], []);
      const parsed = JSON.parse(json);

      expect(parsed.graph.nodes).toHaveLength(0);
      expect(parsed.graph.edges).toHaveLength(0);
    });
  });

  describe('jsonToWorkflow', () => {
    it('should parse valid JSON and return nodes and edges', () => {
      const json = workflowToJson(mockNodes, mockEdges, {
        workflowId: 'test',
        workflowName: 'Test',
      });
      const result = jsonToWorkflow(json);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.nodes).toHaveLength(3);
      expect(result.edges).toHaveLength(2);
    });

    it('should preserve node IDs', () => {
      const json = workflowToJson(mockNodes, mockEdges);
      const result = jsonToWorkflow(json);

      expect(result.success).toBe(true);
      expect(result.nodes[0].id).toBe('node_start');
      expect(result.nodes[1].id).toBe('node_llm');
      expect(result.nodes[2].id).toBe('node_end');
    });

    it('should preserve node positions', () => {
      const json = workflowToJson(mockNodes, mockEdges);
      const result = jsonToWorkflow(json);

      expect(result.success).toBe(true);
      expect(result.nodes[0].position.x).toBe(100);
      expect(result.nodes[0].position.y).toBe(100);
    });

    it('should preserve node types', () => {
      const json = workflowToJson(mockNodes, mockEdges);
      const result = jsonToWorkflow(json);

      expect(result.success).toBe(true);
      expect(result.nodes[0].type).toBe('start');
      expect(result.nodes[1].type).toBe('llm');
      expect(result.nodes[2].type).toBe('end');
    });

    it('should restore config into node data based on type', () => {
      const json = workflowToJson(mockNodes, mockEdges);
      const result = jsonToWorkflow(json);

      expect(result.success).toBe(true);

      const startNode = result.nodes.find((n) => n.type === 'start');
      const llmNode = result.nodes.find((n) => n.type === 'llm');

      expect(startNode?.data.startConfig).toBeDefined();
      expect(startNode?.data.startConfig?.inputs).toHaveLength(1);
      expect(llmNode?.data.llmConfig).toBeDefined();
      expect(llmNode?.data.llmConfig?.model).toBe('gpt-4o');
    });

    it('should preserve edge properties', () => {
      const json = workflowToJson(mockNodes, mockEdges);
      const result = jsonToWorkflow(json);

      expect(result.success).toBe(true);
      expect(result.edges[0].source).toBe('node_start');
      expect(result.edges[0].target).toBe('node_llm');
      expect(result.edges[0].sourceHandle).toBe('out');
      expect(result.edges[0].targetHandle).toBe('in');
      expect(result.edges[0].label).toBe('开始→LLM');
    });

    it('should return error for invalid JSON syntax', () => {
      const result = jsonToWorkflow('{ invalid json }');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('JSON 解析错误');
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('should return error for empty string', () => {
      const result = jsonToWorkflow('');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('should return error when version is missing', () => {
      const invalidJson = JSON.stringify({
        id: 'test',
        name: 'Test',
        graph: { nodes: [], edges: [] },
      });
      const result = jsonToWorkflow(invalidJson);

      expect(result.success).toBe(false);
      expect(result.error).toContain('version');
    });

    it('should return error when version format is invalid', () => {
      const invalidJson = JSON.stringify({
        version: 'invalid',
        id: 'test',
        name: 'Test',
        graph: { nodes: [], edges: [] },
      });
      const result = jsonToWorkflow(invalidJson);

      expect(result.success).toBe(false);
      expect(result.error).toContain('version 格式无效');
    });

    it('should return error for unsupported major version', () => {
      const invalidJson = JSON.stringify({
        version: '99.0.0',
        id: 'test',
        name: 'Test',
        graph: { nodes: [], edges: [] },
      });
      const result = jsonToWorkflow(invalidJson);

      expect(result.success).toBe(false);
      expect(result.error).toContain('不支持的版本');
    });

    it('should return error when graph is missing', () => {
      const invalidJson = JSON.stringify({
        version: AGENTFLOW_VERSION,
        id: 'test',
        name: 'Test',
      });
      const result = jsonToWorkflow(invalidJson);

      expect(result.success).toBe(false);
      expect(result.error).toContain('graph');
    });

    it('should return error when nodes is not an array', () => {
      const invalidJson = JSON.stringify({
        version: AGENTFLOW_VERSION,
        id: 'test',
        name: 'Test',
        graph: { nodes: 'not-array', edges: [] },
      });
      const result = jsonToWorkflow(invalidJson);

      expect(result.success).toBe(false);
      expect(result.error).toContain('graph.nodes 必须是数组');
    });

    it('should return error when node is missing id', () => {
      const invalidJson = JSON.stringify({
        version: AGENTFLOW_VERSION,
        id: 'test',
        name: 'Test',
        graph: {
          nodes: [{ type: 'start', position: { x: 0, y: 0 } }],
          edges: [],
        },
      });
      const result = jsonToWorkflow(invalidJson);

      expect(result.success).toBe(false);
      expect(result.error).toContain('缺少 id 字段');
    });

    it('should return error when node is missing type', () => {
      const invalidJson = JSON.stringify({
        version: AGENTFLOW_VERSION,
        id: 'test',
        name: 'Test',
        graph: {
          nodes: [{ id: 'node1', position: { x: 0, y: 0 } }],
          edges: [],
        },
      });
      const result = jsonToWorkflow(invalidJson);

      expect(result.success).toBe(false);
      expect(result.error).toContain('缺少 type 字段');
    });

    it('should return error when node position is invalid', () => {
      const invalidJson = JSON.stringify({
        version: AGENTFLOW_VERSION,
        id: 'test',
        name: 'Test',
        graph: {
          nodes: [{ id: 'node1', type: 'start', position: 'invalid' }],
          edges: [],
        },
      });
      const result = jsonToWorkflow(invalidJson);

      expect(result.success).toBe(false);
      expect(result.error).toContain('position');
    });

    it('should return error when edge is missing source', () => {
      const invalidJson = JSON.stringify({
        version: AGENTFLOW_VERSION,
        id: 'test',
        name: 'Test',
        graph: {
          nodes: [],
          edges: [{ id: 'edge1', target: 'node2' }],
        },
      });
      const result = jsonToWorkflow(invalidJson);

      expect(result.success).toBe(false);
      expect(result.error).toContain('缺少 source 字段');
    });

    it('should return error when edge is missing target', () => {
      const invalidJson = JSON.stringify({
        version: AGENTFLOW_VERSION,
        id: 'test',
        name: 'Test',
        graph: {
          nodes: [],
          edges: [{ id: 'edge1', source: 'node1' }],
        },
      });
      const result = jsonToWorkflow(invalidJson);

      expect(result.success).toBe(false);
      expect(result.error).toContain('缺少 target 字段');
    });
  });

  describe('round-trip consistency', () => {
    it('should maintain consistency through toJson → fromJson → toJson', () => {
      const json1 = workflowToJson(mockNodes, mockEdges, {
        workflowId: 'test_wf',
        workflowName: 'Test Workflow',
        workflowDescription: 'Test description',
      });

      const result = jsonToWorkflow(json1);
      expect(result.success).toBe(true);

      const json2 = workflowToJson(result.nodes, result.edges, {
        workflowId: 'test_wf',
        workflowName: 'Test Workflow',
        workflowDescription: 'Test description',
      });

      const parsed1 = JSON.parse(json1);
      const parsed2 = JSON.parse(json2);

      expect(parsed1.version).toEqual(parsed2.version);
      expect(parsed1.id).toEqual(parsed2.id);
      expect(parsed1.name).toEqual(parsed2.name);
      expect(parsed1.graph.nodes.length).toEqual(parsed2.graph.nodes.length);
      expect(parsed1.graph.edges.length).toEqual(parsed2.graph.edges.length);

      for (let i = 0; i < parsed1.graph.nodes.length; i++) {
        expect(parsed1.graph.nodes[i].id).toEqual(parsed2.graph.nodes[i].id);
        expect(parsed1.graph.nodes[i].type).toEqual(parsed2.graph.nodes[i].type);
        expect(parsed1.graph.nodes[i].position).toEqual(parsed2.graph.nodes[i].position);
      }

      for (let i = 0; i < parsed1.graph.edges.length; i++) {
        expect(parsed1.graph.edges[i].id).toEqual(parsed2.graph.edges[i].id);
        expect(parsed1.graph.edges[i].source).toEqual(parsed2.graph.edges[i].source);
        expect(parsed1.graph.edges[i].target).toEqual(parsed2.graph.edges[i].target);
      }
    });

    it('should maintain node data consistency through round-trip', () => {
      const json = workflowToJson(mockNodes, mockEdges);
      const result = jsonToWorkflow(json);

      expect(result.success).toBe(true);

      const originalLlm = mockNodes.find((n) => n.type === 'llm');
      const roundTripLlm = result.nodes.find((n) => n.type === 'llm');

      expect(originalLlm?.data.llmConfig?.model).toEqual(roundTripLlm?.data.llmConfig?.model);
      expect(originalLlm?.data.llmConfig?.temperature).toEqual(roundTripLlm?.data.llmConfig?.temperature);
    });
  });

  describe('validateJson', () => {
    it('should return valid for valid JSON', () => {
      const json = workflowToJson(mockNodes, mockEdges);
      const result = validateJson(json);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return invalid for invalid JSON', () => {
      const result = validateJson('not valid json');

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
