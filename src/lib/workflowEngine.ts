import type {
  FlowNode,
  FlowEdge,
  ExecutionPlan,
  WorkflowEngineState,
  WorkflowEngineOptions,
  WorkflowEngineEventName,
  NodeExecutionResult,
  ExecutionStep,
  EventCallback,
  LLMExecutorFunction,
  HttpExecutorFunction,
  MCPToolExecutorFunction,
} from '../types';
import { getNodeExecutor } from './workflowExecutors';
import type { MemoryService } from './memory/memoryService';
import type { WorkflowTracer } from './workflowTracer';

export function buildAdjacencyList(nodes: FlowNode[], edges: FlowEdge[]): Record<string, string[]> {
  const adj: Record<string, string[]> = {};
  for (const node of nodes) {
    adj[node.id] = [];
  }
  for (const edge of edges) {
    if (adj[edge.source]) {
      adj[edge.source].push(edge.target);
    }
  }
  return adj;
}

export function buildReverseAdjacencyList(nodes: FlowNode[], edges: FlowEdge[]): Record<string, string[]> {
  const adj: Record<string, string[]> = {};
  for (const node of nodes) {
    adj[node.id] = [];
  }
  for (const edge of edges) {
    if (adj[edge.target]) {
      adj[edge.target].push(edge.source);
    }
  }
  return adj;
}

export function findStartNodeId(nodes: FlowNode[]): string | null {
  const startNode = nodes.find((n) => n.data?.type === 'start' || n.type === 'start');
  return startNode ? startNode.id : null;
}

export function findEndNodeIds(nodes: FlowNode[]): string[] {
  return nodes.filter((n) => n.data?.type === 'end' || n.type === 'end').map((n) => n.id);
}

export function hasCycle(nodes: FlowNode[], edges: FlowEdge[]): { hasCycle: boolean; cyclePath?: string[] } {
  const adj = buildAdjacencyList(nodes, edges);
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string): { found: boolean; cycle?: string[] } {
    visited.add(nodeId);
    recStack.add(nodeId);
    path.push(nodeId);

    const neighbors = adj[nodeId] || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        const result = dfs(neighbor);
        if (result.found) {
          return result;
        }
      } else if (recStack.has(neighbor)) {
        const cycleStartIdx = path.indexOf(neighbor);
        const cyclePath = path.slice(cycleStartIdx).concat(neighbor);
        return { found: true, cycle: cyclePath };
      }
    }

    path.pop();
    recStack.delete(nodeId);
    return { found: false };
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      const result = dfs(node.id);
      if (result.found) {
        return { hasCycle: true, cyclePath: result.cycle };
      }
    }
  }

  return { hasCycle: false };
}

