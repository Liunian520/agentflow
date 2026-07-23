/**
 * A2A (Agent-to-Agent) Protocol Client Service
 *
 * 基于 Google A2A 协议规范实现：
 * - Agent Card 发现: GET /.well-known/agent.json
 * - 任务发送 (非流式): POST /tasks/send
 * - 任务订阅 (SSE 流式): POST /tasks/sendSubscribe
 *
 * 后端作为代理层，解决浏览器 CORS 限制
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { assertSafeOutboundUrl } from './urlGuard';

const router = Router();

const A2A_TIMEOUT = 120000; // 2 分钟超时（外部 Agent 可能较慢）

// ===== 类型定义 =====

export interface A2AAgentCard {
  name: string;
  description?: string;
  version?: string;
  url?: string;
  protocolVersion?: string;
  capabilities?: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  skills?: Array<{
    id: string;
    name: string;
    description: string;
    tags?: string[];
    examples?: string[];
    inputModes?: string[];
    outputModes?: string[];
  }>;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
}

export interface A2ATaskRequest {
  agentUrl: string;       // 外部 A2A Agent 的 base URL
  message: string;        // 用户消息文本
  taskId?: string;        // 可选自定义 task ID
  skillId?: string;       // 可选指定 skill
  headers?: Record<string, string>; // 自定义请求头（如认证）
}

export interface A2ATaskResponse {
  id: string;
  state: string;          // submitted | working | completed | failed | canceled
  response?: string;      // Agent 的文本回复
  raw?: any;              // 原始响应
  error?: string;
}

// ===== 工具函数 =====

/** 规范化 Agent URL：去除尾部斜杠 */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/** 构建完整的 A2A 端点 URL */
function buildEndpoint(baseUrl: string, path: string): string {
  const base = normalizeUrl(baseUrl);
  return `${base}${path}`;
}

/** 带超时的 fetch */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = A2A_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response;
  } catch (err: any) {
    clearTimeout(timer);
    throw err;
  }
}

// ===== Agent Card 发现 =====

/**
 * 发现 A2A Agent Card
 * 尝试 GET /.well-known/agent.json，失败则尝试 GET /agent.json
 */
async function discoverAgentCard(baseUrl: string, headers?: Record<string, string>): Promise<A2AAgentCard> {
  const base = normalizeUrl(baseUrl);
  const urls = [
    `${base}/.well-known/agent.json`,
    `${base}/agent.json`,
  ];

  let lastError = '';
  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          ...headers,
        },
      }, 30000);

      if (response.ok) {
        const data = await response.json();
        return data as A2AAgentCard;
      }
      lastError = `HTTP ${response.status} from ${url}`;
    } catch (err: any) {
      lastError = err.message;
    }
  }

  throw new Error(`无法发现 Agent Card: ${lastError}`);
}

// ===== 任务发送 (非流式) =====

async function sendTask(req: A2ATaskRequest): Promise<A2ATaskResponse> {
  const taskId = req.taskId || crypto.randomUUID();
  const endpoint = buildEndpoint(req.agentUrl, '/tasks/send');

  const body = {
    id: taskId,
    message: {
      role: 'user',
      parts: [{ type: 'text', text: req.message }],
    },
    ...(req.skillId ? { skillId: req.skillId } : {}),
  };

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...req.headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`A2A 任务发送失败: HTTP ${response.status} ${text.slice(0, 500)}`);
  }

  const data = await response.json();

  // 提取 Agent 的回复文本
  let responseText = '';
  if (data.messages && Array.isArray(data.messages)) {
    const agentMsg = data.messages.find((m: any) => m.role === 'agent');
    if (agentMsg?.parts) {
      responseText = agentMsg.parts
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('\n');
    }
  }
  // 某些实现直接在 artifacts 中返回
  if (!responseText && data.artifacts) {
    responseText = data.artifacts
      .map((a: any) => a.parts?.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('') || '')
      .join('\n');
  }

  return {
    id: data.id || taskId,
    state: data.status?.state || data.state || 'completed',
    response: responseText,
    raw: data,
  };
}

