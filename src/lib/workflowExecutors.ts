import type { FlowNode, NodeExecutionResult, LLMExecutorFunction, HttpExecutorFunction, MCPToolExecutorFunction, RoutingDecision, TaskFeatures } from '../types';
import { resolveVariables, resolveVariableValue } from './variableResolver';
import type { MemoryService } from './memory/memoryService';
import { AgentRuntime, type AgentMessage, type AgentToolCall } from './agent/agentRuntime';
import { MoARouter, type AgentProfile, type RouterStrategy, type AggregationMethod, type SubAgentResult } from './agent/moaRouter';
import type { WorkflowTracer } from './workflowTracer';

export interface NodeExecutorContext {
  variables: Record<string, any>;
  nodeOutputs: Record<string, Record<string, any>>;
  llmExecutor?: LLMExecutorFunction;
  httpExecutor?: HttpExecutorFunction;
  mcpToolExecutor?: MCPToolExecutorFunction;
  memoryService?: MemoryService;
  onAgentThought?: (step: any) => void;
  onAgentToolCall?: (toolCall: AgentToolCall) => void;
  onAgentToolResult?: (toolCallId: string, result: any) => void;
  tracer?: WorkflowTracer;
}

export type NodeExecutor = (
  node: FlowNode,
  context: NodeExecutorContext
) => Promise<NodeExecutionResult>;

function makeResult(
  node: FlowNode,
  success: boolean,
  startTime: number,
  output?: Record<string, any>,
  error?: string,
  metadata?: Record<string, any>
): NodeExecutionResult {
  const endTime = Date.now();
  return {
    nodeId: node.id,
    nodeName: node.data?.label || node.id,
    nodeType: (node.data?.type || node.type) as any,
    success,
    output,
    error,
    startTime,
    endTime,
    duration: endTime - startTime,
    metadata,
  };
}

