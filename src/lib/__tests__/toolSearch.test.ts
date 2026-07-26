import { describe, it, expect } from 'vitest';
import { ToolSearchEngine, type SearchableTool } from '../toolSearch';

const mockTools: SearchableTool[] = [
  {
    name: 'web_search',
    description: 'Search the web for information on any topic',
    keywords: ['search', 'web', 'internet', 'google', 'browse'],
    serverId: 'server1',
    serverName: 'Web Tools',
  },
  {
    name: 'get_weather',
    description: 'Get current weather forecast for a location',
    keywords: ['weather', 'forecast', 'temperature', 'rain', 'city'],
    serverId: 'server1',
    serverName: 'Web Tools',
  },
  {
    name: 'send_email',
    description: 'Send an email to a recipient with subject and body',
    keywords: ['email', 'mail', 'send', 'message', 'notification'],
    serverId: 'server2',
    serverName: 'Communication',
  },
  {
    name: 'read_file',
    description: 'Read contents of a file from the filesystem',
    keywords: ['file', 'read', 'filesystem', 'text', 'document'],
    serverId: 'server3',
    serverName: 'File System',
  },
  {
    name: 'write_file',
    description: 'Write content to a file in the filesystem',
    keywords: ['file', 'write', 'filesystem', 'save', 'create'],
    serverId: 'server3',
    serverName: 'File System',
  },
  {
    name: 'calculate_math',
    description: 'Calculate mathematical expressions and equations',
    keywords: ['math', 'calculate', 'equation', 'numbers', 'arithmetic'],
    serverId: 'server1',
    serverName: 'Web Tools',
  },
];

describe('toolSearch - ToolSearchEngine', () => {
  describe('basic functionality', () => {
    it('should initialize with empty tools', () => {
      const engine = new ToolSearchEngine();
      expect(engine.getAllTools()).toEqual([]);
    });

    it('should initialize with provided tools', () => {
      const engine = new ToolSearchEngine(mockTools);
      expect(engine.getAllTools()).toHaveLength(mockTools.length);
    });

    it('should add a single tool', () => {
      const engine = new ToolSearchEngine();
      engine.addTool(mockTools[0]);
      expect(engine.getAllTools()).toHaveLength(1);
      expect(engine.getAllTools()[0].name).toBe('web_search');
    });

    it('should set tools replacing existing ones', () => {
      const engine = new ToolSearchEngine(mockTools);
      expect(engine.getAllTools()).toHaveLength(mockTools.length);
      engine.setTools([mockTools[0]]);
      expect(engine.getAllTools()).toHaveLength(1);
    });
  });

  describe('search relevance ranking', () => {
    it('should return all tools with score 0 for empty query', () => {
      const engine = new ToolSearchEngine(mockTools);
      const results = engine.search('');
      expect(results).toHaveLength(mockTools.length);
      results.forEach((r) => {
        expect(r.score).toBe(0);
      });
    });

    it('should rank exact name match highest', () => {
      const engine = new ToolSearchEngine(mockTools);
      const results = engine.search('web_search');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].tool.name).toBe('web_search');
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should rank name prefix match highly', () => {
      const engine = new ToolSearchEngine(mockTools);
      const results = engine.search('web');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].tool.name).toContain('web');
    });

    it('should find tools by description keywords', () => {
      const engine = new ToolSearchEngine(mockTools);
      const results = engine.search('weather forecast');
      expect(results.length).toBeGreaterThan(0);
      const weatherTool = results.find((r) => r.tool.name === 'get_weather');
      expect(weatherTool).toBeDefined();
      expect(weatherTool!.score).toBeGreaterThan(0);
    });

    it('should find tools by custom keywords', () => {
      const engine = new ToolSearchEngine(mockTools);
      const results = engine.search('temperature');
      expect(results.length).toBeGreaterThan(0);
      const weatherTool = results.find((r) => r.tool.name === 'get_weather');
      expect(weatherTool).toBeDefined();
    });

    it('should return top-K results', () => {
      const engine = new ToolSearchEngine(mockTools);
      const results = engine.search('file', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('should return matched terms', () => {
      const engine = new ToolSearchEngine(mockTools);
      const results = engine.search('weather');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].matchedTerms.length).toBeGreaterThan(0);
    });

    it('should handle multi-word queries', () => {
      const engine = new ToolSearchEngine(mockTools);
      const results = engine.search('send email message');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].tool.name).toBe('send_email');
    });

    it('should rank file operations correctly for file query', () => {
      const engine = new ToolSearchEngine(mockTools);
      const results = engine.search('file');
      const fileTools = results.filter((r) =>
        ['read_file', 'write_file'].includes(r.tool.name)
      );
      expect(fileTools.length).toBe(2);
    });

    it('should handle case insensitivity', () => {
      const engine = new ToolSearchEngine(mockTools);
      const results1 = engine.search('WEB_SEARCH');
      const results2 = engine.search('web_search');
      expect(results1[0].tool.name).toBe(results2[0].tool.name);
      expect(results1[0].score).toBe(results2[0].score);
    });
  });

  describe('MCP tools integration', () => {
    it('should add MCP tools with server info', () => {
      const engine = new ToolSearchEngine();
      engine.addMCPTools('test-server', 'Test Server', [
        {
          name: 'test_tool',
          description: 'A test tool',
          inputSchema: {
            type: 'object',
            properties: {
              param1: { type: 'string', description: 'First parameter' },
            },
          },
        },
      ]);

      const tools = engine.getAllTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].serverId).toBe('test-server');
      expect(tools[0].serverName).toBe('Test Server');
    });

    it('should extract keywords from MCP tool input schema', () => {
      const engine = new ToolSearchEngine();
      engine.addMCPTools('test-server', 'Test Server', [
        {
          name: 'test_tool',
          description: 'A test tool',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'search query string' },
              limit: { type: 'number', description: 'max results count' },
            },
          },
        },
      ]);

      const results = engine.search('query');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].tool.name).toBe('test_tool');
    });
  });
});