// ===== 任务订阅 (SSE 流式) =====

async function streamTask(
  req: A2ATaskRequest,
  res: Response,
): Promise<void> {
  const taskId = req.taskId || crypto.randomUUID();
  const endpoint = buildEndpoint(req.agentUrl, '/tasks/sendSubscribe');

  const body = {
    id: taskId,
    message: {
      role: 'user',
      parts: [{ type: 'text', text: req.message }],
    },
    ...(req.skillId ? { skillId: req.skillId } : {}),
  };

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendSSE = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendSSE('start', { taskId });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), A2A_TIMEOUT);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        ...req.headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      sendSSE('error', { message: `HTTP ${response.status}: ${text.slice(0, 300)}` });
      res.end();
      clearTimeout(timer);
      return;
    }

    if (!response.body) {
      sendSSE('error', { message: 'No response body from A2A agent' });
      res.end();
      clearTimeout(timer);
      return;
    }

    // 解析 SSE 流
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 按双换行分割 SSE 事件
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data:')) {
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);
            const state = event.status?.state || event.state || 'working';

            // 提取增量文本
            let deltaText = '';
            if (event.messages && Array.isArray(event.messages)) {
              const agentMsg = event.messages.find((m: any) => m.role === 'agent');
              if (agentMsg?.parts) {
                deltaText = agentMsg.parts
                  .filter((p: any) => p.type === 'text')
                  .map((p: any) => p.text)
                  .join('');
              }
            }
            if (deltaText) {
              fullText = deltaText; // A2A 通常发送完整消息而非增量
            }

            sendSSE('delta', {
              state,
              delta: deltaText,
              fullText,
            });

            if (state === 'completed' || state === 'failed' || state === 'canceled') {
              sendSSE('done', {
                taskId: event.id || taskId,
                state,
                response: fullText,
                raw: event,
              });
            }
          } catch {
            // 非 JSON 行，跳过
          }
        }
      }
    }

    clearTimeout(timer);

    // 如果没有收到 done 事件，主动发送
    sendSSE('done', { taskId, state: 'completed', response: fullText });
  } catch (err: any) {
    sendSSE('error', { message: err.message || 'A2A 流式请求失败' });
  } finally {
    res.end();
  }
}

// ===== 路由注册 =====

/** POST /api/a2a/discover — 发现 Agent Card */
router.post('/a2a/discover', async (req: Request, res: Response) => {
  try {
    const { agentUrl, headers } = req.body;

    if (!agentUrl) {
      return res.status(400).json({ success: false, message: '缺少 agentUrl 参数' });
    }
    await assertSafeOutboundUrl(agentUrl, 'agentUrl');

    const card = await discoverAgentCard(agentUrl, headers);
    res.json({ success: true, agentCard: card });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || 'Agent Card 发现失败' });
  }
});

/** POST /api/a2a/send — 非流式发送任务 */
router.post('/a2a/send', async (req: Request, res: Response) => {
  try {
    const { agentUrl, message, taskId, skillId, headers } = req.body;

    if (!agentUrl || !message) {
      return res.status(400).json({ success: false, message: '缺少 agentUrl 或 message 参数' });
    }
    await assertSafeOutboundUrl(agentUrl, 'agentUrl');

    const result = await sendTask({ agentUrl, message, taskId, skillId, headers });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || 'A2A 任务发送失败' });
  }
});

/** POST /api/a2a/stream — SSE 流式发送任务 */
router.post('/a2a/stream', async (req: Request, res: Response) => {
  try {
    const { agentUrl, message, taskId, skillId, headers } = req.body;

    if (!agentUrl || !message) {
      return res.status(400).json({ success: false, message: '缺少 agentUrl 或 message 参数' });
    }
    await assertSafeOutboundUrl(agentUrl, 'agentUrl');

    await streamTask({ agentUrl, message, taskId, skillId, headers }, res);
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: err.message || 'A2A 流式请求失败' });
    }
  }
});

export default router;