function resolveTemplateInObject(
  obj: Record<string, any>,
  variables: Record<string, any>,
  nodeOutputs: Record<string, Record<string, any>>
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = resolveVariables(value, variables, { nodeOutputs });
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = resolveTemplateInObject(value, variables, nodeOutputs);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export const startNodeExecutor: NodeExecutor = async (node, context) => {
  const startTime = Date.now();
  const { variables } = context;
  const startConfig = node.data?.startConfig;
  const output: Record<string, any> = {};

  if (startConfig?.inputs && Array.isArray(startConfig.inputs)) {
    for (const input of startConfig.inputs) {
      const varName = input.name;
      if (variables[varName] !== undefined) {
        output[varName] = variables[varName];
      } else if (input.default !== undefined) {
        output[varName] = input.default;
      } else {
        output[varName] = input.type === 'number' ? 0 : input.type === 'boolean' ? false : input.type === 'object' ? {} : input.type === 'array' ? [] : '';
      }
    }
  }

  return makeResult(node, true, startTime, output);
};

export const endNodeExecutor: NodeExecutor = async (node, context) => {
  const startTime = Date.now();
  const { variables, nodeOutputs } = context;
  const endConfig = node.data?.endConfig;
  const output: Record<string, any> = {};

  if (endConfig?.outputs && Array.isArray(endConfig.outputs)) {
    for (const out of endConfig.outputs) {
      const resolved = resolveVariables(out.value || '', variables, { nodeOutputs });
      output[out.name] = resolved;
    }
  }

  return makeResult(node, true, startTime, output);
};

export const llmNodeExecutor: NodeExecutor = async (node, context) => {
  const startTime = Date.now();
  const { variables, nodeOutputs, llmExecutor, tracer } = context;
  const llmConfig = node.data?.llmConfig;
  const outputVar = llmConfig?.outputVariable || 'llm_output';

  try {
    const systemPrompt = llmConfig?.systemPrompt
      ? resolveVariables(llmConfig.systemPrompt, variables, { nodeOutputs })
      : '';
    const userPrompt = llmConfig?.userPrompt
      ? resolveVariables(llmConfig.userPrompt, variables, { nodeOutputs })
      : '';

    if (tracer) {
      tracer.startSpan('LLM Call', 'llm', { systemPrompt, userPrompt }, {
        model: llmConfig?.model,
        temperature: llmConfig?.temperature,
        maxTokens: llmConfig?.maxTokens,
      });
    }

    let result: string;

    if (llmExecutor) {
      result = await llmExecutor({
        model: llmConfig?.model,
        systemPrompt,
        userPrompt,
        temperature: llmConfig?.temperature,
        maxTokens: llmConfig?.maxTokens,
        variables,
      });
    } else {
      result = `[Mock LLM] system=${systemPrompt.slice(0, 50)} user=${userPrompt.slice(0, 50)}`;
    }

    if (tracer) {
      tracer.endActiveSpan({ result });
    }

    const output: Record<string, any> = {};
    output[outputVar] = result;
    return makeResult(node, true, startTime, output, undefined, {
      model: llmConfig?.model,
      temperature: llmConfig?.temperature,
    });
  } catch (err: any) {
    if (tracer) {
      tracer.endActiveSpan(undefined, err?.message || 'LLM 调用失败');
    }
    return makeResult(node, false, startTime, undefined, err?.message || 'LLM 调用失败');
  }
};

function evalConditionExpression(expr: string, vars: Record<string, any>): boolean {
  if (!expr || !expr.trim()) return false;
  try {
    const normalized = expr.replace(/\{\{\s*([\w.$]+)\s*\}\}/g, (_m, k) => `__vars[${JSON.stringify(k)}]`);
    const keys = Object.keys(vars).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
    const header = keys.map((k) => `var ${k} = __vars[${JSON.stringify(k)}];`).join('');
    const fn = new Function('__vars', `"use strict"; ${header} try { return !!(${normalized}); } catch(_e) { return false; }`);
    return fn(vars);
  } catch {
    return false;
  }
}

export const conditionNodeExecutor: NodeExecutor = async (node, context) => {
  const startTime = Date.now();
  const { variables, nodeOutputs } = context;
  const conditionConfig = node.data?.conditionConfig;
  const conditions = conditionConfig?.conditions || [];
  const defaultLabel = conditionConfig?.defaultLabel || 'default';

  const allVars = { ...variables };
  for (const [nodeId, outputs] of Object.entries(nodeOutputs)) {
    allVars[nodeId] = outputs;
  }

  let matchedLabel: string = defaultLabel;
  for (const cond of conditions) {
    if (evalConditionExpression(cond.expression, allVars)) {
      matchedLabel = cond.label;
      break;
    }
  }

  return makeResult(node, true, startTime, {
    matchedBranch: matchedLabel,
    matchedLabel,
  });
};

export const loopNodeExecutor: NodeExecutor = async (node, context) => {
  const startTime = Date.now();
  const { variables, nodeOutputs } = context;
  const loopConfig = node.data?.loopConfig;
  const loopType = loopConfig?.loopType || 'count';

  let items: any[] = [];

  if (loopType === 'array') {
    const arrayVar = loopConfig?.arrayVariable || '';
    const arrayValue = resolveVariableValue(arrayVar, variables, { nodeOutputs });
    if (Array.isArray(arrayValue)) {
      items = arrayValue;
    } else if (typeof arrayValue === 'string') {
      try {
        const parsed = JSON.parse(arrayValue);
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        items = arrayValue.split(',').map((s) => s.trim());
      }
    }
  } else {
    const count = loopConfig?.count || 0;
    for (let i = 0; i < count; i++) {
      items.push(i);
    }
  }

  return makeResult(node, true, startTime, {
    items,
    itemCount: items.length,
    itemVariable: loopConfig?.itemVariable || 'item',
    indexVariable: loopConfig?.indexVariable || 'index',
  });
};

export const codeNodeExecutor: NodeExecutor = async (node, context) => {
  const startTime = Date.now();
  const { variables, nodeOutputs } = context;
  const codeConfig = node.data?.codeConfig;
  const language = codeConfig?.language || 'javascript';
  const code = codeConfig?.code || '';
  const outputVar = codeConfig?.outputVariable || 'code_output';
  const inputVariables = codeConfig?.inputVariables || [];

  if (language !== 'javascript') {
    return makeResult(node, false, startTime, undefined, `不支持的语言: ${language}，仅支持 javascript`);
  }

  try {
    const inputVars: Record<string, any> = {};
    for (const varName of inputVariables) {
      inputVars[varName] = variables[varName];
    }

    const allVars = { ...variables };
    for (const [nid, outputs] of Object.entries(nodeOutputs)) {
      allVars[nid] = outputs;
    }

    const resolvedCode = resolveVariables(code, allVars, { nodeOutputs });

    const sandbox = {
      ...inputVars,
      console: { log: () => {} },
      Math,
      JSON,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
    };

    const fnBody = `
      "use strict";
      ${Object.keys(sandbox).map((k) => `var ${k} = __sandbox["${k}"];`).join('\n')}
      ${resolvedCode}
      return typeof __result !== 'undefined' ? __result : undefined;
    `;

    const fn = new Function('__sandbox', fnBody);
    const result = fn(sandbox);

    const output: Record<string, any> = {};
    output[outputVar] = result;

    return makeResult(node, true, startTime, output);
  } catch (err: any) {
    return makeResult(node, false, startTime, undefined, `代码执行错误: ${err?.message || '未知错误'}`);
  }
};

export const httpNodeExecutor: NodeExecutor = async (node, context) => {
  const startTime = Date.now();
  const { variables, nodeOutputs, httpExecutor } = context;
  const httpConfig = node.data?.httpConfig;
  const outputVar = httpConfig?.outputVariable || 'http_output';

  try {
    const method = httpConfig?.method || 'GET';
    const url = resolveVariables(httpConfig?.url || '', variables, { nodeOutputs });
    const headers = httpConfig?.headers ? resolveTemplateInObject(httpConfig.headers, variables, nodeOutputs) : {};
    const bodyType = httpConfig?.bodyType || 'raw';
    let body = httpConfig?.body || '';

    if (body && typeof body === 'string') {
      body = resolveVariables(body, variables, { nodeOutputs });
    }

    if (bodyType === 'json' && body && typeof body === 'string') {
      try {
        JSON.parse(body);
      } catch {
        body = JSON.stringify(body);
      }
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    } else if (bodyType === 'form' && body && typeof body === 'object') {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) {
        params.append(k, String(v));
      }
      body = params.toString();
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    }

    const timeout = httpConfig?.timeout || 30000;
    const responseType = httpConfig?.responseType || 'auto';

    let response: { status: number; data: any; headers: Record<string, string> };

    if (httpExecutor) {
      response = await httpExecutor({ method, url, headers, body: typeof body === 'string' ? body : undefined, timeout });
    } else {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const fetchOptions: RequestInit = {
          method,
          headers: headers as Record<string, string>,
          signal: controller.signal,
        };

        if (method !== 'GET' && method !== 'HEAD' && body) {
          fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        }

        const res = await fetch(url, fetchOptions);
        clearTimeout(timer);

        const contentType = res.headers.get('content-type') || '';
        let data: any;

        if (responseType === 'json') {
          try {
            data = await res.json();
          } catch {
            data = await res.text();
          }
        } else if (responseType === 'text') {
          data = await res.text();
        } else if (responseType === 'blob') {
          const blob = await res.blob();
          data = {
            type: blob.type,
            size: blob.size,
            blob,
          };
        } else {
          if (contentType.includes('application/json')) {
            try {
              data = await res.json();
            } catch {
              data = await res.text();
            }
          } else if (contentType.startsWith('text/')) {
            data = await res.text();
          } else {
            const blob = await res.blob();
            data = {
              type: blob.type,
              size: blob.size,
              blob,
            };
          }
        }

        const respHeaders: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          respHeaders[key] = value;
        });

        response = { status: res.status, data, headers: respHeaders };
      } catch (fetchErr: any) {
        if (fetchErr?.name === 'AbortError') {
          return makeResult(node, false, startTime, undefined, `HTTP 请求超时 (${timeout / 1000}s)`);
        }
        return makeResult(node, false, startTime, undefined, `HTTP 请求失败: ${fetchErr?.message || '未知错误'}`);
      }
    }

    const output: Record<string, any> = {};
    output[outputVar] = response;

    return makeResult(node, true, startTime, output, undefined, {
      status: response.status,
      url,
      method,
    });
  } catch (err: any) {
    return makeResult(node, false, startTime, undefined, err?.message || 'HTTP 节点执行失败');
  }
};

