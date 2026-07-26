/**
 * LLM API 客户端 — 统一的前端 LLM 调用层
 * 通过后端 SSE 代理调用，避免前端暴露 API Key
 */

import type { TaskFeatures, RoutingDecision } from '../types';
import {
  getRoutingPool, selectModel, buildRouterRecord, recordRouterFeedback,
  estimateTokens, maybeCompactRouterMemory, getRouterMemorySnapshot,
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

/** 多模态消息内容片段（OpenAI 兼容格式） */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export interface LLMChatOptions {
  channelId: string;
  provider: 'openai' | 'anthropic' | 'google' | 'deepseek' | 'azure' | 'custom';
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | ContentPart[];
    name?: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: any[]; // Phase 6：MCP 工具 / function calling schema
  sessionId?: string; // Phase 1：会话持久化，服务端据此落盘消息
  taskId?: string;   // Phase 1：后台任务 ID，服务端据此标记状态供前端轮询
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
  onReasoning?: (data: { content: string; fullContent: string }) => void;
  onDone?: (data: { content: string; reasoningContent?: string }) => void;
  onError?: (data: { message: string; status?: number }) => void;
  onTool?: (data: { name: string; status: 'running' | 'done'; result?: string; args?: any }) => void;
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
  // 非流式聊天可能较慢（含工具循环），给 120s 超时，仍复用 safeFetch 的超时/重试/错误封装
  return safeFetch<LLMChatResult>(
    `${API_BASE}/llm/chat`,
    {
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
        sessionId: options.sessionId,
        taskId: options.taskId,
      }),
    },
    120000,
    1,
  );
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
      sessionId: options.sessionId,
      taskId: options.taskId,
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

  // settled 守卫：确保 onDone / onError 生命周期仅触发一次，并统一清理兜底 timer
  let settled = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  const clearFallback = () => {
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  };
  const safeDone = (data: any) => {
    if (settled) return;
    settled = true;
    clearFallback();
    callbacks.onDone?.(data);
  };
  const safeError = (data: any) => {
    if (settled) return;
    settled = true;
    clearFallback();
    callbacks.onError?.(data);
  };

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
      sessionId: options.sessionId,
      taskId: options.taskId,
    }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.text();
        safeError({ message: `请求失败 (${response.status}): ${err.slice(0, 200)}`, status: response.status });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        safeError({ message: '无法读取流式响应' });
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
              case 'reasoning':
                callbacks.onReasoning?.(data);
                break;
              case 'done':
                safeDone(data);
                break;
              case 'error':
                safeError(data);
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

      // 流自然结束但后端未发送 done 事件 → 兜底触发一次 onDone
      safeDone({ content: '' });
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        safeError({ message: err.message });
      } else {
        // 主动中止：清理 timer，不再重复回调
        clearFallback();
      }
    });

  // 兜底：5 分钟后如果流还没有结束，强制收尾（防止永远卡住）
  fallbackTimer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
    safeDone({ content: '' });
  }, 300000);

  controller.signal.addEventListener('abort', clearFallback);

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
  let channels = store.channels || [];

  // 防御性 fallback：zustand persist 可能尚未 rehydrate，直接从 localStorage 读取
  if (channels.length === 0 && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem('lnagent-data');
      if (raw) {
        const parsed = JSON.parse(raw);
        const persistedChannels = parsed?.state?.channels || parsed?.channels;
        if (Array.isArray(persistedChannels) && persistedChannels.length > 0) {
          channels = persistedChannels;
        }
      }
    } catch (e) {
      console.warn('[getAvailableChannelFromStore] 读取 localStorage fallback 失败:', e);
    }
  }

  const enabledChannels = channels.filter((c: any) => c.enabled && c.apiKey);

  if (enabledChannels.length === 0) {
    // 输出诊断日志，帮助用户/开发者定位是"未配置/被禁用/缺 Key"
    if (channels.length === 0) {
      console.warn('[getAvailableChannelFromStore] 没有配置任何 LLM 渠道');
    } else {
      const disabledCount = channels.filter((c: any) => !c.enabled).length;
      const noKeyCount = channels.filter((c: any) => c.enabled && !c.apiKey).length;
      console.warn(
        `[getAvailableChannelFromStore] 没有可用渠道：共 ${channels.length} 个，` +
          `禁用 ${disabledCount} 个，启用但缺 API Key ${noKeyCount} 个`,
        channels.map((c: any) => ({ id: c.id, name: c.name, enabled: c.enabled, hasKey: !!c.apiKey })),
      );
    }
    return null;
  }

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

  // 兜底返回第一个可用渠道
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
  sessionId?: string; // Phase 1：会话持久化
  taskId?: string;   // Phase 1：后台任务 ID
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
        sessionId: options.sessionId,
        taskId: options.taskId,
      },
      {
        onStart: (data) => callbacks.onStart?.(data),
        onDelta: (data) => {
          fullContent = data.fullContent || fullContent;
          callbacks.onDelta?.(data);
        },
        onReasoning: (data) => {
          callbacks.onReasoning?.(data);
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

// ===== Phase 1: 会话持久化 / 断线恢复 =====

export interface ChatMessageLike {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string;
  messageType?: string;
  model?: string;
  provider?: string;
  attachments?: any[];
}

/** 从服务端 KV 恢复会话消息历史（KV 为 source of truth） */
export async function fetchSessionMessages(sessionId: string): Promise<ChatMessageLike[]> {
  try {
    const data = await safeFetch<{ success: boolean; messages?: ChatMessageLike[]; message?: string }>(
      `${API_BASE}/messages/session/${encodeURIComponent(sessionId)}`,
      { method: 'GET' },
      15000,
      1,
    );
    if (!data.success) return [];
    return data.messages || [];
  } catch {
    return [];
  }
}

/** 查询后台任务状态（用于断线后轮询恢复） */
export interface TaskStatus {
  status: 'running' | 'done' | 'error';
  sessionId?: string;
  content?: string;
  message?: string;
  startedAt?: number;
  finishedAt?: number;
}

export async function pollTask(taskId: string): Promise<TaskStatus | null> {
  try {
    const data = await safeFetch<{ success: boolean; task?: TaskStatus; message?: string }>(
      `${API_BASE}/tasks/${encodeURIComponent(taskId)}`,
      { method: 'GET' },
      10000,
      1,
    );
    if (!data.success || !data.task) return null;
    return data.task;
  } catch {
    return null;
  }
}

/** 轮询任务直到完成/出错，返回最终状态 */
export async function pollTaskUntilDone(
  taskId: string,
  onTick?: (status: TaskStatus) => void,
  intervalMs = 2000,
  maxAttempts = 90,
): Promise<TaskStatus | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const status = await pollTask(taskId);
    if (status) {
      onTick?.(status);
      if (status.status === 'done' || status.status === 'error') return status;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

// ===== 视觉模型代理（Vision Proxy）=====
// 当对话时选择的模型不支持视觉（无识图能力），自动切换到用户配置的识图模型
// 分析完图片后，把分析结果作为文本回填到原消息，再交回原模型继续对话。

/** 视觉能力判断启发式：基于模型名常见模式识别 */
function inferSupportsVisionByName(modelName: string): boolean {
  const name = modelName.toLowerCase();
  // 已知支持视觉的模型命名模式
  const visionPatterns = [
    'gpt-4o', 'gpt-4-turbo', 'gpt-4-vision', 'gpt-4.1', 'gpt-4.5',
    'claude-3', 'claude-4', 'claude-opus-4', 'claude-sonnet-4', 'claude-3.5', 'claude-3.7',
    'gemini', 'gemini-1.5', 'gemini-2', 'gemini-pro-vision',
    'qwen-vl', 'qwen2-vl', 'qwen2.5-vl', 'qvq',
    'glm-4v', 'glm-4.5v', 'glm-4.6v',
    'internvl', 'intern-vl',
    'llava', 'llama-3.2-vision', 'llama-4',
    'pixtral',
    'deepseek-vl',
    'o1', 'o3', 'o4',
  ];
  // 明确排除纯文本/embedding/语音模型
  const textOnlyPatterns = ['embedding', 'tts', 'whisper', 'transcribe', 'audio', 'moderation', 'dall-e', 'stable-diffusion'];
  if (textOnlyPatterns.some((p) => name.includes(p))) return false;
  return visionPatterns.some((p) => name.includes(p));
}

/** 判断 store 中某个渠道+模型是否支持视觉 */
export async function isModelSupportsVision(channelId?: string, modelName?: string): Promise<boolean> {
  if (!channelId || !modelName) return false;
  const { useStore } = await import('../store/useStore');
  const state = useStore.getState();
  const channel = state.channels.find((c) => c.id === channelId);
  if (!channel) return false;
  const model = channel.models.find((m) => m.name === modelName);
  if (!model) return false;
  // 优先使用显式标记
  if (typeof model.supportsVision === 'boolean') return model.supportsVision;
  // 退化到启发式判断
  return inferSupportsVisionByName(model.name);
}

/** 从 store 读取用户配置的识图模型，并解析为渠道信息 */
export async function getVisionChannel(): Promise<{
  channelId: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  modelDisplayName: string;
} | null> {
  const { useStore } = await import('../store/useStore');
  const state = useStore.getState();
  if (!state.visionModelId) return null;

  // visionModelId 格式: "channelId:modelName"
  const sepIdx = state.visionModelId.lastIndexOf(':');
  if (sepIdx < 0) return null;
  const channelId = state.visionModelId.slice(0, sepIdx);
  const modelName = state.visionModelId.slice(sepIdx + 1);
  const channel = state.channels.find((c) => c.id === channelId && c.enabled && c.apiKey);
  if (!channel) return null;
  const model = channel.models.find((m) => m.name === modelName);
  if (!model) return null;

  return {
    channelId: channel.id,
    provider: channel.provider,
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    modelName: model.name,
    modelDisplayName: model.displayName || model.name,
  };
}

/** 从消息列表中提取所有图片 URL（仅 image_url 类型片段） */
export function extractImageUrls(messages: Array<{ content: string | ContentPart[] }>): string[] {
  const urls: string[] = [];
  for (const msg of messages) {
    if (typeof msg.content === 'string') continue;
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === 'image_url' && part.image_url?.url) {
        urls.push(part.image_url.url);
      }
    }
  }
  return urls;
}

/** 判断消息列表中是否包含图片输入 */
export function hasImageInput(messages: Array<{ content: string | ContentPart[] }>): boolean {
  return extractImageUrls(messages).length > 0;
}

/**
 * 视觉代理：当当前模型不支持视觉时，调用识图模型分析图片，把分析结果作为文本回填。
 *
 * 流程：
 * 1. 当前模型支持视觉 → 直接返回原 messages（无需代理）
 * 2. 当前模型不支持视觉 + 用户未配置识图模型 → 返回原 messages（带警告）
 * 3. 当前模型不支持视觉 + 配置了识图模型 → 调用识图模型分析所有图片 → 把图片替换为文本描述
 *
 * @param messages 原始消息列表
 * @param currentChannelId 当前选择的渠道 ID
 * @param currentModelName 当前选择的模型名
 * @param onProgress 进度回调（可选，用于 UI 提示）
 * @returns 处理后的消息列表（content 全部为 string，可直接传给纯文本模型）
 */
export async function visionProxy(
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string | ContentPart[]; name?: string }>,
  currentChannelId: string,
  currentModelName: string,
  onProgress?: (msg: string) => void,
): Promise<{
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; name?: string }>;
  proxied: boolean;
  visionModelUsed?: string;
  warning?: string;
}> {
  // 1. 当前模型支持视觉，无需代理
  const currentSupportsVision = await isModelSupportsVision(currentChannelId, currentModelName);
  if (currentSupportsVision) {
    return {
      messages: messages.map((m) => ({
        ...m,
        content: typeof m.content === 'string' ? m.content : m.content.map((p) => p.type === 'text' ? p.text : '').join(''),
      })),
      proxied: false,
    };
  }

  // 2. 检测是否含图片输入
  const imageUrls = extractImageUrls(messages);
  if (imageUrls.length === 0) {
    // 无图片，直接返回（统一为 string content）
    return {
      messages: messages.map((m) => ({
        ...m,
        content: typeof m.content === 'string' ? m.content : m.content.map((p) => p.type === 'text' ? p.text : '').join(''),
      })),
      proxied: false,
    };
  }

  // 3. 获取识图模型渠道
  const visionChannel = await getVisionChannel();
  if (!visionChannel) {
    // 未配置识图模型：保留原消息，但返回警告（图片信息会丢失，但保留文本）
    const flattened = messages.map((m) => ({
      ...m,
      content: typeof m.content === 'string'
        ? m.content
        : m.content.map((p) => p.type === 'text' ? p.text : '[图片]').join(''),
    }));
    return {
      messages: flattened,
      proxied: false,
      warning: '当前模型不支持视觉输入，且未配置识图模型。图片信息将丢失，请到「设置 → 模型偏好」配置识图模型。',
    };
  }

  // 4. 调用识图模型逐张分析图片
  onProgress?.(`正在使用 ${visionChannel.modelDisplayName} 分析 ${imageUrls.length} 张图片…`);

  const imageDescriptions: string[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    try {
      const result = await chatLLM({
        channelId: visionChannel.channelId,
        provider: visionChannel.provider as any,
        baseUrl: visionChannel.baseUrl,
        apiKey: visionChannel.apiKey,
        model: visionChannel.modelName,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `请详细描述这张图片的内容，包括可见的文本、UI 元素、数据、布局、颜色等关键信息。这是第 ${i + 1}/${imageUrls.length} 张图片，描述将作为上下文提供给后续对话。` },
              { type: 'image_url', image_url: { url, detail: 'high' } },
            ],
          },
        ],
        temperature: 0.3,
        maxTokens: 1024,
      });

      if (result.success && result.content) {
        imageDescriptions.push(`【图片 ${i + 1} 分析结果（由 ${visionChannel.modelDisplayName} 提供）】\n${result.content}`);
      } else {
        imageDescriptions.push(`【图片 ${i + 1}】分析失败：${result.message || '未知错误'}`);
      }
    } catch (err: any) {
      imageDescriptions.push(`【图片 ${i + 1}】分析异常：${err.message || '未知错误'}`);
    }
  }

  // 5. 把图片分析结果回填到 messages 中
  // 策略：将每条消息中的 image_url 片段替换为对应的文本描述
  let descIdx = 0;
  const processedMessages = messages.map((m) => {
    if (typeof m.content === 'string') {
      return { ...m, content: m.content };
    }
    const parts: string[] = [];
    for (const part of m.content) {
      if (part.type === 'text') {
        parts.push(part.text);
      } else if (part.type === 'image_url') {
        // 用识图模型的分析结果替换图片
        const desc = imageDescriptions[descIdx] || `[图片 ${descIdx + 1}（分析结果缺失）]`;
        parts.push(desc);
        descIdx++;
      }
    }
    return { ...m, content: parts.join('\n\n') };
  });

  onProgress?.(`图片分析完成，已将 ${imageUrls.length} 张图片转为文本描述，继续对话…`);

  return {
    messages: processedMessages,
    proxied: true,
    visionModelUsed: visionChannel.modelDisplayName,
  };
}
