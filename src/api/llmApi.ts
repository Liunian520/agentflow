/**
 * LLM API 客户端 — 统一的前端 LLM 调用层
 * 通过后端 SSE 代理调用，避免前端暴露 API Key
 */

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';

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
  const response = await fetch(`${API_BASE}/llm/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || '拉取模型失败');
  }
  return data.models || [];
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
