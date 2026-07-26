import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MoARouter, type AgentProfile, type RouterStrategy, type AggregationMethod } from '../moaRouter';

describe('MoARouter - 多 Agent 协作与路由', () => {
  const sampleAgents: AgentProfile[] = [
    {
      id: 'code-agent',
      name: '代码专家',
      description: '专注于编程和代码开发的 Agent',
      specialties: ['编程', '代码', '开发', 'debug'],
      capabilities: ['写代码', '代码审查', 'bug修复', '架构设计'],
      systemPrompt: '你是一个代码专家。',
      keywords: ['代码', '编程', '函数', '类', 'bug', 'debug'],
      priority: 1,
    },
    {
      id: 'writing-agent',
      name: '写作专家',
      description: '擅长文章写作和文案创作的 Agent',
      specialties: ['写作', '文案', '编辑', '翻译'],
      capabilities: ['写文章', '文案创作', '翻译', '润色'],
      systemPrompt: '你是一个写作专家。',
      keywords: ['文章', '写作', '文案', '翻译', '润色'],
      priority: 2,
    },
    {
      id: 'analysis-agent',
      name: '数据分析专家',
      description: '擅长数据分析和报表生成的 Agent',
      specialties: ['数据分析', '统计', '报表', '可视化'],
      capabilities: ['数据分析', '统计建模', '报表生成', '图表制作'],
      systemPrompt: '你是一个数据分析专家。',
      keywords: ['数据', '分析', '统计', '报表', '图表'],
      priority: 3,
    },
  ];

  describe('Agent 管理', () => {
    it('应该能够添加和获取 Agent', () => {
      const router = new MoARouter();
      expect(router.getAgents()).toHaveLength(0);

      router.addAgent(sampleAgents[0]);
      expect(router.getAgents()).toHaveLength(1);
      expect(router.getAgents()[0].id).toBe('code-agent');
    });

    it('应该能够删除 Agent', () => {
      const router = new MoARouter([...sampleAgents]);
      expect(router.getAgents()).toHaveLength(3);

      const result = router.removeAgent('writing-agent');
      expect(result).toBe(true);
      expect(router.getAgents()).toHaveLength(2);
      expect(router.getAgents().find(a => a.id === 'writing-agent')).toBeUndefined();
    });

    it('删除不存在的 Agent 应该返回 false', () => {
      const router = new MoARouter([...sampleAgents]);
      const result = router.removeAgent('nonexistent');
      expect(result).toBe(false);
      expect(router.getAgents()).toHaveLength(3);
    });

    it('构造函数应该接受初始 Agent 列表', () => {
      const router = new MoARouter([...sampleAgents]);
      expect(router.getAgents()).toHaveLength(3);
    });
  });

  describe('意图路由 (intentRouting)', () => {
    it('应该根据查询内容选择最合适的 Agent', () => {
      const router = new MoARouter([...sampleAgents]);

      const results = router.intentRouting('帮我写一个 Python 函数来排序数组');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].agent.id).toBe('code-agent');
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('写作相关查询应该选择写作专家', () => {
      const router = new MoARouter([...sampleAgents]);

      const results = router.intentRouting('帮我写一篇关于人工智能的文章');
      expect(results[0].agent.id).toBe('writing-agent');
    });

    it('数据分析相关查询应该选择数据分析专家', () => {
      const router = new MoARouter([...sampleAgents]);

      const results = router.intentRouting('分析这些销售数据并生成报表');
      expect(results[0].agent.id).toBe('analysis-agent');
    });

    it('应该返回按分数排序的结果', () => {
      const router = new MoARouter([...sampleAgents]);

      const results = router.intentRouting('写代码和数据分析');
      expect(results.length).toBe(3);
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
      expect(results[1].score).toBeGreaterThanOrEqual(results[2].score);
    });

    it('空 Agent 列表应该返回空结果', () => {
      const router = new MoARouter();
      const results = router.intentRouting('测试');
      expect(results).toEqual([]);
    });

    it('应该包含路由原因说明', () => {
      const router = new MoARouter([...sampleAgents]);

      const results = router.intentRouting('帮我 debug 这段代码');
      expect(results[0].reason).toBeDefined();
      expect(results[0].reason.length).toBeGreaterThan(0);
    });
  });

  describe('关键词路由 (keywordRouting)', () => {
    it('应该根据关键词匹配选择 Agent', () => {
      const router = new MoARouter([...sampleAgents]);

      const results = router.keywordRouting('帮我 debug 这个 bug');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].agent.id).toBe('code-agent');
    });

    it('无匹配关键词时返回第一个 Agent', () => {
      const router = new MoARouter([...sampleAgents]);

      const results = router.keywordRouting('今天天气怎么样');
      expect(results.length).toBe(1);
      expect(results[0].agent.id).toBe('code-agent');
      expect(results[0].score).toBe(0);
    });

    it('应该匹配专长作为补充关键词', () => {
      const router = new MoARouter([...sampleAgents]);

      const results = router.keywordRouting('统计分析');
      expect(results[0].agent.id).toBe('analysis-agent');
    });

    it('空 Agent 列表应该返回空结果', () => {
      const router = new MoARouter();
      const results = router.keywordRouting('测试');
      expect(results).toEqual([]);
    });
  });

  describe('轮询路由 (roundRobin)', () => {
    it('应该轮流选择 Agent', () => {
      const router = new MoARouter([...sampleAgents]);
      router.resetRoundRobin();

      const result1 = router.roundRobin();
      expect(result1[0].agent.id).toBe('code-agent');

      const result2 = router.roundRobin();
      expect(result2[0].agent.id).toBe('writing-agent');

      const result3 = router.roundRobin();
      expect(result3[0].agent.id).toBe('analysis-agent');

      const result4 = router.roundRobin();
      expect(result4[0].agent.id).toBe('code-agent');
    });

    it('resetRoundRobin 应该重置索引', () => {
      const router = new MoARouter([...sampleAgents]);
      router.roundRobin();
      router.roundRobin();

      router.resetRoundRobin();
      const result = router.roundRobin();
      expect(result[0].agent.id).toBe('code-agent');
    });

    it('空 Agent 列表应该返回空结果', () => {
      const router = new MoARouter();
      const results = router.roundRobin();
      expect(results).toEqual([]);
    });
  });

  describe('通用 route 方法', () => {
    it('应该根据指定策略路由', () => {
      const router = new MoARouter([...sampleAgents]);

      const intentResults = router.route('写代码', 'intent');
      expect(intentResults[0].agent.id).toBe('code-agent');

      router.resetRoundRobin();
      const rrResults = router.route('测试', 'roundRobin');
      expect(rrResults[0].agent.id).toBe('code-agent');
    });

    it('默认使用 intent 策略', () => {
      const router = new MoARouter([...sampleAgents]);
      const results = router.route('写代码');
      expect(results[0].agent.id).toBe('code-agent');
    });

    it('应该支持自定义默认策略', () => {
      const router = new MoARouter([...sampleAgents], { defaultStrategy: 'roundRobin' });
      router.resetRoundRobin();
      const results = router.route('测试');
      expect(results[0].agent.id).toBe('code-agent');
    });
  });

  describe('串行执行 (executeSerial)', () => {
    it('应该按顺序执行所有 Agent', async () => {
      const router = new MoARouter([...sampleAgents]);
      const executor = vi.fn().mockImplementation((agent: AgentProfile, input: string) => {
        return Promise.resolve(`${agent.name} 处理了: ${input}`);
      });

      const result = await router.executeSerial('初始任务', executor);

      expect(executor).toHaveBeenCalledTimes(3);
      expect(result.results).toHaveLength(3);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(true);
      expect(result.results[2].success).toBe(true);
      expect(result.finalOutput).toContain('数据分析专家');
    });

    it('应该将前一个 Agent 的输出作为下一个的输入', async () => {
      const router = new MoARouter([...sampleAgents]);
      const callOrder: string[] = [];
      const executor = vi.fn().mockImplementation((agent: AgentProfile, input: string) => {
        callOrder.push(`${agent.name}:${input}`);
        return Promise.resolve(`${agent.name}-输出`);
      });

      await router.executeSerial('任务A', executor);

      expect(callOrder[0]).toBe('代码专家:任务A');
      expect(callOrder[1]).toBe('写作专家:代码专家-输出');
      expect(callOrder[2]).toBe('数据分析专家:写作专家-输出');
    });

    it('某个 Agent 失败时应该停止执行', async () => {
      const router = new MoARouter([...sampleAgents]);
      const executor = vi.fn()
        .mockResolvedValueOnce('第一步完成')
        .mockRejectedValueOnce(new Error('第二步失败'))
        .mockResolvedValueOnce('第三步完成');

      const result = await router.executeSerial('测试', executor);

      expect(executor).toHaveBeenCalledTimes(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
      expect(result.results[1].error).toContain('第二步失败');
      expect(result.finalOutput).toBe('第一步完成');
    });
  });

  describe('并行执行 (executeParallel)', () => {
    it('应该并行执行所有 Agent', async () => {
      const router = new MoARouter([...sampleAgents]);
      const executor = vi.fn().mockImplementation((agent: AgentProfile, input: string) => {
        return Promise.resolve(`${agent.name} 的结果`);
      });

      const result = await router.executeParallel('测试任务', executor);

      expect(executor).toHaveBeenCalledTimes(3);
      expect(result.results).toHaveLength(3);
      expect(result.results.every(r => r.success)).toBe(true);
    });

    it('应该使用 first 聚合方式返回第一个结果', async () => {
      const router = new MoARouter([...sampleAgents]);
      const executor = vi.fn().mockImplementation((agent: AgentProfile) => {
        return Promise.resolve(`${agent.name}-结果`);
      });

      const result = await router.executeParallel('测试', executor, 'first');
      expect(result.finalOutput).toBe('代码专家-结果');
    });

    it('应该使用 all 聚合方式返回所有结果', async () => {
      const router = new MoARouter([...sampleAgents]);
      const executor = vi.fn().mockImplementation((agent: AgentProfile) => {
        return Promise.resolve(`${agent.name}-结果`);
      });

      const result = await router.executeParallel('测试', executor, 'all');
      expect(result.finalOutput).toContain('代码专家');
      expect(result.finalOutput).toContain('写作专家');
      expect(result.finalOutput).toContain('数据分析专家');
    });

    it('应该使用 vote 聚合方式返回多数结果', async () => {
      const router = new MoARouter([...sampleAgents]);
      const executor = vi.fn()
        .mockResolvedValueOnce('答案A')
        .mockResolvedValueOnce('答案A')
        .mockResolvedValueOnce('答案B');

      const result = await router.executeParallel('测试', executor, 'vote');
      expect(result.finalOutput).toBe('答案A');
    });

    it('部分 Agent 失败时应该忽略失败结果', async () => {
      const router = new MoARouter([...sampleAgents]);
      const executor = vi.fn()
        .mockResolvedValueOnce('成功结果')
        .mockRejectedValueOnce(new Error('失败'))
        .mockResolvedValueOnce('另一个成功');

      const result = await router.executeParallel('测试', executor, 'first');
      expect(result.results).toHaveLength(3);
      expect(result.results.filter(r => r.success)).toHaveLength(2);
      expect(result.results.filter(r => !r.success)).toHaveLength(1);
      expect(result.finalOutput).toBeTruthy();
    });

    it('所有 Agent 都失败时返回空字符串', async () => {
      const router = new MoARouter([...sampleAgents]);
      const executor = vi.fn().mockRejectedValue(new Error('全部失败'));

      const result = await router.executeParallel('测试', executor);
      expect(result.finalOutput).toBe('');
    });
  });

  describe('路由执行 (executeRouter)', () => {
    it('应该先路由再执行选中的 Agent', async () => {
      const router = new MoARouter([...sampleAgents]);
      const executor = vi.fn().mockImplementation((agent: AgentProfile) => {
        return Promise.resolve(`${agent.name} 完成任务`);
      });

      const result = await router.executeRouter('帮我写一段代码', executor, 'intent');

      expect(result.routing.length).toBeGreaterThan(0);
      expect(result.routing[0].agent.id).toBe('code-agent');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].agentId).toBe('code-agent');
      expect(result.results[0].success).toBe(true);
      expect(result.finalOutput).toContain('代码专家');
    });

    it('应该支持关键词路由策略', async () => {
      const router = new MoARouter([...sampleAgents]);
      const executor = vi.fn().mockResolvedValue('完成');

      const result = await router.executeRouter('报表和图表', executor, 'keyword');
      expect(result.results[0].agentId).toBe('analysis-agent');
    });

    it('空 Agent 列表应该返回空结果', async () => {
      const router = new MoARouter();
      const executor = vi.fn().mockResolvedValue('完成');

      const result = await router.executeRouter('测试', executor);
      expect(result.results).toHaveLength(0);
      expect(result.finalOutput).toBe('');
    });

    it('Agent 执行失败时应该正确记录错误', async () => {
      const router = new MoARouter([...sampleAgents]);
      const executor = vi.fn().mockRejectedValue(new Error('执行出错'));

      const result = await router.executeRouter('写代码', executor, 'intent');
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain('执行出错');
      expect(result.finalOutput).toBe('');
    });
  });
});

