import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentRuntime, type AgentConfig, type AgentToolCall, type AgentMessage } from '../agentRuntime';
import { InMemoryMemoryService } from '../../memory/memoryService';

describe('AgentRuntime - ReAct 循环', () => {
  const baseConfig: AgentConfig = {
    name: 'test-agent',
    description: 'Test Agent',
    model: {
      model: 'gpt-4o',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: '你是一个有帮助的助手。',
    },
    tools: [],
    maxIterations: 5,
  };

  describe('单轮问答（无工具调用）', () => {
    it('应该在不需要工具时直接返回最终回答', async () => {
      const mockLLMExecutor = vi.fn().mockResolvedValue({
        content: '这是最终答案。',
        toolCalls: undefined,
      });

      const agent = new AgentRuntime(baseConfig, {
        llmExecutor: mockLLMExecutor,
      });

      const result = await agent.run('你好');

      expect(result.success).toBe(true);
      expect(result.finalAnswer).toBe('这是最终答案。');
      expect(result.totalIterations).toBe(1);
      expect(result.toolCallHistory).toHaveLength(0);
      expect(result.thoughtSteps.length).toBeGreaterThan(0);

      const finalStep = result.thoughtSteps.find(s => s.type === 'final');
      expect(finalStep).toBeDefined();
      expect(finalStep!.content).toBe('这是最终答案。');
    });

    it('应该正确传递消息历史给 LLM', async () => {
      let capturedMessages: AgentMessage[] = [];
      const mockLLMExecutor = vi.fn().mockImplementation(async (config: any) => {
        capturedMessages = config.messages;
        return { content: '回答', toolCalls: undefined };
      });

      const agent = new AgentRuntime(baseConfig, {
        llmExecutor: mockLLMExecutor,
      });

      await agent.run('测试问题');

      expect(capturedMessages.length).toBeGreaterThanOrEqual(2);
      expect(capturedMessages[0].role).toBe('system');
      expect(capturedMessages[1].role).toBe('user');
      expect(capturedMessages[1].content).toBe('测试问题');
    });

    it('应该在 system prompt 中包含 ReAct 说明', async () => {
      let capturedSystemPrompt = '';
      const mockLLMExecutor = vi.fn().mockImplementation(async (config: any) => {
        const systemMsg = config.messages.find((m: AgentMessage) => m.role === 'system');
        if (systemMsg) capturedSystemPrompt = systemMsg.content;
        return { content: '回答', toolCalls: undefined };
      });

      const agent = new AgentRuntime(baseConfig, {
        llmExecutor: mockLLMExecutor,
      });

      await agent.run('测试');

      expect(capturedSystemPrompt).toContain('ReAct');
      expect(capturedSystemPrompt).toContain('思考');
      expect(capturedSystemPrompt).toContain('行动');
      expect(capturedSystemPrompt).toContain('观察');
    });
  });

  describe('多轮工具调用', () => {
    it('应该执行工具调用并将结果返回给 LLM', async () => {
      let callCount = 0;
      const mockLLMExecutor = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: '让我查一下天气。',
            toolCalls: [
              {
                id: 'call_1',
                name: 'get_weather',
                arguments: { city: '北京' },
              },
            ] as AgentToolCall[],
          };
        }
        return { content: '北京今天天气晴朗。', toolCalls: undefined };
      });

      const mockToolExecutor = vi.fn().mockResolvedValue({
        temperature: 25,
        condition: '晴朗',
        city: '北京',
      });

      const agent = new AgentRuntime(
        { ...baseConfig, tools: ['get_weather'] },
        {
          llmExecutor: mockLLMExecutor,
          mcpToolExecutor: mockToolExecutor,
        }
      );

      const result = await agent.run('北京天气怎么样？');

      expect(result.success).toBe(true);
      expect(result.totalIterations).toBe(2);
      expect(result.toolCallHistory).toHaveLength(1);
      expect(result.toolCallHistory[0].toolName).toBe('get_weather');
      expect(result.toolCallHistory[0].toolArgs).toEqual({ city: '北京' });
      expect(result.toolCallHistory[0].result).toEqual({
        temperature: 25,
        condition: '晴朗',
        city: '北京',
      });

      expect(mockToolExecutor).toHaveBeenCalledTimes(1);
      expect(mockToolExecutor).toHaveBeenCalledWith({
        toolName: 'get_weather',
        arguments: { city: '北京' },
      });

      const thoughtSteps = result.thoughtSteps;
      expect(thoughtSteps.some(s => s.type === 'action')).toBe(true);
      expect(thoughtSteps.some(s => s.type === 'observation')).toBe(true);
    });

    it('应该支持多轮工具调用', async () => {
      let callCount = 0;
      const mockLLMExecutor = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: '先搜索',
            toolCalls: [{ id: 'call_1', name: 'search', arguments: { query: 'test' } }] as AgentToolCall[],
          };
        }
        if (callCount === 2) {
          return {
            content: '再查详情',
            toolCalls: [{ id: 'call_2', name: 'get_detail', arguments: { id: '123' } }] as AgentToolCall[],
          };
        }
        return { content: '最终结果', toolCalls: undefined };
      });

      const mockToolExecutor = vi.fn()
        .mockResolvedValueOnce({ results: ['123'] })
        .mockResolvedValueOnce({ id: '123', name: 'Test Item' });

      const agent = new AgentRuntime(
        { ...baseConfig, tools: ['search', 'get_detail'], maxIterations: 5 },
        {
          llmExecutor: mockLLMExecutor,
          mcpToolExecutor: mockToolExecutor,
        }
      );

      const result = await agent.run('查找信息');

      expect(result.success).toBe(true);
      expect(result.totalIterations).toBe(3);
      expect(result.toolCallHistory).toHaveLength(2);
      expect(result.toolCallHistory[0].toolName).toBe('search');
      expect(result.toolCallHistory[1].toolName).toBe('get_detail');
    });

    it('应该支持同一轮调用多个工具', async () => {
      const mockLLMExecutor = vi.fn()
        .mockResolvedValueOnce({
          content: '并行调用两个工具',
          toolCalls: [
            { id: 'call_1', name: 'tool_a', arguments: { x: 1 } },
            { id: 'call_2', name: 'tool_b', arguments: { y: 2 } },
          ] as AgentToolCall[],
        })
        .mockResolvedValueOnce({ content: '完成', toolCalls: undefined });

      const mockToolExecutor = vi.fn()
        .mockResolvedValueOnce({ result: 'A' })
        .mockResolvedValueOnce({ result: 'B' });

      const agent = new AgentRuntime(
        { ...baseConfig, tools: ['tool_a', 'tool_b'] },
        {
          llmExecutor: mockLLMExecutor,
          mcpToolExecutor: mockToolExecutor,
        }
      );

      const result = await agent.run('测试');

      expect(result.success).toBe(true);
      expect(result.toolCallHistory).toHaveLength(2);
      expect(result.toolCallHistory[0].iteration).toBe(1);
      expect(result.toolCallHistory[1].iteration).toBe(1);
    });
  });

  describe('maxIterations 限制', () => {
    it('应该在达到最大迭代次数时停止并返回错误', async () => {
      const mockLLMExecutor = vi.fn().mockResolvedValue({
        content: '继续调用',
        toolCalls: [{ id: 'call_1', name: 'dummy_tool', arguments: {} }] as AgentToolCall[],
      });

      const mockToolExecutor = vi.fn().mockResolvedValue({ status: 'ok' });

      const agent = new AgentRuntime(
        { ...baseConfig, tools: ['dummy_tool'], maxIterations: 3 },
        {
          llmExecutor: mockLLMExecutor,
          mcpToolExecutor: mockToolExecutor,
        }
      );

      const result = await agent.run('永远循环的任务');

      expect(result.success).toBe(false);
      expect(result.totalIterations).toBe(3);
      expect(result.error).toContain('超过最大迭代次数');
      expect(result.error).toContain('3');
      expect(result.toolCallHistory).toHaveLength(3);
    });

    it('默认最大迭代次数应该有合理值', async () => {
      const configWithoutMaxIter: AgentConfig = {
        ...baseConfig,
        maxIterations: undefined,
      };

      const mockLLMExecutor = vi.fn().mockResolvedValue({
        content: '循环',
        toolCalls: [{ id: 'c1', name: 't', arguments: {} }] as AgentToolCall[],
      });

      const agent = new AgentRuntime(configWithoutMaxIter, {
        llmExecutor: mockLLMExecutor,
        mcpToolExecutor: vi.fn().mockResolvedValue({}),
      });

      const result = await agent.run('test');
      expect(result.success).toBe(false);
      expect(result.totalIterations).toBeLessThanOrEqual(20);
    });
  });

  describe('错误处理', () => {
    it('应该处理 LLM 调用错误', async () => {
      const mockLLMExecutor = vi.fn().mockRejectedValue(new Error('LLM 服务不可用'));

      const agent = new AgentRuntime(baseConfig, {
        llmExecutor: mockLLMExecutor,
      });

      const result = await agent.run('测试');

      expect(result.success).toBe(false);
      expect(result.error).toContain('LLM 服务不可用');
      expect(result.finalAnswer).toBe('');
    });

    it('应该处理工具执行错误并继续循环', async () => {
      let callCount = 0;
      const mockLLMExecutor = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: '调用工具',
            toolCalls: [{ id: 'call_1', name: 'failing_tool', arguments: {} }] as AgentToolCall[],
          };
        }
        return { content: '出错了，但我处理好了', toolCalls: undefined };
      });

      const mockToolExecutor = vi.fn().mockRejectedValue(new Error('工具调用失败'));

      const agent = new AgentRuntime(
        { ...baseConfig, tools: ['failing_tool'] },
        {
          llmExecutor: mockLLMExecutor,
          mcpToolExecutor: mockToolExecutor,
        }
      );

      const result = await agent.run('测试');

      expect(result.success).toBe(true);
      expect(result.toolCallHistory).toHaveLength(1);
      expect(result.toolCallHistory[0].result).toHaveProperty('error');
      expect(result.toolCallHistory[0].result.error).toContain('工具调用失败');
    });

    it('应该在没有 mcpToolExecutor 时使用 mock 结果', async () => {
      const mockLLMExecutor = vi.fn()
        .mockResolvedValueOnce({
          content: '调用工具',
          toolCalls: [{ id: 'call_1', name: 'test_tool', arguments: { a: 1 } }] as AgentToolCall[],
        })
        .mockResolvedValueOnce({ content: '完成', toolCalls: undefined });

      const agent = new AgentRuntime(
        { ...baseConfig, tools: ['test_tool'] },
        {
          llmExecutor: mockLLMExecutor,
        }
      );

      const result = await agent.run('测试');

      expect(result.success).toBe(true);
      expect(result.toolCallHistory).toHaveLength(1);
      expect(result.toolCallHistory[0].result).toBeDefined();
    });
  });

  describe('事件回调', () => {
    it('应该触发 onThoughtStep 回调', async () => {
      const onThoughtStep = vi.fn();

      const mockLLMExecutor = vi.fn().mockResolvedValue({
        content: '最终答案',
        toolCalls: undefined,
      });

      const agent = new AgentRuntime(baseConfig, {
        llmExecutor: mockLLMExecutor,
        onThoughtStep,
      });

      await agent.run('测试');

      expect(onThoughtStep).toHaveBeenCalled();
      const calls = onThoughtStep.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0].iteration).toBe(1);
    });

    it('应该触发 onToolCall 和 onToolResult 回调', async () => {
      const onToolCall = vi.fn();
      const onToolResult = vi.fn();

      const mockLLMExecutor = vi.fn()
        .mockResolvedValueOnce({
          content: '调用',
          toolCalls: [{ id: 'call_1', name: 'my_tool', arguments: { x: 42 } }] as AgentToolCall[],
        })
        .mockResolvedValueOnce({ content: '完成', toolCalls: undefined });

      const mockToolExecutor = vi.fn().mockResolvedValue({ ok: true });

      const agent = new AgentRuntime(
        { ...baseConfig, tools: ['my_tool'] },
        {
          llmExecutor: mockLLMExecutor,
          mcpToolExecutor: mockToolExecutor,
          onToolCall,
          onToolResult,
        }
      );

      await agent.run('测试');

      expect(onToolCall).toHaveBeenCalledTimes(1);
      expect(onToolCall).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'my_tool', arguments: { x: 42 } })
      );

      expect(onToolResult).toHaveBeenCalledTimes(1);
      expect(onToolResult).toHaveBeenCalledWith('call_1', { ok: true });
    });
  });

  describe('记忆功能', () => {
    it('启用记忆时应该从记忆中检索上下文', async () => {
      const memoryService = new InMemoryMemoryService();
      await memoryService.save('test:hello', { greeting: '你好' }, {}, ['test']);

      let capturedSystemPrompt = '';
      const mockLLMExecutor = vi.fn().mockImplementation(async (config: any) => {
        const systemMsg = config.messages.find((m: AgentMessage) => m.role === 'system');
        if (systemMsg) capturedSystemPrompt = systemMsg.content;
        return { content: '回答', toolCalls: undefined };
      });

      const agent = new AgentRuntime(
        {
          ...baseConfig,
          memory: { enabled: true, namespace: 'test' },
        },
        {
          llmExecutor: mockLLMExecutor,
          memoryService,
        }
      );

      await agent.run('hello', { query: 'greeting' });

      expect(capturedSystemPrompt).toContain('记忆上下文');
    });

    it('未启用记忆时不应该包含记忆上下文', async () => {
      const memoryService = new InMemoryMemoryService();

      let capturedSystemPrompt = '';
      const mockLLMExecutor = vi.fn().mockImplementation(async (config: any) => {
        const systemMsg = config.messages.find((m: AgentMessage) => m.role === 'system');
        if (systemMsg) capturedSystemPrompt = systemMsg.content;
        return { content: '回答', toolCalls: undefined };
      });

      const agent = new AgentRuntime(
        {
          ...baseConfig,
          memory: { enabled: false },
        },
        {
          llmExecutor: mockLLMExecutor,
          memoryService,
        }
      );

      await agent.run('测试');

      expect(capturedSystemPrompt).not.toContain('记忆上下文');
    });
  });

  describe('工具定义', () => {
    it('应该向 LLM 传递工具定义', async () => {
      let capturedTools: any[] | undefined;
      const mockLLMExecutor = vi.fn().mockImplementation(async (config: any) => {
        capturedTools = config.tools;
        return { content: '回答', toolCalls: undefined };
      });

      const agent = new AgentRuntime(
        { ...baseConfig, tools: ['tool_a', 'tool_b', 'tool_c'] },
        { llmExecutor: mockLLMExecutor }
      );

      await agent.run('测试');

      expect(capturedTools).toBeDefined();
      expect(capturedTools!).toHaveLength(3);
      expect(capturedTools![0].type).toBe('function');
      expect(capturedTools![0].function.name).toBe('tool_a');
    });

    it('没有工具时不传递 tools 参数', async () => {
      let capturedTools: any[] | undefined = ['should-be-overwritten'];
      const mockLLMExecutor = vi.fn().mockImplementation(async (config: any) => {
        capturedTools = config.tools;
        return { content: '回答', toolCalls: undefined };
      });

      const agent = new AgentRuntime(
        { ...baseConfig, tools: [] },
        { llmExecutor: mockLLMExecutor }
      );

      await agent.run('测试');

      expect(capturedTools).toBeUndefined();
    });
  });

  describe('状态查询方法', () => {
    it('getMessages 应该返回消息历史', async () => {
      const mockLLMExecutor = vi.fn().mockResolvedValue({
        content: '你好！',
        toolCalls: undefined,
      });

      const agent = new AgentRuntime(baseConfig, { llmExecutor: mockLLMExecutor });

      await agent.run('嗨');

      const messages = agent.getMessages();
      expect(messages.length).toBeGreaterThanOrEqual(3);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages[2].role).toBe('assistant');
    });

    it('getThoughtSteps 应该返回思考步骤', async () => {
      const mockLLMExecutor = vi.fn().mockResolvedValue({
        content: '回答',
        toolCalls: undefined,
      });

      const agent = new AgentRuntime(baseConfig, { llmExecutor: mockLLMExecutor });

      await agent.run('测试');

      const steps = agent.getThoughtSteps();
      expect(steps.length).toBeGreaterThan(0);
    });

    it('getToolCallHistory 应该返回工具调用历史', async () => {
      const mockLLMExecutor = vi.fn()
        .mockResolvedValueOnce({
          content: '调用',
          toolCalls: [{ id: 'c1', name: 't1', arguments: {} }] as AgentToolCall[],
        })
        .mockResolvedValueOnce({ content: '完成', toolCalls: undefined });

      const agent = new AgentRuntime(
        { ...baseConfig, tools: ['t1'] },
        {
          llmExecutor: mockLLMExecutor,
          mcpToolExecutor: vi.fn().mockResolvedValue({}),
        }
      );

      await agent.run('测试');

      const history = agent.getToolCallHistory();
      expect(history).toHaveLength(1);
    });

    it('getIterationCount 应该返回迭代次数', async () => {
      const mockLLMExecutor = vi.fn().mockResolvedValue({
        content: '回答',
        toolCalls: undefined,
      });

      const agent = new AgentRuntime(baseConfig, { llmExecutor: mockLLMExecutor });

      await agent.run('测试');

      expect(agent.getIterationCount()).toBe(1);
    });
  });
});

