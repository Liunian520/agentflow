/**
 * LLM API 客户端 — 统一的前端 LLM 调用层
 * 通过后端 SSE 代理调用，避免前端暴露 API Key
 */

import type { TaskFeatures, RoutingDecision } from '../types';
import {
  getRoutingPool, selectModel, buildRouterRecord, recordRouterFeedback,
  estimateTokens, maybeCompactRouterMemory,
} from '../lib/modelRouter';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';
const DEFAULT_TIMEOUT = 45000; // 45s，给 Render 冷启动留足时间
const MAX_RETRIES = 2;

/** 统一的 fetch 封装：超时 + 重试 + 清晰错误消息 */
async function safeFetch<T>(
  url: string,
  options: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT,
  retries: number = MAX_RETRIES,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const mergedSignal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  const finalOptions = { ...options, signal: mergedSignal };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, finalOptions);

      if (!response.ok) {
        // 优先读取后端返回的 JSON 错误中的 message 字段
        let body = '';
        try {
          const json = await response.json();
          body = json.message || JSON.stringify(json);
        } catch {
          body = await response.text().catch(() => '');
        }
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 300) || response.statusText}`);
      }

      const data = await response.json();
      clearTimeout(timer);
      return data as T;
    } catch (err: any) {
      lastError = err;
      // 超时不再重试；4xx 客户端错误也不再重试
      if (err.name === 'AbortError' || err.message?.startsWith('HTTP 4')) {
        break;
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }

  clearTimeout(timer);

  if (lastError?.name === 'AbortError') {
    throw new Error(
      `请求超时 (${timeoutMs / 1000}s)。后端 Render 服务可能正在冷启动，请等待 15-30 秒后重试；如持续失败请检查网络能否访问 ${API_BASE.replace('/api', '')}`
    );
  }
  throw new Error(lastError?.message || '网络请求失败，请检查后端服务是否在线');
}

// ===== 类型定义 =====
export interface LLMChatOptions {
  channelId: string;
  provider: 'openai' | 'anthropic' | 'google' | 'deepseek' | 'azure' | 'custom';
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: any[]; // Phase 6：MCP 工具 / function calling schema
}

export interface LLMChatResult {
  success: boolean;
  content: string;
  model: string;
  provider: string;
  timestamp: string;
  message?: string; // 错误信息
}

export interface SSECallbacks {
  onStart?: (data: { model: string; provider: string }) => void;
  onDelta?: (data: { content: string; fullContent: string }) => void;
  onDone?: (data: { content: string }) => void;
  onError?: (data: { message: string; status?: number }) => void;
  onTool?: (data: { name: string; status: 'running' | 'done'; result?: string }) => void;
}

// ===== 后端健康检查 =====
export async function checkBackendHealth(): Promise<{ ok: boolean; latency: number; message?: string }> {
  const healthUrl = `${API_BASE.replace(/\/api\/?$/, '')}/health`;
  const maxAttempts = 3;
  const timeoutMs = 60000; // 60s — Render 冷启动可能需要 30-40s

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(healthUrl, {
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache' },
      });
      clearTimeout(timer);
      if (!response.ok) {
        return { ok: false, latency: Date.now() - start, message: `后端返回 ${response.status}` };
      }
      return { ok: true, latency: Date.now() - start };
    } catch (err: any) {
      const isAbort = err.name === 'AbortError';
      const isLast = attempt === maxAttempts - 1;
      if (isLast) {
        if (isAbort) {
          return { ok: false, latency: Date.now() - start, message: `后端响应超时（${timeoutMs / 1000}s），Render 可能正在冷启动，请等待 30 秒后重试` };
        }
        return { ok: false, latency: Date.now() - start, message: err.message || '无法连接后端，请检查网络' };
      }
      // 非最后一次尝试，等待后重试
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return { ok: false, latency: 0, message: '多次尝试后仍无法连接后端' };
}

// ===== 非流式调用 =====
// ===== 模型池拉取 =====
export interface FetchedModel {
  id: string;
  name: string;
  displayName: string;
}

/**
 * 配置渠道后，按 provider 从厂商 API 拉取可用模型池。
 * 由后端代理请求（避免前端暴露 API Key、规避 CORS）。
 */
export async function fetchChannelModels(payload: {
  provider: string;
  apiKey: string;
  baseUrl: string;
}): Promise<FetchedModel[]> {
  const data = await safeFetch<{ success: boolean; models?: FetchedModel[]; message?: string }>(
    `${API_BASE}/llm/models`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  if (!data.success) {
    throw new Error(data.message || '拉取模型失败');
  }
  return data.models || [];
}

// 渠道连接测试 — 返回连通状态 + 延迟 + 模型信息
export interface ChannelTestResult {
  success: boolean;
  latency: number;
  model?: string;
  modelCount?: number;
  message: string;
  status?: number;
}

export async function testChannelConnection(payload: {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model?: string;
}): Promise<ChannelTestResult> {
  return await safeFetch<ChannelTestResult>(`${API_BASE}/llm/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function chatLLM(options: LLMChatOptions): Promise<LLMChatResult> {
  const response = await fetch(`${API_BASE}/llm/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channelId: options.channelId,
      provider: options.provider,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      tools: options.tools,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LLM API 请求失败 (${response.status}): ${err.slice(0, 200)}`);
  }

  return response.json();
}

