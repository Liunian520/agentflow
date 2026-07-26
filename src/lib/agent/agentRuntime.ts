import type { MemoryService } from '../memory/memoryService';
import type { ToolSearchEngine } from '../toolSearch';

export interface AgentModelConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt: string;
}

export interface AgentMemoryConfig {
  enabled: boolean;
  namespace?: string;
}

export interface AgentConfig {
  name?: string;
  description?: string;
  model: AgentModelConfig;
  tools: string[];
  memory?: AgentMemoryConfig;
  maxIterations?: number;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: AgentToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export interface AgentThoughtStep {
  iteration: number;
  type: 'think' | 'action' | 'observation' | 'final';
  content: string;
  toolCalls?: AgentToolCall[];
  toolResults?: Record<string, any>;
  timestamp: number;
}

export interface AgentRunResult {
  success: boolean;
  finalAnswer: string;
  thoughtSteps: AgentThoughtStep[];
  toolCallHistory: Array<{
    toolName: string;
    toolArgs: Record<string, any>;
    result: any;
    iteration: number;
  }>;
  totalIterations: number;
  error?: string;
}

export type LLMExecutorFunction = (config: {
  model: string;
  systemPrompt?: string;
  messages: AgentMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: any[];
}) => Promise<{
  content: string;
  toolCalls?: AgentToolCall[];
}>;

export type MCPToolExecutorFunction = (config: {
  serverId?: string;
  toolName: string;
  arguments?: Record<string, any>;
}) => Promise<any>;

export interface AgentRuntimeOptions {
  llmExecutor: LLMExecutorFunction;
  mcpToolExecutor?: MCPToolExecutorFunction;
  memoryService?: MemoryService;
  toolSearchEngine?: ToolSearchEngine;
  onThoughtStep?: (step: AgentThoughtStep) => void;
  onToolCall?: (toolCall: AgentToolCall) => void;
  onToolResult?: (toolCallId: string, result: any) => void;
}

export class AgentRuntime {
  private config: AgentConfig;
  private options: AgentRuntimeOptions;
  private messages: AgentMessage[] = [];
  private thoughtSteps: AgentThoughtStep[] = [];
  private toolCallHistory: Array<{
    toolName: string;
    toolArgs: Record<string, any>;
    result: any;
    iteration: number;
  }> = [];
  private iterationCount = 0;

  constructor(config: AgentConfig, options: AgentRuntimeOptions) {
    this.config = {
      ...config,
      maxIterations: config.maxIterations ?? 10,
    };
    this.options = options;
  }

  async run(userInput: string, contextVariables: Record<string, any> = {}): Promise<AgentRunResult> {
    this.messages = [];
    this.thoughtSteps = [];
    this.toolCallHistory = [];
    this.iterationCount = 0;

    const systemPrompt = await this.buildSystemPrompt(contextVariables);
    this.messages.push({ role: 'system', content: systemPrompt });
    this.messages.push({ role: 'user', content: userInput });

    try {
      while (this.iterationCount < this.config.maxIterations!) {
        this.iterationCount++;

        const thinkStep: AgentThoughtStep = {
          iteration: this.iterationCount,
          type: 'think',
          content: `第 ${this.iterationCount} 轮思考...`,
          timestamp: Date.now(),
        };
        this.thoughtSteps.push(thinkStep);
        this.options.onThoughtStep?.(thinkStep);

        const response = await this.options.llmExecutor({
          model: this.config.model.model,
          systemPrompt: this.config.model.systemPrompt,
          messages: this.messages,
          temperature: this.config.model.temperature,
          maxTokens: this.config.model.maxTokens,
          tools: await this.buildToolDefinitions(),
        });

        if (!response.toolCalls || response.toolCalls.length === 0) {
          const finalStep: AgentThoughtStep = {
            iteration: this.iterationCount,
            type: 'final',
            content: response.content,
            timestamp: Date.now(),
          };
          this.thoughtSteps.push(finalStep);
          this.options.onThoughtStep?.(finalStep);

          this.messages.push({ role: 'assistant', content: response.content });

          if (this.config.memory?.enabled) {
            await this.saveToMemory(userInput, response.content, contextVariables);
          }

          return {
            success: true,
            finalAnswer: response.content,
            thoughtSteps: this.thoughtSteps,
            toolCallHistory: this.toolCallHistory,
            totalIterations: this.iterationCount,
          };
        }

        const actionStep: AgentThoughtStep = {
          iteration: this.iterationCount,
          type: 'action',
          content: `调用 ${response.toolCalls.length} 个工具`,
          toolCalls: response.toolCalls,
          timestamp: Date.now(),
        };
        this.thoughtSteps.push(actionStep);
        this.options.onThoughtStep?.(actionStep);

        this.messages.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: response.toolCalls,
        });

        const toolResults: Record<string, any> = {};

        for (const toolCall of response.toolCalls) {
          this.options.onToolCall?.(toolCall);

          let toolResult: any;
          try {
            if (this.options.mcpToolExecutor) {
              toolResult = await this.options.mcpToolExecutor({
                toolName: toolCall.name,
                arguments: toolCall.arguments,
              });
            } else {
              toolResult = { content: `[Mock Tool] ${toolCall.name}` };
            }
          } catch (err: any) {
            toolResult = { error: err?.message || '工具执行失败' };
          }

          toolResults[toolCall.id] = toolResult;
          this.options.onToolResult?.(toolCall.id, toolResult);

          this.toolCallHistory.push({
            toolName: toolCall.name,
            toolArgs: toolCall.arguments,
            result: toolResult,
            iteration: this.iterationCount,
          });

          this.messages.push({
            role: 'tool',
            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
            toolCallId: toolCall.id,
            toolName: toolCall.name,
          });
        }

        const observationStep: AgentThoughtStep = {
          iteration: this.iterationCount,
          type: 'observation',
          content: `工具执行完成，共 ${response.toolCalls.length} 个`,
          toolResults,
          timestamp: Date.now(),
        };
        this.thoughtSteps.push(observationStep);
        this.options.onThoughtStep?.(observationStep);
      }