export const variableNodeExecutor: NodeExecutor = async (node, context) => {
  const startTime = Date.now();
  const { variables, nodeOutputs } = context;
  const varConfig = node.data?.variableConfig;
  const operation = varConfig?.operation || 'set';
  const varName = varConfig?.variableName || 'result';
  const rawValue = varConfig?.value || '';
  const valueType = varConfig?.valueType || 'string';

  const resolvedValue = resolveVariables(rawValue, variables, { nodeOutputs });

  let finalValue: any;
  switch (valueType) {
    case 'number':
      finalValue = Number(resolvedValue) || 0;
      break;
    case 'boolean':
      finalValue = resolvedValue === 'true' || resolvedValue === '1';
      break;
    case 'object':
    case 'array':
      try {
        finalValue = JSON.parse(resolvedValue);
      } catch {
        finalValue = valueType === 'array' ? [] : {};
      }
      break;
    default:
      finalValue = resolvedValue;
  }

  const output: Record<string, any> = {};
  const currentValue = variables[varName];

  switch (operation) {
    case 'set':
      output[varName] = finalValue;
      break;
    case 'append':
      if (Array.isArray(currentValue)) {
        output[varName] = [...currentValue, finalValue];
      } else if (typeof currentValue === 'string') {
        output[varName] = currentValue + finalValue;
      } else {
        output[varName] = finalValue;
      }
      break;
    case 'increment':
      output[varName] = (typeof currentValue === 'number' ? currentValue : 0) + (typeof finalValue === 'number' ? finalValue : Number(finalValue) || 1);
      break;
    case 'decrement':
      output[varName] = (typeof currentValue === 'number' ? currentValue : 0) - (typeof finalValue === 'number' ? finalValue : Number(finalValue) || 1);
      break;
    default:
      output[varName] = finalValue;
  }

  return makeResult(node, true, startTime, output);
};

