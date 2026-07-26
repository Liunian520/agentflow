import { describe, it, expect, vi } from 'vitest';
import type { FlowNode, FlowEdge } from '../../types';
import {
  buildAdjacencyList,
  buildReverseAdjacencyList,
  findStartNodeId,
  findEndNodeIds,
  hasCycle,
  topoSort,
  compileWorkflow,
  WorkflowEngine,
} from '../workflowEngine';

function makeNode(id: string, type: string, extra: Partial<FlowNode> = {}): FlowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {
      label: type,
      type,
      description: '',
      iconName: 'Box',
    },
    ...extra,
  } as FlowNode;
}

function makeEdge(source: string, target: string, label?: string): FlowEdge {
  return {
    id: `edge-${source}-${target}${label ? `-${label}` : ''}`,
    source,
    target,
    label,
  } as FlowEdge;
}

describe('workflowEngine - utilities', () => {
  describe('buildAdjacencyList', () => {
    it('should build correct adjacency list for simple chain', () => {
      const nodes = [makeNode('a', 'start'), makeNode('b', 'llm'), makeNode('c', 'end')];
      const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
      const adj = buildAdjacencyList(nodes, edges);
      expect(adj.a).toEqual(['b']);
      expect(adj.b).toEqual(['c']);
      expect(adj.c).toEqual([]);
    });

    it('should handle nodes with multiple outgoing edges', () => {
      const nodes = [makeNode('a', 'condition'), makeNode('b', 'llm'), makeNode('c', 'llm')];
      const edges = [makeEdge('a', 'b', 'true'), makeEdge('a', 'c', 'false')];
      const adj = buildAdjacencyList(nodes, edges);
      expect(adj.a).toEqual(['b', 'c']);
      expect(adj.b).toEqual([]);
      expect(adj.c).toEqual([]);
    });
  });

  describe('buildReverseAdjacencyList', () => {
    it('should build reverse adjacency list', () => {
      const nodes = [makeNode('a', 'start'), makeNode('b', 'llm'), makeNode('c', 'end')];
      const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
      const adj = buildReverseAdjacencyList(nodes, edges);
      expect(adj.a).toEqual([]);
      expect(adj.b).toEqual(['a']);
      expect(adj.c).toEqual(['b']);
    });
  });

  describe('findStartNodeId', () => {
    it('should find start node', () => {
      const nodes = [makeNode('a', 'start'), makeNode('b', 'llm')];
      expect(findStartNodeId(nodes)).toBe('a');
    });

    it('should return null if no start node', () => {
      const nodes = [makeNode('a', 'llm'), makeNode('b', 'end')];
      expect(findStartNodeId(nodes)).toBeNull();
    });
  });

  describe('findEndNodeIds', () => {
    it('should find end nodes', () => {
      const nodes = [makeNode('a', 'start'), makeNode('b', 'end'), makeNode('c', 'end')];
      expect(findEndNodeIds(nodes)).toEqual(['b', 'c']);
    });

    it('should return empty array if no end nodes', () => {
      const nodes = [makeNode('a', 'start'), makeNode('b', 'llm')];
      expect(findEndNodeIds(nodes)).toEqual([]);
    });
  });
});

describe('workflowEngine - hasCycle', () => {
  it('should return no cycle for simple chain', () => {
    const nodes = [makeNode('a', 'start'), makeNode('b', 'llm'), makeNode('c', 'end')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    const result = hasCycle(nodes, edges);
    expect(result.hasCycle).toBe(false);
  });

  it('should detect simple cycle A->B->C->A', () => {
    const nodes = [makeNode('a', 'start'), makeNode('b', 'llm'), makeNode('c', 'condition')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'a')];
    const result = hasCycle(nodes, edges);
    expect(result.hasCycle).toBe(true);
    expect(result.cyclePath).toBeDefined();
    expect(result.cyclePath!.length).toBeGreaterThan(0);
  });

  it('should detect self-loop', () => {
    const nodes = [makeNode('a', 'start')];
    const edges = [makeEdge('a', 'a')];
    const result = hasCycle(nodes, edges);
    expect(result.hasCycle).toBe(true);
  });

  it('should handle diamond pattern without cycle', () => {
    const nodes = [
      makeNode('a', 'start'),
      makeNode('b', 'llm'),
      makeNode('c', 'llm'),
      makeNode('d', 'end'),
    ];
    const edges = [makeEdge('a', 'b'), makeEdge('a', 'c'), makeEdge('b', 'd'), makeEdge('c', 'd')];
    const result = hasCycle(nodes, edges);
    expect(result.hasCycle).toBe(false);
  });
});