describe('AgentRuntime - agent 节点执行器集成', () => {
  it('agentNodeExecutor 应该能够执行 agent 节点', async () => {
    const { agentNodeExecutor } = await import('../../workflowExecutors');

    const mockLLMExecutor = vi.fn().mockResolvedValue('这是 Agent 的回答');

    const node = {
      id: 'agent-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: {
        label: '测试 Agent',
        type: 'agent',
        iconName: 'Bot',
        description: '',
        agentConfig: {
          model: 'gpt-4o',
          systemPrompt: '你是一个测试助手。',
          temperature: 0.7,
          maxTokens: 1024,
          tools: [],
          maxIterations: 5,
          outputVariable: 'agent_result',
        },
      },
    } as any;

    const context = {
      variables: { input: '你好，请介绍自己' },
      nodeOutputs: {},
      llmExecutor: mockLLMExecutor,
    };

    const result = await agentNodeExecutor(node, context);

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output!.agent_result).toBeDefined();
    expect(typeof result.output!.agent_result).toBe('string');
    expect(result.metadata).toBeDefined();
  });

  it('agentNodeExecutor 应该支持变量解析', async () => {
    const { agentNodeExecutor } = await import('../../workflowExecutors');

    let capturedUserPrompt = '';
    const mockLLMExecutor = vi.fn().mockImplementation(async (config: any) => {
      capturedUserPrompt = config.userPrompt;
      return '回答';
    });

    const node = {
      id: 'agent-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: {
        label: '测试 Agent',
        type: 'agent',
        agentConfig: {
          model: 'gpt-4o',
          systemPrompt: '系统提示',
          outputVariable: 'result',
        },
      },
    } as any;

    const context = {
      variables: { input: 'Hello World' },
      nodeOutputs: {},
      llmExecutor: mockLLMExecutor,
    };

    const result = await agentNodeExecutor(node, context);

    expect(result.success).toBe(true);
  });

  it('agentNodeExecutor 应该处理执行错误', async () => {
    const { agentNodeExecutor } = await import('../../workflowExecutors');

    const mockLLMExecutor = vi.fn().mockRejectedValue(new Error('LLM 失败'));

    const node = {
      id: 'agent-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: {
        label: '测试 Agent',
        type: 'agent',
        agentConfig: {
          model: 'gpt-4o',
          systemPrompt: '测试',
        },
      },
    } as any;

    const context = {
      variables: { input: 'test' },
      nodeOutputs: {},
      llmExecutor: mockLLMExecutor,
    };

    const result = await agentNodeExecutor(node, context);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Agent 执行失败');
  });
});