function applyMapping(
  source: Record<string, any>,
  mapping: Record<string, string> | undefined,
  variables: Record<string, any>,
  nodeOutputs: Record<string, Record<string, any>>
): Record<string, any> {
  if (!mapping || Object.keys(mapping).length === 0) {
    return source;
  }
  const result: Record<string, any> = {};
  for (const [targetKey, sourceExpr] of Object.entries(mapping)) {
    if (typeof sourceExpr === 'string' && sourceExpr.includes('{{')) {
      result[targetKey] = resolveVariables(sourceExpr, variables, { nodeOutputs });
    } else if (typeof sourceExpr === 'string') {
      const val = resolveVariableValue(sourceExpr, variables, { nodeOutputs });
      result[targetKey] = val !== undefined ? val : source[sourceExpr];
    } else {
      result[targetKey] = sourceExpr;
    }
  }
  return result;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  backoffMs: number,
  backoffType: 'linear' | 'exponential' = 'linear'
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = backoffType === 'exponential' ? backoffMs * Math.pow(2, attempt) : backoffMs * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

export const toolNodeExecutor: NodeExecutor = async (node, context) => {
  const startTime = Date.now();
  const { variables, nodeOutputs, mcpToolExecutor, httpExecutor, tracer } = context;
  const toolConfig = node.data?.toolConfig;

  const toolSource = toolConfig?.toolSource || 'mcp';
  const toolName = toolConfig?.toolName || '';
  const mcpServerId = toolConfig?.mcpServerId || '';
  const inputMapping = toolConfig?.inputMapping;
  const outputMapping = toolConfig?.outputMapping;
  const timeoutMs = (toolConfig?.timeout || 30) * 1000;
  const maxRetries = toolConfig?.retryPolicy?.maxRetries ?? 0;
  const backoffType = toolConfig?.retryPolicy?.backoff || 'linear';
  const backoffMs = toolConfig?.retryPolicy?.backoffMs || 1000;
  const outputVar = toolConfig?.outputVariable || 'tool_result';

  if (!toolName) {
    return makeResult(node, false, startTime, undefined, '工具名称不能为空');
  }

  try {
    const rawInput: Record<string, any> = { ...variables };
    const toolArgs = applyMapping(rawInput, inputMapping, variables, nodeOutputs);

    if (tracer) {
      tracer.startSpan(`Tool: ${toolName}`, 'tool', { arguments: toolArgs }, {
        toolSource,
        toolName,
        mcpServerId,
        maxRetries,
      });
    }

    let toolResult: any;

    if (toolSource === 'mcp') {
      if (mcpToolExecutor) {
        const executeWithTimeout = async () => {
          let timer: ReturnType<typeof setTimeout> | null = null;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`工具调用超时 (${timeoutMs / 1000}s)`)), timeoutMs);
          });
          try {
            return await Promise.race([
              mcpToolExecutor({ serverId: mcpServerId, toolName, arguments: toolArgs }),
              timeoutPromise,
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        };

        toolResult = await withRetry(executeWithTimeout, maxRetries, backoffMs, backoffType);
      } else {
        toolResult = { content: `[Mock MCP Tool] tool=${toolName} args=${JSON.stringify(toolArgs).slice(0, 100)}` };
      }
    } else if (toolSource === 'http') {
      const httpUrl = toolConfig?.httpUrl || '';
      const httpMethod = toolConfig?.httpMethod || 'POST';
      const httpHeaders = toolConfig?.httpHeaders || {};

      if (httpExecutor) {
        const executeWithTimeout = async () => {
          return httpExecutor({
            method: httpMethod,
            url: httpUrl,
            headers: httpHeaders,
            body: JSON.stringify(toolArgs),
            timeout: timeoutMs,
          });
        };
        const resp = await withRetry(executeWithTimeout, maxRetries, backoffMs, backoffType);
        toolResult = resp.data;
      } else {
        toolResult = { mock: true, url: httpUrl, args: toolArgs };
      }
    } else {
      toolResult = { mock: true, toolName, args: toolArgs };
    }

    if (tracer) {
      tracer.endActiveSpan(toolResult);
    }

    const mappedOutput = applyMapping(toolResult, outputMapping, variables, nodeOutputs);

    const output: Record<string, any> = {};
    output[outputVar] = Object.keys(mappedOutput).length > 0 ? mappedOutput : toolResult;

    return makeResult(node, true, startTime, output, undefined, {
      toolSource,
      toolName,
      mcpServerId,
    });
  } catch (err: any) {
    if (tracer) {
      tracer.endActiveSpan(undefined, err?.message || '工具执行失败');
    }
    return makeResult(node, false, startTime, undefined, `工具执行失败: ${err?.message || '未知错误'}`);
  }
};