// ===== SSE 流式调用 =====
export function chatLLMStream(options: LLMChatOptions, callbacks: SSECallbacks): AbortController {
  const controller = new AbortController();

  fetch(`${API_BASE}/llm/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channelId: options.channelId,
      provider: options.provider,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      tools: options.tools,
    }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.text();
        callbacks.onError?.({ message: `请求失败 (${response.status}): ${err.slice(0, 200)}`, status: response.status });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onError?.({ message: '无法读取流式响应' });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // SSE 格式：event: xxx \n data: {...}
          if (trimmed.startsWith('event:')) {
            // 事件类型行，下一条 data 行才是数据
            continue;
          }

          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            try {
              const data = JSON.parse(dataStr);
              // 根据后端发送的 SSE event 之前存储的上下文来处理
              // 后端格式：event: start/delta/done/error + data: {...}
              // 由于 SSE parser 是逐行读的，需要找到 event 行配对的 data 行
              // 简化处理：根据 data 结构自行判断
              if (data.content !== undefined && data.fullContent !== undefined) {
                // delta 事件
                callbacks.onDelta?.(data);
              } else if (data.model && data.provider) {
                // start 事件
                callbacks.onStart?.(data);
              } else if (data.message && !data.content) {
                // error 事件
                callbacks.onError?.(data);
              }
              // done 事件由 onDone 回调处理
              // 但 delta 事件的最后一次可能就是最终内容
            } catch {
              // 非 JSON，跳过
            }
          }
        }
      }

      // 流结束，触发 onDone
      callbacks.onDone?.({ content: '' });
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        callbacks.onError?.({ message: err.message });
      }
    });

  return controller;
}

// ===== 增强版 SSE 解析器 =====
// 上述简化版本无法准确匹配 event+data 对，下面是完整版
export function chatLLMStreamEnhanced(options: LLMChatOptions, callbacks: SSECallbacks): AbortController {
  const controller = new AbortController();

  fetch(`${API_BASE}/llm/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channelId: options.channelId,
      provider: options.provider,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      tools: options.tools,
    }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.text();
        callbacks.onError?.({ message: `请求失败 (${response.status}): ${err.slice(0, 200)}`, status: response.status });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onError?.({ message: '无法读取流式响应' });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE 以双换行分割事件块
        const eventBlocks = buffer.split('\n\n');
        buffer = eventBlocks.pop() || '';

        for (const block of eventBlocks) {
          const lines = block.split('\n');
          let eventType = '';
          let eventData = '';

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              eventData = line.slice(5).trim();
            }
          }

          if (!eventType || !eventData) continue;

          try {
            const data = JSON.parse(eventData);
            switch (eventType) {
              case 'start':
                callbacks.onStart?.(data);
                break;
              case 'delta':
                callbacks.onDelta?.(data);
                break;
              case 'done':
                callbacks.onDone?.(data);
                break;
              case 'error':
                callbacks.onError?.(data);
                break;
              case 'tool':
                callbacks.onTool?.(data);
                break;
            }
          } catch {
            // JSON 解析失败，跳过
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        callbacks.onError?.({ message: err.message });
      }
    });

  // 兜底：5 分钟后如果流还没有 onDone，强制结束（防止永远卡住）
  const fallbackTimer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort();
      callbacks.onDone?.({ content: '' });
    }
  }, 300000);

  controller.signal.addEventListener('abort', () => clearTimeout(fallbackTimer));

  return controller;
}

