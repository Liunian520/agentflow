import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowTracer } from '../workflowTracer';
import type { TraceSpan, TraceSpanType, TraceSpanStatus } from '../workflowTracer';

describe('WorkflowTracer', () => {
  let tracer: WorkflowTracer;

  beforeEach(() => {
    tracer = new WorkflowTracer();
  });

  describe('span 创建', () => {
    it('应该创建根 span', () => {
      const span = tracer.startSpan('Test Workflow', 'workflow');
      expect(span).toBeDefined();
      expect(span.id).toBeTruthy();
      expect(span.name).toBe('Test Workflow');
      expect(span.type).toBe('workflow');
      expect(span.parentId).toBeNull();
      expect(span.status).toBe('running');
      expect(span.startTime).toBeGreaterThan(0);
      expect(span.endTime).toBeNull();
      expect(span.duration).toBeNull();
    });

    it('应该创建嵌套的子 span', () => {
      const rootSpan = tracer.startSpan('Root', 'workflow');
      const childSpan = tracer.startSpan('Child', 'node');

      expect(childSpan.parentId).toBe(rootSpan.id);
      expect(rootSpan.children).toHaveLength(1);
      expect(rootSpan.children[0].id).toBe(childSpan.id);
    });

    it('应该支持多层嵌套', () => {
      const workflowSpan = tracer.startSpan('Workflow', 'workflow');
      const nodeSpan = tracer.startSpan('Node', 'node');
      const toolSpan = tracer.startSpan('Tool', 'tool');
      const llmSpan = tracer.startSpan('LLM', 'llm');

      expect(workflowSpan.children).toHaveLength(1);
      expect(nodeSpan.parentId).toBe(workflowSpan.id);

      expect(nodeSpan.children).toHaveLength(1);
      expect(toolSpan.parentId).toBe(nodeSpan.id);

      expect(toolSpan.children).toHaveLength(1);
      expect(llmSpan.parentId).toBe(toolSpan.id);
    });

    it('应该存储输入和元数据', () => {
      const input = { key: 'value' };
      const metadata = { nodeId: 'node-1', model: 'gpt-4' };
      const span = tracer.startSpan('Test', 'node', input, metadata);

      expect(span.input).toEqual(input);
      expect(span.metadata).toEqual(metadata);
    });

    it('第一个 span 应该是根 span', () => {
      expect(tracer.getRootSpan()).toBeNull();

      const span = tracer.startSpan('Root', 'workflow');
      expect(tracer.getRootSpan()?.id).toBe(span.id);
    });
  });

  describe('span 结束和状态转换', () => {
    it('应该成功结束 span', () => {
      const span = tracer.startSpan('Test', 'node');
      const output = { result: 'success' };

      const endedSpan = tracer.endSpan(span.id, output);

      expect(endedSpan.status).toBe('completed');
      expect(endedSpan.output).toEqual(output);
      expect(endedSpan.endTime).toBeGreaterThanOrEqual(endedSpan.startTime);
      expect(endedSpan.duration).toBeGreaterThanOrEqual(0);
    });

    it('应该以错误状态结束 span', () => {
      const span = tracer.startSpan('Test', 'node');
      const error = 'Something went wrong';

      const endedSpan = tracer.endSpan(span.id, undefined, error);

      expect(endedSpan.status).toBe('failed');
      expect(endedSpan.error).toBe(error);
      expect(endedSpan.endTime).toBeDefined();
      expect(endedSpan.duration).toBeDefined();
    });

    it('已经结束的 span 不应该再次改变', () => {
      const span = tracer.startSpan('Test', 'node');
      tracer.endSpan(span.id, { first: true });

      const firstEndTime = span.endTime;
      const firstDuration = span.duration;

      tracer.endSpan(span.id, { second: true }, 'error');

      expect(span.status).toBe('completed');
      expect(span.output).toEqual({ first: true });
      expect(span.endTime).toBe(firstEndTime);
      expect(span.duration).toBe(firstDuration);
    });

    it('endActiveSpan 应该结束当前活动的 span', () => {
      const rootSpan = tracer.startSpan('Root', 'workflow');
      const childSpan = tracer.startSpan('Child', 'node');

      expect(tracer.getActiveSpan()?.id).toBe(childSpan.id);

      const ended = tracer.endActiveSpan();
      expect(ended?.id).toBe(childSpan.id);
      expect(ended?.status).toBe('completed');
      expect(tracer.getActiveSpan()?.id).toBe(rootSpan.id);
    });

    it('没有活动 span 时 endActiveSpan 应该返回 null', () => {
      expect(tracer.endActiveSpan()).toBeNull();
    });

    it('结束不存在的 span 应该抛出错误', () => {
      expect(() => tracer.endSpan('nonexistent')).toThrow('Span not found');
    });
  });

  describe('span 检索', () => {
    it('getAllSpans 应该返回所有 span', () => {
      tracer.startSpan('1', 'workflow');
      tracer.startSpan('2', 'node');
      tracer.startSpan('3', 'tool');

      expect(tracer.getAllSpans()).toHaveLength(3);
    });

    it('getSpanById 应该根据 ID 返回 span', () => {
      const span = tracer.startSpan('Test', 'node');
      const found = tracer.getSpanById(span.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(span.id);
      expect(found?.name).toBe('Test');
    });

    it('getSpanById 找不到时返回 undefined', () => {
      expect(tracer.getSpanById('nonexistent')).toBeUndefined();
    });

    it('getActiveSpan 应该返回栈顶的 span', () => {
      expect(tracer.getActiveSpan()).toBeNull();

      const span1 = tracer.startSpan('1', 'workflow');
      expect(tracer.getActiveSpan()?.id).toBe(span1.id);

      const span2 = tracer.startSpan('2', 'node');
      expect(tracer.getActiveSpan()?.id).toBe(span2.id);

      tracer.endActiveSpan();
      expect(tracer.getActiveSpan()?.id).toBe(span1.id);

      tracer.endActiveSpan();
      expect(tracer.getActiveSpan()).toBeNull();
    });
  });

  describe('元数据', () => {
    it('addMetadata 应该添加元数据', () => {
      const span = tracer.startSpan('Test', 'node', undefined, { existing: 'value' });

      tracer.addMetadata(span.id, 'newKey', 'newValue');
      tracer.addMetadata(span.id, 'numKey', 42);

      expect(span.metadata.existing).toBe('value');
      expect(span.metadata.newKey).toBe('newValue');
      expect(span.metadata.numKey).toBe(42);
    });

    it('addMetadata 对不存在的 span 不做任何事', () => {
      expect(() => tracer.addMetadata('nonexistent', 'key', 'value')).not.toThrow();
    });
  });

  describe('统计汇总', () => {
    it('应该正确统计节点数量', () => {
      tracer.startSpan('Workflow', 'workflow');
      tracer.startSpan('Node 1', 'node');
      tracer.endActiveSpan();
      tracer.startSpan('Node 2', 'node');
      tracer.endActiveSpan(undefined, 'error');
      tracer.endActiveSpan();

      const summary = tracer.getSummary();
      expect(summary.totalNodes).toBe(2);
      expect(summary.completedNodes).toBe(1);
      expect(summary.failedNodes).toBe(1);
    });

    it('应该统计 LLM 和工具调用次数', () => {
      tracer.startSpan('Workflow', 'workflow');
      tracer.startSpan('Node 1', 'node');
      tracer.startSpan('LLM 1', 'llm');
      tracer.endActiveSpan();
      tracer.startSpan('Tool 1', 'tool');
      tracer.endActiveSpan();
      tracer.startSpan('Tool 2', 'tool');
      tracer.endActiveSpan();
      tracer.endActiveSpan();
      tracer.endActiveSpan();

      const summary = tracer.getSummary();
      expect(summary.llmCallCount).toBe(1);
      expect(summary.toolCallCount).toBe(2);
    });

    it('应该汇总 token 使用量', () => {
      tracer.startSpan('Workflow', 'workflow');
      tracer.startSpan('LLM 1', 'llm', undefined, { promptTokens: 100, completionTokens: 50 });
      tracer.endActiveSpan();
      tracer.startSpan('LLM 2', 'llm', undefined, { promptTokens: 200, completionTokens: 100 });
      tracer.endActiveSpan();
      tracer.endActiveSpan();

      const summary = tracer.getSummary();
      expect(summary.tokenUsage.promptTokens).toBe(300);
      expect(summary.tokenUsage.completionTokens).toBe(150);
      expect(summary.tokenUsage.totalTokens).toBe(450);
    });

    it('应该返回总执行时间', () => {
      const rootSpan = tracer.startSpan('Workflow', 'workflow');
      tracer.endSpan(rootSpan.id);

      const summary = tracer.getSummary();
      expect(summary.totalDuration).toBeGreaterThanOrEqual(0);
      expect(summary.totalDuration).toBe(rootSpan.duration);
    });

    it('没有根 span 时总时间为 null', () => {
      const summary = tracer.getSummary();
      expect(summary.totalDuration).toBeNull();
    });

    it('应该记录各节点耗时', () => {
      tracer.startSpan('Workflow', 'workflow');
      tracer.startSpan('Node 1', 'node', undefined, { nodeId: 'node-1' });
      tracer.endActiveSpan();
      tracer.startSpan('Node 2', 'node', undefined, { nodeId: 'node-2' });
      tracer.endActiveSpan();
      tracer.endActiveSpan();

      const summary = tracer.getSummary();
      expect(Object.keys(summary.nodeDurations)).toHaveLength(2);
      expect(summary.nodeDurations['node-1']).toBeGreaterThanOrEqual(0);
      expect(summary.nodeDurations['node-2']).toBeGreaterThanOrEqual(0);
    });
  });

  describe('导出功能', () => {
    it('toJSON 应该返回有效的 JSON 字符串', () => {
      tracer.startSpan('Workflow', 'workflow', { input: 'test' });
      tracer.startSpan('Node', 'node');
      tracer.endActiveSpan({ output: 'result' });
      tracer.endActiveSpan();

      const json = tracer.toJSON();
      const parsed = JSON.parse(json);

      expect(parsed.rootSpanId).toBeTruthy();
      expect(parsed.spans).toBeInstanceOf(Array);
      expect(parsed.spans.length).toBe(2);
      expect(parsed.summary).toBeDefined();
      expect(parsed.summary.totalNodes).toBe(1);
    });

    it('toText 应该返回可读的文本格式', () => {
      tracer.startSpan('My Workflow', 'workflow');
      tracer.startSpan('Step 1', 'node');
      tracer.endActiveSpan();
      tracer.startSpan('Step 2', 'node');
      tracer.endActiveSpan(undefined, 'Failed');
      tracer.endActiveSpan();

      const text = tracer.toText();

      expect(text).toContain('My Workflow');
      expect(text).toContain('Step 1');
      expect(text).toContain('Step 2');
      expect(text).toContain('ERROR');
      expect(text).toContain('Nodes:');
      expect(text).toContain('Timeline');
    });

    it('没有数据时 toText 返回提示信息', () => {
      const text = tracer.toText();
      expect(text).toContain('No trace data available');
    });
  });

  describe('重置', () => {
    it('reset 应该清空所有数据', () => {
      tracer.startSpan('Workflow', 'workflow');
      tracer.startSpan('Node', 'node');

      expect(tracer.getAllSpans().length).toBe(2);
      expect(tracer.getRootSpan()).not.toBeNull();

      tracer.reset();

      expect(tracer.getAllSpans().length).toBe(0);
      expect(tracer.getRootSpan()).toBeNull();
      expect(tracer.getActiveSpan()).toBeNull();
    });
  });

  describe('不同 span 类型', () => {
    const types: TraceSpanType[] = ['workflow', 'node', 'tool', 'llm'];

    it.each(types)('应该支持 %s 类型的 span', (type) => {
      const span = tracer.startSpan(`Test ${type}`, type);
      expect(span.type).toBe(type);
    });
  });

  describe('活动栈管理', () => {
    it('应该正确维护活动栈', () => {
      const span1 = tracer.startSpan('1', 'workflow');
      const span2 = tracer.startSpan('2', 'node');
      const span3 = tracer.startSpan('3', 'tool');

      expect(tracer.getActiveSpan()?.id).toBe(span3.id);

      tracer.endSpan(span3.id);
      expect(tracer.getActiveSpan()?.id).toBe(span2.id);

      tracer.endSpan(span2.id);
      expect(tracer.getActiveSpan()?.id).toBe(span1.id);

      tracer.endSpan(span1.id);
      expect(tracer.getActiveSpan()).toBeNull();
    });

    it('结束中间的 span 应该正确弹出栈', () => {
      const span1 = tracer.startSpan('1', 'workflow');
      const span2 = tracer.startSpan('2', 'node');
      const span3 = tracer.startSpan('3', 'tool');

      tracer.endSpan(span2.id);

      expect(tracer.getActiveSpan()?.id).toBe(span1.id);
      expect(span1.children).toHaveLength(1);
      expect(span1.children[0].id).toBe(span2.id);
    });
  });
});