export const memoryReadNodeExecutor: NodeExecutor = async (node, context) => {
  const startTime = Date.now();
  const { variables, nodeOutputs, memoryService } = context;
  const memoryConfig = node.data?.memoryReadConfig || node.data?.memoryConfig;
  const key = memoryConfig?.key || '';
  const outputVar = memoryConfig?.outputVariable || 'memory_value';

  try {
    if (!memoryService) {
      return makeResult(node, false, startTime, undefined, '未配置记忆服务');
    }

    const resolvedKey = resolveVariables(key, variables, { nodeOutputs });
    if (!resolvedKey) {
      return makeResult(node, false, startTime, undefined, '记忆 key 不能为空');
    }

    const item = await memoryService.get(resolvedKey);
    const output: Record<string, any> = {};

    if (item) {
      output[outputVar] = item.value;
      output[`${outputVar}_item`] = item;
    } else {
      output[outputVar] = null;
      output[`${outputVar}_item`] = null;
    }

    return makeResult(node, true, startTime, output, undefined, {
      key: resolvedKey,
      found: !!item,
    });
  } catch (err: any) {
    return makeResult(node, false, startTime, undefined, `记忆读取失败: ${err?.message || '未知错误'}`);
  }
};

export const memoryWriteNodeExecutor: NodeExecutor = async (node, context) => {
  const startTime = Date.now();
  const { variables, nodeOutputs, memoryService } = context;
  const memoryConfig = node.data?.memoryWriteConfig || node.data?.memoryConfig;
  const key = memoryConfig?.key || '';
  const valueExpr = memoryConfig?.value || '';
  const tags = memoryConfig?.tags || [];
  const metadata = memoryConfig?.metadata || {};
  const outputVar = memoryConfig?.outputVariable || 'memory_result';

  try {
    if (!memoryService) {
      return makeResult(node, false, startTime, undefined, '未配置记忆服务');
    }

    const resolvedKey = resolveVariables(key, variables, { nodeOutputs });
    if (!resolvedKey) {
      return makeResult(node, false, startTime, undefined, '记忆 key 不能为空');
    }

    let resolvedValue: any;
    if (typeof valueExpr === 'string' && valueExpr.includes('{{')) {
      resolvedValue = resolveVariables(valueExpr, variables, { nodeOutputs });
    } else if (typeof valueExpr === 'string') {
      const varValue = resolveVariableValue(valueExpr, variables, { nodeOutputs });
      resolvedValue = varValue !== undefined ? varValue : valueExpr;
    } else {
      resolvedValue = valueExpr;
    }

    const resolvedTags = tags.map((t: string) => resolveVariables(t, variables, { nodeOutputs }));
    const resolvedMetadata = resolveTemplateInObject(metadata, variables, nodeOutputs);

    const item = await memoryService.save(resolvedKey, resolvedValue, resolvedMetadata, resolvedTags);
    const output: Record<string, any> = {};
    output[outputVar] = item;

    return makeResult(node, true, startTime, output, undefined, {
      key: resolvedKey,
    });
  } catch (err: any) {
    return makeResult(node, false, startTime, undefined, `记忆写入失败: ${err?.message || '未知错误'}`);
  }
};

export const memorySearchNodeExecutor: NodeExecutor = async (node, context) => {
  const startTime = Date.now();
  const { variables, nodeOutputs, memoryService } = context;
  const memoryConfig = node.data?.memorySearchConfig || node.data?.memoryConfig;
  const query = memoryConfig?.query || '';
  const maxResults = memoryConfig?.maxResults || 10;
  const outputVar = memoryConfig?.outputVariable || 'memory_results';

  try {
    if (!memoryService) {
      return makeResult(node, false, startTime, undefined, '未配置记忆服务');
    }

    const resolvedQuery = resolveVariables(query, variables, { nodeOutputs });
    const results = await memoryService.search(resolvedQuery, { limit: maxResults });

    const output: Record<string, any> = {};
    output[outputVar] = results;
    output[`${outputVar}_count`] = results.length;

    return makeResult(node, true, startTime, output, undefined, {
      query: resolvedQuery,
      count: results.length,
    });
  } catch (err: any) {
    return makeResult(node, false, startTime, undefined, `记忆搜索失败: ${err?.message || '未知错误'}`);
  }
};