// ===== 从 Store 获取第一个可用的 LLM 渠道 =====
export async function getAvailableChannelFromStore(): Promise<{
  channelId: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  models: Array<{ name: string; displayName: string }>;
} | null> {
  const { useStore } = await import('../store/useStore');
  const store = useStore.getState();
  const enabledChannels = store.channels.filter((c: any) => c.enabled && c.apiKey);

  if (enabledChannels.length === 0) return null;

  const priority = ['openai', 'deepseek', 'anthropic', 'google', 'azure', 'custom'];
  for (const provider of priority) {
    const channel = enabledChannels.find((c: any) => c.provider === provider);
    if (channel) {
      return {
        channelId: channel.id,
        provider: channel.provider,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        models: channel.models,
      };
    }
  }

  const channel = enabledChannels[0];
  return {
    channelId: channel.id,
    provider: channel.provider,
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    models: channel.models,
  };
}

// ===== 获取指定模型所在的渠道 =====
export async function getChannelForModel(modelName: string): Promise<{
  channelId: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
} | null> {
  const { useStore } = await import('../store/useStore');
  const store = useStore.getState();
  const enabledChannels = store.channels.filter((c: any) => c.enabled && c.apiKey);

  for (const channel of enabledChannels) {
    if (channel.models.some((m: any) => m.name === modelName)) {
      return {
        channelId: channel.id,
        provider: channel.provider,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
      };
    }
  }

  return null;
}

// ===== ACRouter 路由化调用（C-A-F 闭环：选模型→调用→采集反馈→回写） =====

export interface RoutedChatOptions {
  messages: LLMChatOptions['messages'];
  temperature?: number;
  maxTokens?: number;
  tools?: any[];
}

export interface RoutedChatResult extends LLMChatResult {
  routing?: RoutingDecision;
}

export interface RoutedSSECallbacks extends SSECallbacks {
  onRouting?: (decision: RoutingDecision) => void;
}

/**
 * 非流式路由调用：自动选最优模型 → 调用 → 采集反馈(outcome/延迟/token) → 回写 routerMemory。
 * 调用方只需提供 messages 等参数 + taskFeatures，无需指定 channelId/model。
 */
export async function routedChatLLM(
  options: RoutedChatOptions,
  taskFeatures: TaskFeatures,
): Promise<RoutedChatResult> {
  // 手动模式：优先使用用户指定的默认模型
  const manualDecision = await getManualRoutingDecision();
  let decision: RoutingDecision | null;

  if (manualDecision) {
    decision = manualDecision;
  } else {
    const pool = await getRoutingPool();
    decision = selectModel(taskFeatures, pool, await getRouterMemorySnapshot());
  }

  // 无可用模型 → 降级返回失败
  if (!decision) {
    return {
      success: false,
      content: '',
      model: '',
      provider: '',
      timestamp: new Date().toISOString(),
      message: '未配置可用的 LLM 渠道，请在「渠道设置」中添加 API Key。',
    };
  }

  const start = Date.now();
  try {
    const result = await chatLLM({
      channelId: decision.channelId,
      provider: decision.provider as any,
      baseUrl: decision.baseUrl,
      apiKey: decision.apiKey,
      model: decision.modelName,
      messages: options.messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      tools: options.tools,
    });

    const latencyMs = Date.now() - start;
    const estTokens = estimateTokens(
      options.messages.map((m) => m.content).join('') + (result.content || ''),
    );
    const outcome = result.success ? 'success' : 'failure';

    const record = buildRouterRecord(taskFeatures, decision, outcome, latencyMs, estTokens);
    await recordRouterFeedback(record);
    await maybeCompactRouterMemory();

    return { ...result, routing: decision };
  } catch (error: any) {
    const latencyMs = Date.now() - start;
    const estTokens = estimateTokens(options.messages.map((m) => m.content).join(''));
    const record = buildRouterRecord(taskFeatures, decision, 'failure', latencyMs, estTokens);
    await recordRouterFeedback(record);
    await maybeCompactRouterMemory();

    return {
      success: false,
      content: '',
      model: decision.modelName,
      provider: decision.provider,
      timestamp: new Date().toISOString(),
      message: error.message || 'LLM 调用异常',
      routing: decision,
    };
  }
}