export function topoSort(nodes: FlowNode[], edges: FlowEdge[]): string[] {
  const adj = buildAdjacencyList(nodes, edges);
  const inDegree: Record<string, number> = {};
  const result: string[] = [];

  for (const node of nodes) {
    inDegree[node.id] = 0;
  }
  for (const edge of edges) {
    if (inDegree[edge.target] !== undefined) {
      inDegree[edge.target]++;
    }
  }

  const queue: string[] = [];
  for (const node of nodes) {
    if (inDegree[node.id] === 0) {
      queue.push(node.id);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    const neighbors = adj[current] || [];
    for (const neighbor of neighbors) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (result.length !== nodes.length) {
    const remaining = nodes.filter((n) => !result.includes(n.id)).map((n) => n.id);
    return [...result, ...remaining];
  }

  return result;
}

export function compileWorkflow(nodes: FlowNode[], edges: FlowEdge[]): ExecutionPlan {
  const cycleResult = hasCycle(nodes, edges);
  const sortedNodeIds = topoSort(nodes, edges);
  const adjacencyList = buildAdjacencyList(nodes, edges);
  const reverseAdjacencyList = buildReverseAdjacencyList(nodes, edges);

  return {
    nodes,
    edges,
    sortedNodeIds,
    startNodeId: findStartNodeId(nodes),
    endNodeIds: findEndNodeIds(nodes),
    adjacencyList,
    reverseAdjacencyList,
    hasCycle: cycleResult.hasCycle,
    cyclePath: cycleResult.cyclePath,
  };
}

type EventListenerMap = Record<string, Set<EventCallback>>;

export class WorkflowEngine {
  private plan: ExecutionPlan;
  private options: WorkflowEngineOptions & { maxIterations: number; enableStepMode: boolean };
  private state: WorkflowEngineState;
  private listeners: EventListenerMap = {};
  private isPaused = false;
  private pausePromise: Promise<void> | null = null;
  private resolvePause: (() => void) | null = null;
  private nodeMap: Record<string, FlowNode> = {};
  private memoryService?: MemoryService;
  private onAgentThought?: (step: any) => void;
  private onAgentToolCall?: (toolCall: any) => void;
  private onAgentToolResult?: (toolCallId: string, result: any) => void;
  private tracer?: WorkflowTracer;

  constructor(
    plan: ExecutionPlan,
    options: WorkflowEngineOptions & {
      memoryService?: MemoryService;
      onAgentThought?: (step: any) => void;
      onAgentToolCall?: (toolCall: any) => void;
      onAgentToolResult?: (toolCallId: string, result: any) => void;
      tracer?: WorkflowTracer;
    } = {}
  ) {
    this.plan = plan;
    this.options = {
      maxIterations: options.maxIterations ?? 1000,
      enableStepMode: options.enableStepMode ?? false,
      llmExecutor: options.llmExecutor,
      httpExecutor: options.httpExecutor,
      mcpToolExecutor: options.mcpToolExecutor,
    };
    this.memoryService = options.memoryService;
    this.onAgentThought = options.onAgentThought;
    this.onAgentToolCall = options.onAgentToolCall;
    this.onAgentToolResult = options.onAgentToolResult;
    this.tracer = options.tracer;

    for (const node of plan.nodes) {
      this.nodeMap[node.id] = node;
    }

    this.state = this.createInitialState();
  }

  getTracer(): WorkflowTracer | undefined {
    return this.tracer;
  }

  private createInitialState(): WorkflowEngineState {
    return {
      status: 'idle',
      currentNodeId: null,
      completedNodeIds: [],
      failedNodeIds: [],
      variables: {},
      nodeOutputs: {},
      steps: [],
      currentStepIndex: 0,
      startTime: null,
      endTime: null,
      totalDuration: null,
    };
  }

  on(event: WorkflowEngineEventName, callback: EventCallback): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set();
    }
    this.listeners[event].add(callback);
    return () => {
      this.listeners[event]?.delete(callback);
    };
  }

  private async emit(event: WorkflowEngineEventName, data: any): Promise<void> {
    const callbacks = this.listeners[event];
    if (!callbacks) return;
    for (const cb of callbacks) {
      try {
        await cb(data);
      } catch {
        // 忽略监听器错误
      }
    }
  }

  getState(): WorkflowEngineState {
    return { ...this.state };
  }

  getPlan(): ExecutionPlan {
    return this.plan;
  }

  reset(): void {
    this.state = this.createInitialState();
    this.isPaused = false;
    this.pausePromise = null;
    this.resolvePause = null;
    if (this.tracer) {
      this.tracer.reset();
    }
  }

  pause(): void {
    if (this.state.status !== 'running') return;
    this.isPaused = true;
    this.state.status = 'paused';
    this.pausePromise = new Promise((resolve) => {
      this.resolvePause = resolve;
    });
    this.emit('workflow:paused', { state: this.getState() });
  }

  resume(): void {
    if (this.state.status !== 'paused') return;
    this.isPaused = false;
    this.state.status = 'running';
    if (this.resolvePause) {
      this.resolvePause();
      this.resolvePause = null;
      this.pausePromise = null;
    }
    this.emit('workflow:resumed', { state: this.getState() });
  }

  private async checkPause(): Promise<void> {
    if (this.isPaused && this.pausePromise) {
      await this.pausePromise;
    }
  }

  private getNextNodeId(currentNodeId: string | null, result?: NodeExecutionResult): string | null {
    if (!currentNodeId) {
      return this.plan.startNodeId;
    }

    const currentNode = this.nodeMap[currentNodeId];
    if (!currentNode) return null;

    const nodeType = currentNode.data?.type || currentNode.type;

    const outgoingEdges = this.plan.edges.filter((e) => e.source === currentNodeId);

    if (outgoingEdges.length === 0) {
      return null;
    }

    if (nodeType === 'condition' && result?.output?.matchedLabel) {
      const matchedLabel = result.output.matchedLabel;
      const matchedEdge = outgoingEdges.find(
        (e) => e.label === matchedLabel || e.sourceHandle === matchedLabel
      );
      if (matchedEdge) {
        return matchedEdge.target;
      }
    }

    const defaultEdge = outgoingEdges.find((e) => !e.label || e.label === 'default' || e.sourceHandle === 'default');
    if (defaultEdge) {
      return defaultEdge.target;
    }

    return outgoingEdges[0].target;
  }

  async execute(input: Record<string, any> = {}): Promise<WorkflowEngineState> {
    if (this.state.status === 'running') {
      throw new Error('工作流已经在运行中');
    }

    if (this.plan.hasCycle) {
      throw new Error(`工作流存在环路，无法执行: ${this.plan.cyclePath?.join(' → ')}`);
    }

    this.reset();
    this.state.variables = { ...input };
    this.state.status = 'running';
    this.state.startTime = Date.now();

    if (this.tracer) {
      this.tracer.startSpan('Workflow Execution', 'workflow', input, {
        nodeCount: this.plan.nodes.length,
        edgeCount: this.plan.edges.length,
      });
    }

    await this.emit('workflow:start', {
      input,
      state: this.getState(),
    });

    let currentNodeId: string | null = this.plan.startNodeId;
    let iterations = 0;

    try {
      while (currentNodeId !== null) {
        iterations++;
        if (iterations > this.options.maxIterations) {
          throw new Error(`超过最大迭代次数 (${this.options.maxIterations})，可能存在死循环`);
        }

        await this.checkPause();
        if (this.state.status !== 'running' && !this.isPaused) {
          break;
        }

        const node = this.nodeMap[currentNodeId];
        if (!node) {
          throw new Error(`节点不存在: ${currentNodeId}`);
        }

        this.state.currentNodeId = currentNodeId;

        const result = await this.executeNode(node);

        const step: ExecutionStep = {
          stepIndex: this.state.steps.length,
          nodeId: currentNodeId,
          result,
        };
        this.state.steps.push(step);
        this.state.currentStepIndex = step.stepIndex;

        if (result.success) {
          this.state.completedNodeIds.push(currentNodeId);
          if (result.output) {
            this.state.nodeOutputs[currentNodeId] = result.output;
            for (const [key, value] of Object.entries(result.output)) {
              this.state.variables[key] = value;
            }
          }
        } else {
          this.state.failedNodeIds.push(currentNodeId);
          throw new Error(result.error || `节点执行失败: ${node.data?.label || currentNodeId}`);
        }

        const nodeType = node.data?.type || node.type;
        if (nodeType === 'end') {
          break;
        }

        currentNodeId = this.getNextNodeId(currentNodeId, result);
      }

      this.state.status = 'completed';
      this.state.endTime = Date.now();
      this.state.totalDuration = this.state.endTime - this.state.startTime;

      if (this.tracer) {
        this.tracer.endActiveSpan(this.state.variables);
      }

      await this.emit('workflow:complete', {
        state: this.getState(),
        output: this.state.variables,
      });
    } catch (err: any) {
      this.state.status = 'failed';
      this.state.error = err?.message || '未知错误';
      this.state.endTime = Date.now();
      this.state.totalDuration = this.state.endTime - (this.state.startTime || 0);

      if (this.tracer) {
        this.tracer.endActiveSpan(undefined, this.state.error);
      }

      await this.emit('workflow:error', {
        error: this.state.error,
        state: this.getState(),
      });
    }

    return this.getState();
  }

  async stepForward(): Promise<WorkflowEngineState> {
    if (this.state.status === 'completed' || this.state.status === 'failed') {
      return this.getState();
    }

    if (this.state.status === 'idle') {
      this.state.status = 'running';
      this.state.startTime = Date.now();
      await this.emit('workflow:start', { state: this.getState() });
    }

    if (this.plan.hasCycle) {
      this.state.status = 'failed';
      this.state.error = `工作流存在环路: ${this.plan.cyclePath?.join(' → ')}`;
      return this.getState();
    }

    let currentNodeId: string | null;

    if (this.state.steps.length === 0) {
      currentNodeId = this.plan.startNodeId;
    } else {
      const lastStep = this.state.steps[this.state.steps.length - 1];
      const lastNode = this.nodeMap[lastStep.nodeId];
      const lastNodeType = lastNode?.data?.type || lastNode?.type;

      if (lastNodeType === 'end') {
        this.state.status = 'completed';
        this.state.endTime = Date.now();
        this.state.totalDuration = this.state.endTime - (this.state.startTime || 0);
        await this.emit('workflow:complete', { state: this.getState() });
        return this.getState();
      }

      if (!lastStep.result.success) {
        this.state.status = 'failed';
        this.state.error = lastStep.result.error || '节点执行失败';
        this.state.endTime = Date.now();
        await this.emit('workflow:error', { error: this.state.error, state: this.getState() });
        return this.getState();
      }

      currentNodeId = this.getNextNodeId(lastStep.nodeId, lastStep.result);
    }

    if (currentNodeId === null) {
      this.state.status = 'completed';
      this.state.endTime = Date.now();
      this.state.totalDuration = this.state.endTime - (this.state.startTime || 0);
      await this.emit('workflow:complete', { state: this.getState() });
      return this.getState();
    }

    const node = this.nodeMap[currentNodeId];
    if (!node) {
      this.state.status = 'failed';
      this.state.error = `节点不存在: ${currentNodeId}`;
      return this.getState();
    }

    this.state.currentNodeId = currentNodeId;

    const result = await this.executeNode(node);

    const step: ExecutionStep = {
      stepIndex: this.state.steps.length,
      nodeId: currentNodeId,
      result,
    };
    this.state.steps.push(step);
    this.state.currentStepIndex = step.stepIndex;

    if (result.success) {
      this.state.completedNodeIds.push(currentNodeId);
      if (result.output) {
        this.state.nodeOutputs[currentNodeId] = result.output;
        for (const [key, value] of Object.entries(result.output)) {
          this.state.variables[key] = value;
        }
      }
    } else {
      this.state.failedNodeIds.push(currentNodeId);
      this.state.status = 'failed';
      this.state.error = result.error || `节点执行失败: ${node.data?.label || currentNodeId}`;
      this.state.endTime = Date.now();
      await this.emit('workflow:error', { error: this.state.error, state: this.getState() });
    }

    const nodeType = node.data?.type || node.type;
    if (nodeType === 'end' && result.success) {
      this.state.status = 'completed';
      this.state.endTime = Date.now();
      this.state.totalDuration = this.state.endTime - (this.state.startTime || 0);
      await this.emit('workflow:complete', { state: this.getState() });
    }

    return this.getState();
  }

  private async executeNode(node: FlowNode): Promise<NodeExecutionResult> {
    const nodeType = node.data?.type || node.type;
    const nodeName = node.data?.label || node.id;

    if (this.tracer) {
      this.tracer.startSpan(nodeName, 'node', undefined, {
        nodeId: node.id,
        nodeType,
      });
    }

    await this.emit('node:start', {
      nodeId: node.id,
      nodeName,
      nodeType,
      state: this.getState(),
    });

    const executor = getNodeExecutor(nodeType);

    try {
      const result = await executor(node, {
        variables: this.state.variables,
        nodeOutputs: this.state.nodeOutputs,
        llmExecutor: this.options.llmExecutor as LLMExecutorFunction,
        httpExecutor: this.options.httpExecutor as HttpExecutorFunction,
        mcpToolExecutor: this.options.mcpToolExecutor as MCPToolExecutorFunction,
        memoryService: this.memoryService,
        onAgentThought: this.onAgentThought,
        onAgentToolCall: this.onAgentToolCall,
        onAgentToolResult: this.onAgentToolResult,
        tracer: this.tracer,
      });

      if (this.tracer) {
        this.tracer.endActiveSpan(result.output, result.error);
      }

      if (result.success) {
        await this.emit('node:complete', {
          nodeId: node.id,
          result,
          state: this.getState(),
        });
      } else {
        await this.emit('node:error', {
          nodeId: node.id,
          error: result.error,
          result,
          state: this.getState(),
        });
      }

      return result;
    } catch (err: any) {
      const errorResult: NodeExecutionResult = {
        nodeId: node.id,
        nodeName,
        nodeType: nodeType as any,
        success: false,
        error: err?.message || '未知错误',
        startTime: Date.now(),
        endTime: Date.now(),
        duration: 0,
      };

      if (this.tracer) {
        this.tracer.endActiveSpan(undefined, errorResult.error);
      }

      await this.emit('node:error', {
        nodeId: node.id,
        error: errorResult.error,
        result: errorResult,
        state: this.getState(),
      });

      return errorResult;
    }
  }
}