export const agentNodeExecutor: NodeExecutor = async (node, context) => {
  const startTime = Date.now();
  const { variables, nodeOutputs, llmExecutor, mcpToolExecutor, memoryService, onAgentThought, onAgentToolCall, onAgentToolResult } = context;
  const agentConfig = node.data?.agentConfig;
  const outputVar = agentConfig?.outputVariable || 'agent_output';

  // 路由相关状态
  let routingDecision: RoutingDecision | null = null;
  let features: TaskFeatures | null = null;

  try {
    const userInput = resolveVariables('{{input}}', variables, { nodeOutputs });

    const systemPrompt = agentConfig?.systemPrompt
      ? resolveVariables(agentConfig.systemPrompt, variables, { nodeOutputs })
      : '你是一个有帮助的 AI 助手。';

    const tools = Array.isArray(agentConfig?.tools) ? agentConfig.tools : [];
    const maxIterations = agentConfig?.maxIterations ?? 10;
    const enableMemory = agentConfig?.enableMemory ?? false;
    const memoryNamespace = agentConfig?.memoryNamespace || 'agent';

    // 当 model 为 'auto' 或为空时，使用 modelRouter 自动路由
    let selectedModel = agentConfig?.model || 'gpt-4o';
    if (!agentConfig?.model || agentConfig.model === 'auto') {
      try {
        const { extractTaskFeatures, getRoutingPool, selectModel, getRouterMemorySnapshot } = await import('./modelRouter');
        features = extractTaskFeatures(userInput);
        const pool = await getRoutingPool();
        const memory = await getRouterMemorySnapshot();
        routingDecision = selectModel(features, pool, memory);
        if (routingDecision) {
          selectedModel = routingDecision.modelName;
        }
      } catch {
        // 路由失败，fallback 到默认模型
      }
    }

    const agentLLMExecutor = async (config: {
      model: string;
      systemPrompt?: string;
      messages: AgentMessage[];
      temperature?: number;
      maxTokens?: number;
      tools?: any[];
    }) => {
      if (llmExecutor) {
        const lastUserMessage = config.messages.filter(m => m.role === 'user').pop();
        const result = await llmExecutor({
          model: config.model,
          systemPrompt: config.systemPrompt,
          userPrompt: lastUserMessage?.content || '',
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          variables,
        });
        return { content: result, toolCalls: undefined as AgentToolCall[] | undefined };
      }
      return { content: '[Mock Agent LLM]', toolCalls: undefined as AgentToolCall[] | undefined };
    };

    const agentRuntime = new AgentRuntime(
      {
        name: node.data?.label,
        description: node.data?.description,
        model: {
          model: selectedModel,
          temperature: agentConfig?.temperature ?? 0.7,
          maxTokens: agentConfig?.maxTokens,
          systemPrompt,
        },
        tools,
        memory: {
          enabled: enableMemory,
          namespace: memoryNamespace,
        },
        maxIterations,
      },
      {
        llmExecutor: agentLLMExecutor,
        mcpToolExecutor,
        memoryService,
        onThoughtStep: onAgentThought,
        onToolCall: onAgentToolCall,
        onToolResult: onAgentToolResult,
      }
    );

    const result = await agentRuntime.run(userInput, variables);

    // LLM 执行完成后，如果有 routingDecision，回写反馈
    if (routingDecision && features) {
      try {
        const { estimateTokens, buildRouterRecord, recordRouterFeedback } = await import('./modelRouter');
        const latencyMs = Date.now() - startTime;
        const estTokens = estimateTokens(userInput + (result.finalAnswer || ''));
        const outcome = result.success ? 'success' : 'failure';
        const record = buildRouterRecord(features, routingDecision, outcome, latencyMs, estTokens);
        await recordRouterFeedback(record);
      } catch {
        // 反馈写入失败，忽略
      }
    }

    const output: Record<string, any> = {};
    output[outputVar] = result.finalAnswer;
    output[`${outputVar}_thoughtSteps`] = result.thoughtSteps;
    output[`${outputVar}_toolCallHistory`] = result.toolCallHistory;
    output[`${outputVar}_iterations`] = result.totalIterations;
    output[`${outputVar}_success`] = result.success;

    if (!result.success && result.error) {
      output[`${outputVar}_error`] = result.error;
    }

    const errorMessage = result.success ? undefined : `Agent 执行失败: ${result.error || '未知错误'}`;

    return makeResult(node, result.success, startTime, output, errorMessage, {
      model: selectedModel,
      iterations: result.totalIterations,
      toolCallCount: result.toolCallHistory.length,
      routing: routingDecision ? {
        model: routingDecision.modelName,
        reasoning: routingDecision.reasoning,
        alternatives: routingDecision.alternatives,
      } : undefined,
    });
  } catch (err: any) {
    return makeResult(node, false, startTime, undefined, `Agent 执行失败: ${err?.message || '未知错误'}`);
  }
};