/**
 * 流式路由调用：自动选最优模型 → SSE 流式调用 → onDone/onError 时回写反馈。
 */
export function routedChatLLMStream(
  options: RoutedChatOptions,
  taskFeatures: TaskFeatures,
  callbacks: RoutedSSECallbacks,
): AbortController {
  const controller = new AbortController();
  let decision: RoutingDecision | null = null;
  let start = 0;
  let fullContent = '';

  // 异步：先选模型，再发起流式调用
  (async () => {
    // 手动模式：优先使用用户指定的默认模型
    const manualDecision = await getManualRoutingDecision();
    if (manualDecision) {
      decision = manualDecision;
    } else {
      const pool = await getRoutingPool();
      decision = selectModel(taskFeatures, pool, await getRouterMemorySnapshot());
    }

    if (!decision) {
      callbacks.onError?.({ message: '未配置可用的 LLM 渠道，请在「渠道设置」中添加 API Key。' });
      return;
    }

    callbacks.onRouting?.(decision);
    start = Date.now();

    // 复用增强版 SSE 解析器
    const inner = chatLLMStreamEnhanced(
      {
        channelId: decision.channelId,
        provider: decision.provider as any,
        baseUrl: decision.baseUrl,
        apiKey: decision.apiKey,
        model: decision.modelName,
        messages: options.messages,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        tools: options.tools,
      },
      {
        onStart: (data) => callbacks.onStart?.(data),
        onDelta: (data) => {
          fullContent = data.fullContent || fullContent;
          callbacks.onDelta?.(data);
        },
        onTool: (data) => callbacks.onTool?.(data),
        onDone: async (data) => {
          const latencyMs = Date.now() - start;
          const content = data.content || fullContent;
          const estTokens = estimateTokens(
            options.messages.map((m) => m.content).join('') + content,
          );
          const record = buildRouterRecord(taskFeatures, decision!, 'success', latencyMs, estTokens);
          await recordRouterFeedback(record);
          await maybeCompactRouterMemory();
          callbacks.onDone?.(data);
        },
        onError: async (data) => {
          const latencyMs = Date.now() - start;
          const estTokens = estimateTokens(options.messages.map((m) => m.content).join(''));
          const record = buildRouterRecord(taskFeatures, decision!, 'failure', latencyMs, estTokens);
          await recordRouterFeedback(record);
          await maybeCompactRouterMemory();
          callbacks.onError?.(data);
        },
      },
    );
    // 把内部 controller 的 abort 透传到外部
    // 注意：inner 是独立 controller，这里用事件代理
    controller.signal.addEventListener('abort', () => inner.abort());
  })().catch((err) => {
    callbacks.onError?.({ message: err.message || '路由调用异常' });
  });

  return controller;
}

// 获取 routerMemory 快照（供 selectModel 决策）
async function getRouterMemorySnapshot() {
  const { useStore } = await import('../store/useStore');
  return useStore.getState().routerMemory;
}

// 从 store 读取路由偏好：如果 routerEnabled=false 且 defaultModelId 有值，直接使用指定模型
async function getManualRoutingDecision(): Promise<RoutingDecision | null> {
  const { useStore } = await import('../store/useStore');
  const state = useStore.getState();
  if (state.routerEnabled) return null;  // 自动路由模式，不干预
  if (!state.defaultModelId) return null; // 没指定默认模型

  // defaultModelId 格式: "channelId:modelName"
  const [channelId, modelName] = state.defaultModelId.split(':');
  const channel = state.channels.find(c => c.id === channelId && c.enabled && c.apiKey);
  if (!channel) return null;
  const model = channel.models.find(m => m.name === modelName);
  if (!model) return null;

  return {
    channelId: channel.id,
    provider: channel.provider,
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    modelName: model.name,
    modelDisplayName: model.displayName || model.name,
    reasoning: '用户手动选择',
    alternatives: [],
    explored: false,
    strategy: 'manual',
  };
}