      return {
        success: false,
        finalAnswer: '',
        thoughtSteps: this.thoughtSteps,
        toolCallHistory: this.toolCallHistory,
        totalIterations: this.iterationCount,
        error: `超过最大迭代次数 (${this.config.maxIterations})，可能存在死循环`,
      };
    } catch (err: any) {
      return {
        success: false,
        finalAnswer: '',
        thoughtSteps: this.thoughtSteps,
        toolCallHistory: this.toolCallHistory,
        totalIterations: this.iterationCount,
        error: err?.message || 'Agent 执行失败',
      };
    }
  }

  private async buildSystemPrompt(contextVariables: Record<string, any>): Promise<string> {
    let systemPrompt = this.config.model.systemPrompt || '';

    if (this.config.memory?.enabled && this.options.memoryService) {
      const memoryContext = await this.recallFromMemory(contextVariables);
      if (memoryContext) {
        systemPrompt += `\n\n【记忆上下文】\n${memoryContext}`;
      }
    }

    systemPrompt += `\n\n【ReAct 循环说明】
你可以使用提供的工具来完成任务。请按照以下思考模式工作：
1. 思考：分析用户需求，确定是否需要调用工具
2. 行动：如果需要工具，调用合适的工具
3. 观察：获取工具执行结果
4. 循环：根据结果继续思考，直到能够给出最终答案

当你认为已经收集到足够信息可以回答用户问题时，请直接给出最终回答，不要再调用工具。`;

    return systemPrompt;
  }

  private async buildToolDefinitions(): Promise<any[] | undefined> {
    if (!this.config.tools || this.config.tools.length === 0) {
      return undefined;
    }

    const tools: any[] = [];
    for (const toolName of this.config.tools) {
      tools.push({
        type: 'function',
        function: {
          name: toolName,
          description: `Tool: ${toolName}`,
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      });
    }

    return tools;
  }

  private async recallFromMemory(contextVariables: Record<string, any>): Promise<string> {
    if (!this.options.memoryService || !this.config.memory?.enabled) {
      return '';
    }

    const namespace = this.config.memory.namespace || 'agent';
    const query = Object.values(contextVariables).filter(v => typeof v === 'string').join(' ') || '';

    try {
      const results = await this.options.memoryService.search(query, { limit: 5 });
      if (results.length === 0) return '';

      return results
        .map((item, idx) => `${idx + 1}. ${item.key}: ${typeof item.value === 'string' ? item.value : JSON.stringify(item.value)}`)
        .join('\n');
    } catch {
      return '';
    }
  }

  private async saveToMemory(
    userInput: string,
    finalAnswer: string,
    contextVariables: Record<string, any>
  ): Promise<void> {
    if (!this.options.memoryService || !this.config.memory?.enabled) {
      return;
    }

    const namespace = this.config.memory.namespace || 'agent';
    const key = `${namespace}:${Date.now()}`;

    try {
      await this.options.memoryService.save(
        key,
        { userInput, finalAnswer, contextVariables },
        { agent: this.config.name || 'agent', type: 'conversation' },
        [namespace, 'conversation']
      );
    } catch {
      // 忽略记忆保存错误
    }
  }

  getMessages(): AgentMessage[] {
    return [...this.messages];
  }

  getThoughtSteps(): AgentThoughtStep[] {
    return [...this.thoughtSteps];
  }

  getToolCallHistory() {
    return [...this.toolCallHistory];
  }

  getIterationCount(): number {
    return this.iterationCount;
  }
}