export const subAgentNodeExecutor: NodeExecutor = async (node, context) => {
  const startTime = Date.now();
  const { variables, nodeOutputs, llmExecutor, mcpToolExecutor, memoryService, onAgentThought, onAgentToolCall, onAgentToolResult } = context;
  const subAgentConfig = node.data?.subagentConfig;
  const outputVar = subAgentConfig?.outputVariable || 'sub_agent_output';

  try {
    const userInput = resolveVariables(subAgentConfig?.inputVariable || '{{input}}', variables, { nodeOutputs });

    const mode: 'single' | 'router' | 'parallel' = subAgentConfig?.mode || 'single';
    const routerStrategy: RouterStrategy = subAgentConfig?.routerStrategy || 'intent';
    const aggregationMethod: AggregationMethod = subAgentConfig?.aggregationMethod || 'best';
    let agentsConfig: any[] = Array.isArray(subAgentConfig?.agents) ? subAgentConfig.agents : [];

    // 如果开启自动生成，先调用 designSubAgents
    if (subAgentConfig?.autoGenerate) {
      try {
        const { designSubAgents } = await import('./agent/designSubAgents');
        const { getRoutingPool } = await import('./modelRouter');
        const pool = await getRoutingPool();
        const designedAgents = await designSubAgents({
          taskDescription: userInput,
          modelPool: pool.map(p => ({ modelName: p.modelName, displayName: p.displayName, provider: p.provider })),
          llmExecutor: llmExecutor ? async (params) => {
            const result = await llmExecutor({
              model: params.model,
              systemPrompt: params.systemPrompt,
              userPrompt: params.userPrompt,
              temperature: params.temperature,
              variables,
            });
            return result;
          } : undefined,
        });
        // 用生成的 agents 替换手动配置
        agentsConfig = designedAgents;
      } catch {
        // 生成失败，使用手动配置
      }
    }

    if (agentsConfig.length === 0) {
      return makeResult(node, false, startTime, undefined, '子 Agent 列表不能为空');
    }

    const agentProfiles: AgentProfile[] = agentsConfig.map((a: any, idx: number) => ({
      id: a.id || `agent-${idx}`,
      name: a.name || `Agent ${idx + 1}`,
      description: a.description || '',
      specialties: Array.isArray(a.specialties) ? a.specialties : [],
      capabilities: Array.isArray(a.capabilities) ? a.capabilities : [],
      systemPrompt: a.systemPrompt || '你是一个有帮助的 AI 助手。',
      keywords: Array.isArray(a.keywords) ? a.keywords : undefined,
      priority: a.priority,
    }));

    const createAgentExecutor = (agent: AgentProfile) => {
      return async (_agent: AgentProfile, input: string): Promise<string> => {
        // 获取子 Agent 配置
        const agentCfg = agentsConfig.find((a: any) => a.id === agent.id || a.name === agent.name) as any;
        let model = agentCfg?.model || 'gpt-4o';

        // 如果 model 为 'auto' 或空，使用路由器选择
        if (!agentCfg?.model || agentCfg.model === 'auto') {
          try {
            const { extractTaskFeatures, getRoutingPool, selectModel, getRouterMemorySnapshot } = await import('./modelRouter');
            const subFeatures = extractTaskFeatures(input);
            const pool = await getRoutingPool();
            const memory = await getRouterMemorySnapshot();
            const decision = selectModel(subFeatures, pool, memory);
            if (decision) {
              model = decision.modelName;
            }
          } catch {
            // fallback 到默认模型
          }
        }

        const agentLLMExecutor = async (config: {
          model: string;
          systemPrompt?: string;
          messages: AgentMessage[];
          temperature?: number;
          maxTokens?: number;
          tools?: any[];
        }) => {
          if (llmExecutor) {
            const lastUserMessage = config.messages.filter(m => m.role === 'user').pop();
            const result = await llmExecutor({
              model: config.model,
              systemPrompt: config.systemPrompt,
              userPrompt: lastUserMessage?.content || '',
              temperature: config.temperature,
              maxTokens: config.maxTokens,
              variables,
            });
            return { content: result, toolCalls: undefined as AgentToolCall[] | undefined };
          }
          return { content: '[Mock Sub Agent LLM]', toolCalls: undefined as AgentToolCall[] | undefined };
        };

        const agentRuntime = new AgentRuntime(
          {
            name: agent.name,
            description: agent.description,
            model: {
              model,
              temperature: agentCfg?.temperature ?? 0.7,
              maxTokens: agentCfg?.maxTokens,
              systemPrompt: agent.systemPrompt,
            },
            tools: Array.isArray(agentCfg?.tools) ? agentCfg.tools : [],
            memory: {
              enabled: agentCfg?.enableMemory ?? false,
              namespace: agentCfg?.memoryNamespace || 'agent',
            },
            maxIterations: agentCfg?.maxIterations ?? 10,
          },
          {
            llmExecutor: agentLLMExecutor,
            mcpToolExecutor,
            memoryService,
            onThoughtStep: onAgentThought,
            onToolCall: onAgentToolCall,
            onToolResult: onAgentToolResult,
          }
        );

        const result = await agentRuntime.run(input, variables);
        if (!result.success && result.error) {
          throw new Error(result.error);
        }
        return result.finalAnswer;
      };
    };

    const router = new MoARouter(agentProfiles);
    let subAgentResults: SubAgentResult[] = [];
    let finalOutput = '';
    let routingInfo: any = null;

    if (mode === 'single') {
      const firstAgent = agentProfiles[0];
      const executor = createAgentExecutor(firstAgent);
      const execStartTime = Date.now();
      try {
        const output = await executor(firstAgent, userInput);
        subAgentResults.push({
          agentId: firstAgent.id,
          agentName: firstAgent.name,
          success: true,
          output,
          duration: Date.now() - execStartTime,
        });
        finalOutput = output;
      } catch (err: any) {
        subAgentResults.push({
          agentId: firstAgent.id,
          agentName: firstAgent.name,
          success: false,
          output: '',
          error: err?.message || '执行失败',
          duration: Date.now() - execStartTime,
        });
      }
    } else if (mode === 'parallel') {
      const result = await router.executeParallel(
        userInput,
        (agent, input) => createAgentExecutor(agent)(agent, input),
        aggregationMethod
      );
      subAgentResults = result.results;
      finalOutput = result.finalOutput;
    } else if (mode === 'router') {
      const result = await router.executeRouter(
        userInput,
        (agent, input) => createAgentExecutor(agent)(agent, input),
        routerStrategy
      );
      subAgentResults = result.results;
      finalOutput = result.finalOutput;
      routingInfo = result.routing;
    }

    const successCount = subAgentResults.filter(r => r.success).length;
    const allSuccess = successCount === subAgentResults.length && subAgentResults.length > 0;

    const output: Record<string, any> = {};
    output[outputVar] = finalOutput;
    output[`${outputVar}_results`] = subAgentResults;
    output[`${outputVar}_count`] = subAgentResults.length;
    output[`${outputVar}_successCount`] = successCount;
    if (routingInfo) {
      output[`${outputVar}_routing`] = routingInfo;
    }

    const errorMessage = allSuccess ? undefined : `部分子 Agent 执行失败 (${successCount}/${subAgentResults.length})`;

    return makeResult(node, allSuccess, startTime, output, errorMessage, {
      mode,
      agentCount: agentProfiles.length,
      successCount,
      routerStrategy: mode === 'router' ? routerStrategy : undefined,
      aggregationMethod: mode === 'parallel' ? aggregationMethod : undefined,
    });
  } catch (err: any) {
    return makeResult(node, false, startTime, undefined, `子 Agent 执行失败: ${err?.message || '未知错误'}`);
  }
};

export const defaultNodeExecutor: NodeExecutor = async (node, context) => {
  const startTime = Date.now();
  return makeResult(node, true, startTime, {}, undefined, { note: '节点类型暂未实现，直接通过' });
};

export function getNodeExecutor(nodeType: string): NodeExecutor {
  switch (nodeType) {
    case 'start':
      return startNodeExecutor;
    case 'end':
      return endNodeExecutor;
    case 'llm':
      return llmNodeExecutor;
    case 'agent':
      return agentNodeExecutor;
    case 'condition':
      return conditionNodeExecutor;
    case 'loop':
      return loopNodeExecutor;
    case 'code':
      return codeNodeExecutor;
    case 'http':
      return httpNodeExecutor;
    case 'variable':
      return variableNodeExecutor;
    case 'tool':
      return toolNodeExecutor;
    case 'memory_read':
      return memoryReadNodeExecutor;
    case 'memory_write':
      return memoryWriteNodeExecutor;
    case 'memory_search':
      return memorySearchNodeExecutor;
    case 'subagent':
    case 'sub_agent':
      return subAgentNodeExecutor;
    default:
      return defaultNodeExecutor;
  }
}