// ===== MCP 服务器管理客户端（Phase 6） =====
export interface McpServerInput {
  id: string;
  name: string;
  transport: 'streamable-http' | 'sse' | 'local-fs';
  url?: string;
  fsDir?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

export async function connectMcpServer(input: McpServerInput): Promise<{ success: boolean; tools?: any[]; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}/mcp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await response.json();
    return data;
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function listMcpTools(serverId: string): Promise<{ success: boolean; tools?: any[]; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}/mcp/tools?serverId=${encodeURIComponent(serverId)}`);
    const data = await response.json();
    return data;
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function callMcpTool(
  serverId: string,
  name: string,
  args: Record<string, any>,
): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}/mcp/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, name, args }),
    });
    const data = await response.json();
    return data;
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ===== A2A (Agent-to-Agent) 协议 API（Phase 11） =====

export interface A2AAgentCard {
  name: string;
  description?: string;
  version?: string;
  url?: string;
  capabilities?: { streaming?: boolean; pushNotifications?: boolean };
  skills?: Array<{ id: string; name: string; description: string; tags?: string[] }>;
}

/** 发现 A2A Agent Card */
export async function discoverA2AAgent(
  agentUrl: string,
  authHeaders?: Record<string, string>,
): Promise<{ success: boolean; agentCard?: A2AAgentCard; message?: string }> {
  try {
    const data = await safeFetch<{ success: boolean; agentCard?: A2AAgentCard; message?: string }>(
      `${API_BASE}/a2a/discover`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentUrl, headers: authHeaders }),
      },
      30000,
      1,
    );
    return data;
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

/** 非流式发送 A2A 任务 */
export async function sendA2ATask(
  agentUrl: string,
  message: string,
  options?: {
    skillId?: string;
    authHeaders?: Record<string, string>;
    taskId?: string;
  },
): Promise<{ success: boolean; response?: string; state?: string; error?: string }> {
  try {
    const data = await safeFetch<{ success: boolean; response?: string; state?: string; message?: string }>(
      `${API_BASE}/a2a/send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentUrl,
          message,
          skillId: options?.skillId,
          headers: options?.authHeaders,
          taskId: options?.taskId,
        }),
      },
      120000,
      0,
    );
    if (!data.success) {
      return { success: false, error: data.message || 'A2A 任务失败' };
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/** 流式发送 A2A 任务（SSE） */
export interface A2AStreamCallbacks {
  onStart?: (taskId: string) => void;
  onDelta?: (data: { delta: string; fullText: string; state: string }) => void;
  onDone?: (data: { response: string; state: string }) => void;
  onError?: (message: string) => void;
}

export async function streamA2ATask(
  agentUrl: string,
  message: string,
  callbacks: A2AStreamCallbacks,
  options?: {
    skillId?: string;
    authHeaders?: Record<string, string>;
    signal?: AbortSignal;
  },
): Promise<void> {
  const response = await fetch(`${API_BASE}/a2a/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentUrl,
      message,
      skillId: options?.skillId,
      headers: options?.authHeaders,
    }),
    signal: options?.signal,
  });

  if (!response.ok) {
    callbacks.onError?.(`HTTP ${response.status}`);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError?.('No response body');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent = '';
      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;
          try {
            const data = JSON.parse(jsonStr);
            switch (currentEvent) {
              case 'start':
                callbacks.onStart?.(data.taskId);
                break;
              case 'delta':
                if (data.fullText) fullText = data.fullText;
                else if (data.delta) fullText += data.delta;
                callbacks.onDelta?.({
                  delta: data.delta || '',
                  fullText,
                  state: data.state || 'working',
                });
                break;
              case 'done':
                callbacks.onDone?.({
                  response: data.response || fullText,
                  state: data.state || 'completed',
                });
                return;
              case 'error':
                callbacks.onError?.(data.message || 'A2A 流式请求错误');
                return;
            }
          } catch {
            // 非 JSON，跳过
          }
        }
      }
    }
  } catch (err: any) {
    if (err.name === 'AbortError') return;
    callbacks.onError?.(err.message);
  }
}
