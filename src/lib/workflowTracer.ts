export type TraceSpanType = 'workflow' | 'node' | 'tool' | 'llm';
export type TraceSpanStatus = 'running' | 'completed' | 'failed';

export interface TraceSpan {
  id: string;
  parentId: string | null;
  name: string;
  type: TraceSpanType;
  startTime: number;
  endTime: number | null;
  duration: number | null;
  status: TraceSpanStatus;
  input?: any;
  output?: any;
  error?: string;
  metadata: Record<string, any>;
  children: TraceSpan[];
}

export interface TraceSummary {
  totalDuration: number | null;
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  nodeDurations: Record<string, number>;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  toolCallCount: number;
  llmCallCount: number;
}

function generateId(): string {
  return `span-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function getTimestamp(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export class WorkflowTracer {
  private spans: TraceSpan[] = [];
  private spanMap: Map<string, TraceSpan> = new Map();
  private rootSpanId: string | null = null;
  private activeStack: string[] = [];

  getRootSpan(): TraceSpan | null {
    return this.rootSpanId ? this.spanMap.get(this.rootSpanId) || null : null;
  }

  getAllSpans(): TraceSpan[] {
    return [...this.spans];
  }

  getSpanById(id: string): TraceSpan | undefined {
    return this.spanMap.get(id);
  }

  getActiveSpan(): TraceSpan | null {
    if (this.activeStack.length === 0) return null;
    const topId = this.activeStack[this.activeStack.length - 1];
    return this.spanMap.get(topId) || null;
  }

  startSpan(
    name: string,
    type: TraceSpanType,
    input?: any,
    metadata: Record<string, any> = {}
  ): TraceSpan {
    const parentId = this.activeStack.length > 0
      ? this.activeStack[this.activeStack.length - 1]
      : null;

    const span: TraceSpan = {
      id: generateId(),
      parentId,
      name,
      type,
      startTime: getTimestamp(),
      endTime: null,
      duration: null,
      status: 'running',
      input,
      output: undefined,
      error: undefined,
      metadata,
      children: [],
    };

    this.spans.push(span);
    this.spanMap.set(span.id, span);

    if (parentId) {
      const parent = this.spanMap.get(parentId);
      if (parent) {
        parent.children.push(span);
      }
    } else if (!this.rootSpanId) {
      this.rootSpanId = span.id;
    }

    this.activeStack.push(span.id);
    return span;
  }

  endSpan(id: string, output?: any, error?: string): TraceSpan {
    const span = this.spanMap.get(id);
    if (!span) {
      throw new Error(`Span not found: ${id}`);
    }

    if (span.status !== 'running') {
      return span;
    }

    span.endTime = getTimestamp();
    span.duration = span.endTime - span.startTime;
    span.output = output;
    span.error = error;
    span.status = error ? 'failed' : 'completed';

    const stackIndex = this.activeStack.lastIndexOf(id);
    if (stackIndex !== -1) {
      this.activeStack = this.activeStack.slice(0, stackIndex);
    }

    return span;
  }

  endActiveSpan(output?: any, error?: string): TraceSpan | null {
    const activeSpan = this.getActiveSpan();
    if (!activeSpan) return null;
    return this.endSpan(activeSpan.id, output, error);
  }

  addMetadata(id: string, key: string, value: any): void {
    const span = this.spanMap.get(id);
    if (span) {
      span.metadata[key] = value;
    }
  }

  getSummary(): TraceSummary {
    const rootSpan = this.getRootSpan();
    const nodeSpans = this.spans.filter((s) => s.type === 'node');
    const completedNodes = nodeSpans.filter((s) => s.status === 'completed').length;
    const failedNodes = nodeSpans.filter((s) => s.status === 'failed').length;

    const nodeDurations: Record<string, number> = {};
    for (const span of nodeSpans) {
      const nodeId = span.metadata.nodeId || span.name;
      if (span.duration !== null) {
        nodeDurations[nodeId] = span.duration;
      }
    }

    const llmSpans = this.spans.filter((s) => s.type === 'llm');
    let promptTokens = 0;
    let completionTokens = 0;
    for (const span of llmSpans) {
      if (span.metadata.promptTokens) {
        promptTokens += span.metadata.promptTokens;
      }
      if (span.metadata.completionTokens) {
        completionTokens += span.metadata.completionTokens;
      }
    }

    const toolSpans = this.spans.filter((s) => s.type === 'tool');

    return {
      totalDuration: rootSpan?.duration ?? null,
      totalNodes: nodeSpans.length,
      completedNodes,
      failedNodes,
      nodeDurations,
      tokenUsage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      toolCallCount: toolSpans.length,
      llmCallCount: llmSpans.length,
    };
  }

  toJSON(): string {
    return JSON.stringify(
      {
        rootSpanId: this.rootSpanId,
        spans: this.spans.map((span) => ({
          id: span.id,
          parentId: span.parentId,
          name: span.name,
          type: span.type,
          startTime: span.startTime,
          endTime: span.endTime,
          duration: span.duration,
          status: span.status,
          input: span.input,
          output: span.output,
          error: span.error,
          metadata: span.metadata,
        })),
        summary: this.getSummary(),
      },
      null,
      2
    );
  }

  toText(): string {
    const lines: string[] = [];
    const root = this.getRootSpan();

    if (!root) {
      return 'No trace data available.';
    }

    lines.push(`=== Workflow Trace: ${root.name} ===`);
    lines.push(`Status: ${root.status}`);
    if (root.duration !== null) {
      lines.push(`Total Duration: ${formatDuration(root.duration)}`);
    }
    lines.push('');

    const summary = this.getSummary();
    lines.push(`Nodes: ${summary.completedNodes}/${summary.totalNodes} completed, ${summary.failedNodes} failed`);
    lines.push(`LLM Calls: ${summary.llmCallCount}`);
    lines.push(`Tool Calls: ${summary.toolCallCount}`);
    if (summary.tokenUsage.totalTokens > 0) {
      lines.push(`Tokens: ${summary.tokenUsage.totalTokens} total (prompt: ${summary.tokenUsage.promptTokens}, completion: ${summary.tokenUsage.completionTokens})`);
    }
    lines.push('');
    lines.push('--- Timeline ---');

    this.appendSpanText(lines, root, 0);

    return lines.join('\n');
  }

  private appendSpanText(lines: string[], span: TraceSpan, depth: number): void {
    const indent = '  '.repeat(depth);
    const statusIcon = span.status === 'completed' ? '✓' : span.status === 'failed' ? '✗' : '◌';
    const durationStr = span.duration !== null ? ` [${formatDuration(span.duration)}]` : '';
    const errorStr = span.error ? ` - ERROR: ${span.error}` : '';

    lines.push(`${indent}${statusIcon} ${span.name} (${span.type})${durationStr}${errorStr}`);

    for (const child of span.children) {
      this.appendSpanText(lines, child, depth + 1);
    }
  }

  reset(): void {
    this.spans = [];
    this.spanMap.clear();
    this.rootSpanId = null;
    this.activeStack = [];
  }
}

function formatDuration(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)}μs`;
  }
  if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}