describe('tool node - input/output mapping', () => {
  it('should resolve variable templates in tool executor', async () => {
    const { toolNodeExecutor } = await import('../workflowExecutors');
    const mockMcpExecutor = async (config: any) => ({
      content: `Hello ${config.arguments?.name || 'World'}`,
    });

    const node = {
      id: 'tool1',
      type: 'tool',
      position: { x: 0, y: 0 },
      data: {
        label: 'Test Tool',
        type: 'tool',
        iconName: 'Wrench',
        description: '',
        toolConfig: {
          toolSource: 'mcp',
          toolName: 'greet',
          mcpServerId: 'server1',
          inputMapping: {
            name: '{{userName}}',
          },
          outputMapping: {
            greeting: 'content',
          },
          outputVariable: 'tool_result',
          timeout: 10,
        },
      },
    } as any;

    const context = {
      variables: { userName: 'Alice' },
      nodeOutputs: {},
      mcpToolExecutor: mockMcpExecutor,
    };

    const result = await toolNodeExecutor(node, context);
    expect(result.success).toBe(true);
    expect(result.output?.tool_result.greeting).toBeDefined();
  });

  it('should handle tool execution failure', async () => {
    const { toolNodeExecutor } = await import('../workflowExecutors');
    const mockMcpExecutor = async () => {
      throw new Error('Tool not available');
    };

    const node = {
      id: 'tool1',
      type: 'tool',
      position: { x: 0, y: 0 },
      data: {
        label: 'Test Tool',
        type: 'tool',
        iconName: 'Wrench',
        description: '',
        toolConfig: {
          toolSource: 'mcp',
          toolName: 'failing_tool',
          outputVariable: 'tool_result',
          timeout: 5,
        },
      },
    } as any;

    const context = {
      variables: {},
      nodeOutputs: {},
      mcpToolExecutor: mockMcpExecutor,
    };

    const result = await toolNodeExecutor(node, context);
    expect(result.success).toBe(false);
    expect(result.error).toContain('工具执行失败');
  });

  it('should validate tool name is required', async () => {
    const { toolNodeExecutor } = await import('../workflowExecutors');

    const node = {
      id: 'tool1',
      type: 'tool',
      position: { x: 0, y: 0 },
      data: {
        label: 'Test Tool',
        type: 'tool',
        iconName: 'Wrench',
        description: '',
        toolConfig: {
          toolSource: 'mcp',
          toolName: '',
          outputVariable: 'tool_result',
          timeout: 5,
        },
      },
    } as any;

    const context = {
      variables: {},
      nodeOutputs: {},
    };

    const result = await toolNodeExecutor(node, context);
    expect(result.success).toBe(false);
    expect(result.error).toContain('工具名称不能为空');
  });

  it('should use mock when no executor provided', async () => {
    const { toolNodeExecutor } = await import('../workflowExecutors');

    const node = {
      id: 'tool1',
      type: 'tool',
      position: { x: 0, y: 0 },
      data: {
        label: 'Test Tool',
        type: 'tool',
        iconName: 'Wrench',
        description: '',
        toolConfig: {
          toolSource: 'mcp',
          toolName: 'test_tool',
          outputVariable: 'tool_result',
          timeout: 5,
        },
      },
    } as any;

    const context = {
      variables: { test: 'value' },
      nodeOutputs: {},
    };

    const result = await toolNodeExecutor(node, context);
    expect(result.success).toBe(true);
    expect(result.output?.tool_result).toBeDefined();
  });

  it('should support output mapping to rename fields', async () => {
    const { toolNodeExecutor } = await import('../workflowExecutors');
    const mockMcpExecutor = async () => ({
      result: { data: 'abc123', status: 'ok' },
    });

    const node = {
      id: 'tool1',
      type: 'tool',
      position: { x: 0, y: 0 },
      data: {
        label: 'Test Tool',
        type: 'tool',
        iconName: 'Wrench',
        description: '',
        toolConfig: {
          toolSource: 'mcp',
          toolName: 'get_data',
          outputMapping: {
            myData: 'result.data',
            myStatus: 'result.status',
          },
          outputVariable: 'output',
          timeout: 10,
        },
      },
    } as any;

    const context = {
      variables: {},
      nodeOutputs: {},
      mcpToolExecutor: mockMcpExecutor,
    };

    const result = await toolNodeExecutor(node, context);
    expect(result.success).toBe(true);
    expect(result.output?.output).toBeDefined();
  });
});