describe('workflowEngine - topoSort', () => {
  it('should sort simple chain correctly', () => {
    const nodes = [makeNode('a', 'start'), makeNode('b', 'llm'), makeNode('c', 'end')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    const result = topoSort(nodes, edges);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('should handle independent nodes', () => {
    const nodes = [makeNode('a', 'start'), makeNode('b', 'llm'), makeNode('c', 'llm')];
    const edges: FlowEdge[] = [];
    const result = topoSort(nodes, edges);
    expect(result).toHaveLength(3);
    expect(new Set(result)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('should handle diamond pattern', () => {
    const nodes = [
      makeNode('a', 'start'),
      makeNode('b', 'llm'),
      makeNode('c', 'llm'),
      makeNode('d', 'end'),
    ];
    const edges = [makeEdge('a', 'b'), makeEdge('a', 'c'), makeEdge('b', 'd'), makeEdge('c', 'd')];
    const result = topoSort(nodes, edges);
    expect(result.indexOf('a')).toBeLessThan(result.indexOf('b'));
    expect(result.indexOf('a')).toBeLessThan(result.indexOf('c'));
    expect(result.indexOf('b')).toBeLessThan(result.indexOf('d'));
    expect(result.indexOf('c')).toBeLessThan(result.indexOf('d'));
  });

  it('should include all nodes even with cycle (partial sort)', () => {
    const nodes = [makeNode('a', 'start'), makeNode('b', 'llm'), makeNode('c', 'condition')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'a')];
    const result = topoSort(nodes, edges);
    expect(result).toHaveLength(3);
  });
});

describe('workflowEngine - compileWorkflow', () => {
  it('should compile a valid workflow', () => {
    const nodes = [makeNode('a', 'start'), makeNode('b', 'llm'), makeNode('c', 'end')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    const plan = compileWorkflow(nodes, edges);
    expect(plan.nodes).toHaveLength(3);
    expect(plan.edges).toHaveLength(2);
    expect(plan.startNodeId).toBe('a');
    expect(plan.endNodeIds).toEqual(['c']);
    expect(plan.hasCycle).toBe(false);
    expect(plan.sortedNodeIds).toEqual(['a', 'b', 'c']);
    expect(plan.adjacencyList).toBeDefined();
    expect(plan.reverseAdjacencyList).toBeDefined();
  });

  it('should detect cycle during compilation', () => {
    const nodes = [makeNode('a', 'start'), makeNode('b', 'llm')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'a')];
    const plan = compileWorkflow(nodes, edges);
    expect(plan.hasCycle).toBe(true);
    expect(plan.cyclePath).toBeDefined();
  });
});

describe('workflowEngine - WorkflowEngine', () => {
  describe('basic execution', () => {
    it('should execute start -> end simple workflow', async () => {
      const nodes = [
        makeNode('start1', 'start'),
        makeNode('end1', 'end', {
          data: {
            label: 'End',
            type: 'end',
            endConfig: {
              outputs: [{ id: 'o1', name: 'result', type: 'string', value: '{{greeting}}' }],
            },
          } as any,
        }),
      ];
      const edges = [makeEdge('start1', 'end1')];
      const plan = compileWorkflow(nodes, edges);
      const engine = new WorkflowEngine(plan);

      const result = await engine.execute({ greeting: 'Hello' });
      expect(result.status).toBe('completed');
      expect(result.completedNodeIds).toEqual(['start1', 'end1']);
      expect(result.variables.result).toBe('Hello');
      expect(result.steps).toHaveLength(2);
    });

    it('should fail if workflow has cycle', async () => {
      const nodes = [makeNode('a', 'start'), makeNode('b', 'llm')];
      const edges = [makeEdge('a', 'b'), makeEdge('b', 'a')];
      const plan = compileWorkflow(nodes, edges);
      const engine = new WorkflowEngine(plan);

      await expect(engine.execute({})).rejects.toThrow('环路');
    });

    it('should initialize variables from start node config', async () => {
      const startNode = makeNode('start1', 'start', {
        data: {
          label: 'Start',
          type: 'start',
          startConfig: {
            inputs: [
              { id: 'i1', name: 'name', type: 'string', required: true, default: 'World' },
              { id: 'i2', name: 'count', type: 'number', required: false, default: 42 },
            ],
          },
        } as any,
      });
      const endNode = makeNode('end1', 'end');
      const nodes = [startNode, endNode];
      const edges = [makeEdge('start1', 'end1')];
      const plan = compileWorkflow(nodes, edges);
      const engine = new WorkflowEngine(plan);

      const result = await engine.execute({ name: 'Alice' });
      expect(result.status).toBe('completed');
      expect(result.variables.name).toBe('Alice');
      expect(result.variables.count).toBe(42);
    });
  });

  describe('LLM node', () => {
    it('should execute LLM node with custom executor', async () => {
      const mockLLM = vi.fn().mockResolvedValue('Mock LLM response');
      const nodes = [
        makeNode('start1', 'start'),
        makeNode('llm1', 'llm', {
          data: {
            label: 'LLM',
            type: 'llm',
            llmConfig: {
              outputVariable: 'llm_result',
              userPrompt: 'Say hello',
            },
          } as any,
        }),
        makeNode('end1', 'end'),
      ];
      const edges = [makeEdge('start1', 'llm1'), makeEdge('llm1', 'end1')];
      const plan = compileWorkflow(nodes, edges);
      const engine = new WorkflowEngine(plan, { llmExecutor: mockLLM });

      const result = await engine.execute({});
      expect(result.status).toBe('completed');
      expect(mockLLM).toHaveBeenCalled();
      expect(result.variables.llm_result).toBe('Mock LLM response');
    });

    it('should handle LLM executor failure', async () => {
      const mockLLM = vi.fn().mockRejectedValue(new Error('API key invalid'));
      const nodes = [
        makeNode('start1', 'start'),
        makeNode('llm1', 'llm', {
          data: {
            label: 'LLM',
            type: 'llm',
            llmConfig: { outputVariable: 'llm_result' },
          } as any,
        }),
        makeNode('end1', 'end'),
      ];
      const edges = [makeEdge('start1', 'llm1'), makeEdge('llm1', 'end1')];
      const plan = compileWorkflow(nodes, edges);
      const engine = new WorkflowEngine(plan, { llmExecutor: mockLLM });

      const result = await engine.execute({});
      expect(result.status).toBe('failed');
      expect(result.error).toContain('API key invalid');
      expect(result.failedNodeIds).toContain('llm1');
    });
  });

  describe('condition node', () => {
    it('should take true branch when condition matches', async () => {
      const nodes = [
        makeNode('start1', 'start'),
        makeNode('cond1', 'condition', {
          data: {
            label: 'Condition',
            type: 'condition',
            conditionConfig: {
              conditions: [
                { id: 'c1', label: 'positive', expression: '{{score}} > 50' },
                { id: 'c2', label: 'negative', expression: '{{score}} <= 50' },
              ],
              defaultLabel: 'default',
            },
          } as any,
        }),
        makeNode('positive_node', 'end', { data: { label: 'Positive', type: 'end' } as any }),
        makeNode('negative_node', 'end', { data: { label: 'Negative', type: 'end' } as any }),
      ];
      const edges = [
        makeEdge('start1', 'cond1'),
        makeEdge('cond1', 'positive_node', 'positive'),
        makeEdge('cond1', 'negative_node', 'negative'),
      ];
      const plan = compileWorkflow(nodes, edges);
      const engine = new WorkflowEngine(plan);

      const result = await engine.execute({ score: 80 });
      expect(result.status).toBe('completed');
      expect(result.completedNodeIds).toContain('positive_node');
      expect(result.completedNodeIds).not.toContain('negative_node');
    });

    it('should take default branch when no condition matches', async () => {
      const nodes = [
        makeNode('start1', 'start'),
        makeNode('cond1', 'condition', {
          data: {
            label: 'Condition',
            type: 'condition',
            conditionConfig: {
              conditions: [{ id: 'c1', label: 'positive', expression: '{{score}} > 100' }],
              defaultLabel: 'default',
            },
          } as any,
        }),
        makeNode('default_node', 'end', { data: { label: 'Default', type: 'end' } as any }),
      ];
      const edges = [makeEdge('start1', 'cond1'), makeEdge('cond1', 'default_node', 'default')];
      const plan = compileWorkflow(nodes, edges);
      const engine = new WorkflowEngine(plan);

      const result = await engine.execute({ score: 50 });
      expect(result.status).toBe('completed');
      expect(result.completedNodeIds).toContain('default_node');
    });
  });

  describe('code node', () => {
    it('should execute javascript code', async () => {
      const nodes = [
        makeNode('start1', 'start'),
        makeNode('code1', 'code', {
          data: {
            label: 'Code',
            type: 'code',
            codeConfig: {
              language: 'javascript',
              code: 'var __result = a + b;',
              inputVariables: ['a', 'b'],
              outputVariable: 'sum',
              timeout: 5000,
            },
          } as any,
        }),
        makeNode('end1', 'end'),
      ];
      const edges = [makeEdge('start1', 'code1'), makeEdge('code1', 'end1')];
      const plan = compileWorkflow(nodes, edges);
      const engine = new WorkflowEngine(plan);

      const result = await engine.execute({ a: 3, b: 7 });
      expect(result.status).toBe('completed');
      expect(result.variables.sum).toBe(10);
    });

    it('should handle code execution error', async () => {
      const nodes = [
        makeNode('start1', 'start'),
        makeNode('code1', 'code', {
          data: {
            label: 'Code',
            type: 'code',
            codeConfig: {
              language: 'javascript',
              code: 'throw new Error("oops");',
              outputVariable: 'result',
              timeout: 5000,
            },
          } as any,
        }),
        makeNode('end1', 'end'),
      ];
      const edges = [makeEdge('start1', 'code1'), makeEdge('code1', 'end1')];
      const plan = compileWorkflow(nodes, edges);
      const engine = new WorkflowEngine(plan);

      const result = await engine.execute({});
      expect(result.status).toBe('failed');
      expect(result.error).toContain('oops');
    });
  });

  describe('variable node', () => {
    it('should set variable', async () => {
      const nodes = [
        makeNode('start1', 'start'),
        makeNode('var1', 'variable', {
          data: {
            label: 'Set Var',
            type: 'variable',
            variableConfig: {
              operation: 'set',
              variableName: 'count',
              value: '42',
              valueType: 'number',
            },
          } as any,
        }),
        makeNode('end1', 'end'),
      ];
      const edges = [makeEdge('start1', 'var1'), makeEdge('var1', 'end1')];
      const plan = compileWorkflow(nodes, edges);
      const engine = new WorkflowEngine(plan);

      const result = await engine.execute({});
      expect(result.status).toBe('completed');
      expect(result.variables.count).toBe(42);
    });

    it('should increment variable', async () => {
      const nodes = [
        makeNode('start1', 'start'),
        makeNode('var1', 'variable', {
          data: {
            label: 'Increment',
            type: 'variable',
            variableConfig: {
              operation: 'increment',
              variableName: 'counter',
              value: '1',
              valueType: 'number',
            },
          } as any,
        }),
        makeNode('end1', 'end'),
      ];
      const edges = [makeEdge('start1', 'var1'), makeEdge('var1', 'end1')];
      const plan = compileWorkflow(nodes, edges);
      const engine = new WorkflowEngine(plan);

      const result = await engine.execute({ counter: 10 });
      expect(result.status).toBe('completed');
      expect(result.variables.counter).toBe(11);
    });
  });

  describe('HTTP node', () => {
    it('should execute HTTP with custom executor', async () => {
      const mockHttp = vi.fn().mockResolvedValue({
        status: 200,
        data: { message: 'ok' },
        headers: { 'content-type': 'application/json' },
      });
      const nodes = [
        makeNode('start1', 'start'),
        makeNode('http1', 'http', {
          data: {
            label: 'HTTP',
            type: 'http',
            httpConfig: {
              method: 'GET',
              url: 'https://api.example.com/data',
              headers: {},
              body: '',
              bodyType: 'none',
              outputVariable: 'api_result',
              timeout: 5000,
            },
          } as any,
        }),
        makeNode('end1', 'end'),
      ];
      const edges = [makeEdge('start1', 'http1'), makeEdge('http1', 'end1')];
      const plan = compileWorkflow(nodes, edges);
      const engine = new WorkflowEngine(plan, { httpExecutor: mockHttp });

      const result = await engine.execute({});
      expect(result.status).toBe('completed');
      expect(mockHttp).toHaveBeenCalled();
      expect(result.variables.api_result.status).toBe(200);
      expect(result.variables.api_result.data.message).toBe('ok');
    });
  });

  describe('event system', () => {
    it('should emit node:start and node:complete events', async () => {
      const nodes = [makeNode('start1', 'start'), makeNode('end1', 'end')];
      const edges = [makeEdge('start1', 'end1')];
      const plan = compileWorkflow(nodes, edges);
      const engine = new WorkflowEngine(plan);

      const nodeStartEvents: any[] = [];
      const nodeCompleteEvents: any[] = [];

      engine.on('node:start', (data) => nodeStartEvents.push(data));
      engine.on('node:complete', (data) => nodeCompleteEvents.push(data));

      await engine.execute({});

      expect(nodeStartEvents.length).toBe(2);
      expect(nodeCompleteEvents.length).toBe(2);
      expect(nodeStartEvents[0].nodeId).toBe('start1');
      expect(nodeCompleteEvents[0].nodeId).toBe('start1');
    });

    it('should emit workflow:start and workflow:complete events', async () => {
      const nodes = [makeNode('start1', 'start'), makeNode('end1', 'end')];
      const edges = [makeEdge('start1', 'end1')];
      const plan = compileWorkflow(nodes, edges);
      const engine = new WorkflowEngine(plan);

      let workflowStarted = false;
      let workflowCompleted = false;

      engine.on('workflow:start', () => {
        workflowStarted = true;
      });
      engine.on('workflow:complete', () => {
        workflowCompleted = true;
      });

      await engine.execute({});

      expect(workflowStarted).toBe(true);
      expect(workflowCompleted).toBe(true);
    });

    it('should emit node:error and workflow:error on failure', async () => {
      const nodes = [
        makeNode('start1', 'start'),
        makeNode('code1', 'code', {
          data: {
            label: 'Code',
            type: 'code',
            codeConfig: {
              language: 'javascript',
              code: 'throw new Error("fail");',
              outputVariable: 'result',
              timeout: 5000,
            },
          } as any,
        }),
        makeNode('end1', 'end'),
      ];
      const edges = [makeEdge('start1', 'code1'), makeEdge('code1', 'end1')];
      const plan = compileWorkflow(nodes, edges);
      const engine = new WorkflowEngine(plan);

      let nodeErrorFired = false;
      let workflowErrorFired = false;

      engine.on('node:error', () => {
        nodeErrorFired = true;
      });
      engine.on('workflow:error', () => {
        workflowErrorFired = true;
      });

      await engine.execute({});

      expect(nodeErrorFired).toBe(true);
      expect(workflowErrorFired).toBe(true);
    });
  });

  describe('step forward mode', () => {
    it('should execute step by step', async () => {
      const nodes = [makeNode('start1', 'start'), makeNode('llm1', 'llm', {
        data: {
          label: 'LLM',
          type: 'llm',
          llmConfig: { outputVariable: 'result', userPrompt: 'hi' },
        } as any,
      }), makeNode('end1', 'end')];
      const edges = [makeEdge('start1', 'llm1'), makeEdge('llm1', 'end1')];
      const plan = compileWorkflow(nodes, edges);
      const mockLLM = vi.fn().mockResolvedValue('hi');
      const engine = new WorkflowEngine(plan, { llmExecutor: mockLLM });

      let state = engine.getState();
      expect(state.status).toBe('idle');

      state = await engine.stepForward();
      expect(state.currentStepIndex).toBe(0);
      expect(state.completedNodeIds).toEqual(['start1']);
      expect(state.status).toBe('running');

      state = await engine.stepForward();
      expect(state.currentStepIndex).toBe(1);
      expect(state.completedNodeIds).toEqual(['start1', 'llm1']);

      state = await engine.stepForward();
      expect(state.currentStepIndex).toBe(2);
      expect(state.status).toBe('completed');
    });
  });

  describe('reset', () => {
    it('should reset state to idle', async () => {
      const nodes = [makeNode('start1', 'start'), makeNode('end1', 'end')];
      const edges = [makeEdge('start1', 'end1')];
      const plan = compileWorkflow(nodes, edges);
      const engine = new WorkflowEngine(plan);

      await engine.execute({ test: 123 });
      expect(engine.getState().status).toBe('completed');

      engine.reset();
      const state = engine.getState();
      expect(state.status).toBe('idle');
      expect(state.completedNodeIds).toEqual([]);
      expect(state.variables).toEqual({});
      expect(state.steps).toEqual([]);
    });
  });

  describe('max iterations', () => {
    it('should stop after max iterations', async () => {
      const nodes = [
        makeNode('start1', 'start'),
        makeNode('llm1', 'llm', {
          data: {
            label: 'LLM',
            type: 'llm',
            llmConfig: { outputVariable: 'result', userPrompt: 'x' },
          } as any,
        }),
      ];
      const edges = [makeEdge('start1', 'llm1'), makeEdge('llm1', 'start1')];
      const plan = compileWorkflow(nodes, edges);
      plan.hasCycle = false;
      plan.cyclePath = undefined;
      const mockLLM = vi.fn().mockResolvedValue('x');
      const engine = new WorkflowEngine(plan, { llmExecutor: mockLLM, maxIterations: 5 });

      const result = await engine.execute({});
      expect(result.status).toBe('failed');
      expect(result.error).toContain('最大迭代次数');
    });
  });
});