describe('subAgentNodeExecutor - 子 Agent 节点执行器', () => {
  it('应该能够执行 single 模式的子 Agent 节点', async () => {
    const { subAgentNodeExecutor } = await import('../../workflowExecutors');

    const mockLLMExecutor = vi.fn().mockResolvedValue('这是子 Agent 的回答');

    const node = {
      id: 'sub-agent-1',
      type: 'subagent',
      position: { x: 0, y: 0 },
      data: {
        label: '子 Agent 测试',
        type: 'subagent',
        subagentConfig: {
          mode: 'single',
          agents: [
            {
              id: 'agent-1',
              name: '测试 Agent',
              systemPrompt: '你是一个测试助手。',
              model: 'gpt-4o',
            },
          ],
          outputVariable: 'sub_result',
        },
      },
    } as any;

    const context = {
      variables: { input: '你好，请介绍自己' },
      nodeOutputs: {},
      llmExecutor: mockLLMExecutor,
    };

    const result = await subAgentNodeExecutor(node, context);

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output!.sub_result).toBeDefined();
    expect(result.output!.sub_result_results).toBeDefined();
    expect(result.output!.sub_result_results).toHaveLength(1);
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.mode).toBe('single');
  });

  it('应该能够执行 router 模式的子 Agent 节点', async () => {
    const { subAgentNodeExecutor } = await import('../../workflowExecutors');

    const mockLLMExecutor = vi.fn().mockResolvedValue('回答');

    const node = {
      id: 'sub-agent-2',
      type: 'subagent',
      position: { x: 0, y: 0 },
      data: {
        label: '路由测试',
        type: 'subagent',
        subagentConfig: {
          mode: 'router',
          routerStrategy: 'intent',
          agents: [
            {
              id: 'code',
              name: '代码专家',
              systemPrompt: '代码专家',
              specialties: ['编程', '代码'],
              keywords: ['代码', '编程'],
            },
            {
              id: 'write',
              name: '写作专家',
              systemPrompt: '写作专家',
              specialties: ['写作', '文案'],
              keywords: ['文章', '写作'],
            },
          ],
          outputVariable: 'router_result',
        },
      },
    } as any;

    const context = {
      variables: { input: '帮我写一段代码' },
      nodeOutputs: {},
      llmExecutor: mockLLMExecutor,
    };

    const result = await subAgentNodeExecutor(node, context);

    expect(result.success).toBe(true);
    expect(result.output!.router_result_routing).toBeDefined();
    expect(result.metadata!.mode).toBe('router');
  });

  it('应该能够执行 parallel 模式的子 Agent 节点', async () => {
    const { subAgentNodeExecutor } = await import('../../workflowExecutors');

    const mockLLMExecutor = vi.fn().mockResolvedValue('并行结果');

    const node = {
      id: 'sub-agent-3',
      type: 'subagent',
      position: { x: 0, y: 0 },
      data: {
        label: '并行测试',
        type: 'subagent',
        subagentConfig: {
          mode: 'parallel',
          aggregationMethod: 'all',
          agents: [
            {
              id: 'a1',
              name: 'Agent 1',
              systemPrompt: '助手1',
            },
            {
              id: 'a2',
              name: 'Agent 2',
              systemPrompt: '助手2',
            },
          ],
          outputVariable: 'parallel_result',
        },
      },
    } as any;

    const context = {
      variables: { input: '并行测试输入' },
      nodeOutputs: {},
      llmExecutor: mockLLMExecutor,
    };

    const result = await subAgentNodeExecutor(node, context);

    expect(result.success).toBe(true);
    expect(result.output!.parallel_result_results).toHaveLength(2);
    expect(result.metadata!.mode).toBe('parallel');
    expect(result.metadata!.aggregationMethod).toBe('all');
  });

  it('空 Agent 列表应该返回错误', async () => {
    const { subAgentNodeExecutor } = await import('../../workflowExecutors');

    const node = {
      id: 'sub-agent-4',
      type: 'subagent',
      position: { x: 0, y: 0 },
      data: {
        label: '空 Agent 测试',
        type: 'subagent',
        subagentConfig: {
          mode: 'single',
          agents: [],
          outputVariable: 'result',
        },
      },
    } as any;

    const context = {
      variables: { input: '测试' },
      nodeOutputs: {},
      llmExecutor: vi.fn(),
    };

    const result = await subAgentNodeExecutor(node, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('子 Agent 列表不能为空');
  });

  it('应该支持变量解析', async () => {
    const { subAgentNodeExecutor } = await import('../../workflowExecutors');

    let capturedInput = '';
    const mockLLMExecutor = vi.fn().mockImplementation(async (config: any) => {
      capturedInput = config.userPrompt;
      return '回答';
    });

    const node = {
      id: 'sub-agent-5',
      type: 'subagent',
      position: { x: 0, y: 0 },
      data: {
        label: '变量测试',
        type: 'subagent',
        subagentConfig: {
          mode: 'single',
          agents: [
            {
              id: 'a1',
              name: '测试 Agent',
              systemPrompt: '系统提示',
            },
          ],
          inputVariable: '{{myVar}}',
          outputVariable: 'result',
        },
      },
    } as any;

    const context = {
      variables: { myVar: 'Hello World' },
      nodeOutputs: {},
      llmExecutor: mockLLMExecutor,
    };

    const result = await subAgentNodeExecutor(node, context);

    expect(result.success).toBe(true);
  });

  it('getNodeExecutor 应该返回 subagent 执行器', async () => {
    const { getNodeExecutor } = await import('../../workflowExecutors');

    const executor = getNodeExecutor('subagent');
    expect(executor).toBeDefined();
    expect(typeof executor).toBe('function');
  });

  it('getNodeExecutor 应该也支持 sub_agent 类型名', async () => {
    const { getNodeExecutor } = await import('../../workflowExecutors');

    const executor = getNodeExecutor('sub_agent');
    expect(executor).toBeDefined();
  });
});
