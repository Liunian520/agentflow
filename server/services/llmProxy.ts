/**
 * LLM 代理服务 — 代理 OpenAI / Anthropic / DeepSeek / 自定义 API
 * SSE 流式 + 非流式双模式，避免前端暴露 API Key
 */

import express, { Request, Response } from 'express';
import crypto from 'crypto';

const router = express.Router();

// ===== 类型定义 =====
interface LLMChatRequest {
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
  // 以下是加密私钥相关的字段（复用现有加密体系）
  privateKeyEncrypted?: string;
}

interface LLMChannelConfig {
  apiKey: string;
  baseUrl: string;
  provider: string;
}

// ===== 渠道解密辅助 =====
// 前端可能加密了 apiKey，需要解密
function resolveApiKey(apiKey: string, apiKeyEncrypted?: string): string {
  if (apiKeyEncrypted) {
    // 复用全局 AES 密钥解密
    const aesKey = getOrCreateAesKey();
    return decryptAesGcm(apiKeyEncrypted, aesKey);
  }
  return apiKey;
}

// 复用 server/index.ts 中的加密函数
let currentAesKey: string = '';
let aesKeyGeneratedAt: number = 0;
const AES_KEY_ROTATION_MS = 24 * 60 * 60 * 1000;
const AES_KEY_ENV = process.env.AES_ENCRYPTION_KEY;

function getOrCreateAesKey(): string {
  if (AES_KEY_ENV) return AES_KEY_ENV;
  const now = Date.now();
  if (!currentAesKey || now - aesKeyGeneratedAt > AES_KEY_ROTATION_MS) {
    currentAesKey = crypto.randomBytes(32).toString('hex');
    aesKeyGeneratedAt = now;
  }
  return currentAesKey;
}

function decryptAesGcm(encrypted: string, keyHex: string): string {
  const [ivHex, ctHex] = encrypted.split(':');
  if (!ivHex || !ctHex) throw new Error('加密数据格式错误');

  const keyBuf = Buffer.from(keyHex, 'hex');
  const ivBuf = Buffer.from(ivHex, 'hex');
  const ctBuf = Buffer.from(ctHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, ivBuf);
  const authTag = ctBuf.slice(ctBuf.length - 16);
  const ciphertext = ctBuf.slice(0, ctBuf.length - 16);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

// ===== SSE 辅助 =====
function setupSSE(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function sendSSE(res: Response, event: string, data: any): void {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ===== OpenAI 格式适配（OpenAI / DeepSeek / Azure / 自定义均走此格式） =====
async function callOpenAIFormat(
  baseUrl: string,
  apiKey: string,
  body: Record<string, any>,
  stream: boolean,
  res?: Response
): Promise<string | void> {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, stream }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const errMsg = `LLM API 错误 (${response.status}): ${errorText.slice(0, 500)}`;
    if (stream && res) {
      sendSSE(res, 'error', { message: errMsg, status: response.status });
      res.end();
      return;
    }
    throw new Error(errMsg);
  }

  if (!stream) {
    const json = await response.json();
    const content = json.choices?.[0]?.message?.content || '';
    return content;
  }

  // SSE 流式读取
  if (res) {
    const reader = response.body?.getReader();
    if (!reader) {
      sendSSE(res, 'error', { message: '无法读取流式响应' });
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === ':') continue;
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              sendSSE(res, 'done', { content: fullContent });
              res.end();
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content || '';
              if (delta) {
                fullContent += delta;
                sendSSE(res, 'delta', { content: delta, fullContent });
              }
            } catch {
              // 非 JSON 数据行，跳过
            }
          }
        }
      }
      sendSSE(res, 'done', { content: fullContent });
      res.end();
    } catch (err: any) {
      sendSSE(res, 'error', { message: err.message });
      res.end();
    }
  }
}

// ===== Anthropic 格式适配 =====
async function callAnthropicFormat(
  apiKey: string,
  body: Record<string, any>,
  stream: boolean,
  res?: Response
): Promise<string | void> {
  const url = 'https://api.anthropic.com/v1/messages';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };

  // Anthropic messages API 格式转换
  const anthropicBody = {
    model: body.model,
    max_tokens: body.max_tokens || 4096,
    temperature: body.temperature || 0.7,
    system: body.messages?.find((m: any) => m.role === 'system')?.content || '',
    messages: body.messages
      ?.filter((m: any) => m.role !== 'system')
      .map((m: any) => ({ role: m.role, content: m.content })),
    stream,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(anthropicBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const errMsg = `Anthropic API 错误 (${response.status}): ${errorText.slice(0, 500)}`;
    if (stream && res) {
      sendSSE(res, 'error', { message: errMsg, status: response.status });
      res.end();
      return;
    }
    throw new Error(errMsg);
  }

  if (!stream) {
    const json = await response.json();
    const content = json.content?.[0]?.text || '';
    return content;
  }

  // SSE 流式读取 Anthropic 格式
  if (res) {
    const reader = response.body?.getReader();
    if (!reader) {
      sendSSE(res, 'error', { message: '无法读取流式响应' });
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('event:') && !trimmed.startsWith('data:')) continue;

          // Anthropic 的 SSE 是 event: xxx \n data: {...} 对
          // 我们用简化处理：只看 data 行
          if (trimmed.startsWith('data:')) {
            const data = trimmed.slice(5).trim();
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content_block_delta') {
                const delta = parsed.delta?.text || '';
                if (delta) {
                  fullContent += delta;
                  sendSSE(res, 'delta', { content: delta, fullContent });
                }
              } else if (parsed.type === 'message_stop') {
                sendSSE(res, 'done', { content: fullContent });
                res.end();
                return;
              }
            } catch {
              // 跳过非 JSON
            }
          }
        }
      }
      sendSSE(res, 'done', { content: fullContent });
      res.end();
    } catch (err: any) {
      sendSSE(res, 'error', { message: err.message });
      res.end();
    }
  }
}

// ===== 原始消息返回（供 Agentic 工具循环使用，返回完整 message 以提取 tool_calls） =====
async function callOpenAIRaw(
  baseUrl: string,
  apiKey: string,
  body: Record<string, any>,
): Promise<any> {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ ...body, stream: false }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API 错误 (${response.status}): ${errorText.slice(0, 500)}`);
  }
  return response.json();
}

// 将 OpenAI 格式消息（首轮）或 Anthropic 原生消息（后续轮）统一转换为 Anthropic 格式。
// OpenAI：system 角色 → 顶层 system；tool 角色 → tool_result content block；
// assistant 的 tool_calls → tool_use content block。
function toAnthropicMessages(messages: any[]): { system: string; messages: any[] } {
  let system = '';
  const out: any[] = [];
  for (const m of messages || []) {
    const role = m.role;
    if (role === 'system') {
      system += (system ? '\n' : '') + (m.content || '');
      continue;
    }
    if (role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id || 'unknown',
        content: m.content || '',
      };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }
    if (role === 'assistant') {
      if (m.tool_calls && m.tool_calls.length) {
        const content: any[] = [];
        if (m.content) content.push({ type: 'text', text: m.content });
        for (const tc of m.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function?.name,
            input: safeParseArgs(tc.function?.arguments),
          });
        }
        out.push({ role: 'assistant', content });
        continue;
      }
      if (Array.isArray(m.content)) {
        out.push({ role: 'assistant', content: m.content });
      } else {
        out.push({ role: 'assistant', content: m.content || '' });
      }
      continue;
    }
    // user
    if (Array.isArray(m.content)) {
      out.push({ role: 'user', content: m.content });
    } else {
      out.push({ role: 'user', content: m.content || '' });
    }
  }
  return { system, messages: out };
}

async function callAnthropicRaw(apiKey: string, body: Record<string, any>): Promise<any> {
  const url = 'https://api.anthropic.com/v1/messages';
  // 将 OpenAI 格式 tools 转换为 Anthropic 格式
  const anthropicTools = (body.tools || []).map((t: any) => ({
    name: t.function?.name || t.name,
    description: t.function?.description || t.description || '',
    input_schema: t.function?.parameters || t.input_schema || { type: 'object', properties: {} },
  }));
  const { system, messages: anthropicMessages } = toAnthropicMessages(body.messages);
  const payload: Record<string, any> = {
    model: body.model,
    max_tokens: body.max_tokens || 4096,
    temperature: body.temperature ?? 0.7,
    messages: anthropicMessages,
    stream: false,
  };
  if (system) payload.system = system;
  if (anthropicTools.length > 0) payload.tools = anthropicTools;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText.slice(0, 500)}`);
  }
  return response.json();
}

// ===== Agentic 工具循环（Phase 6：当 LLM 返回 tool_calls 时执行 MCP 工具并回灌） =====
import { executeMcpToolByName } from './mcpService';

const MAX_TOOL_ROUNDS = 5;

async function runAgenticLoop(
  provider: string,
  baseUrl: string,
  apiKey: string,
  initialBody: Record<string, any>,
): Promise<string> {
  let messages: any[] = [...initialBody.messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const body = { ...initialBody, messages };

    if (provider === 'anthropic') {
      const json = await callAnthropicRaw(apiKey, body);
      const toolUses = (json.content || []).filter((b: any) => b.type === 'tool_use');
      const textBlocks = (json.content || []).filter((b: any) => b.type === 'text');
      const text = textBlocks.map((b: any) => b.text).join('\n');

      if (toolUses.length === 0) return text;

      messages.push({ role: 'assistant', content: json.content });
      for (const tu of toolUses) {
        const result = await executeMcpToolByName(tu.name, tu.input || {});
        messages.push({
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: tu.id, content: result },
          ],
        });
      }
    } else {
      const json = await callOpenAIRaw(baseUrl, apiKey, body);
      const message = json.choices?.[0]?.message || {};
      const toolCalls = message.tool_calls || [];

      if (toolCalls.length === 0) return message.content || '';

      messages.push({
        role: 'assistant',
        content: message.content || '',
        tool_calls: toolCalls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      for (const tc of toolCalls) {
        let args: any = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = {};
        }
        const result = await executeMcpToolByName(tc.function.name, args);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: result,
        });
      }
    }
  }

  return '[已达到最大工具调用轮次，停止以避免无限循环]';
}

// ===== 流式 Agentic 工具循环（Phase 7：带工具的 SSE 流式） =====
function safeParseArgs(s: string): any {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

// 将最终文本分片以 SSE 流式下发（用于 Anthropic 工具轮后的纯文本回放）
function streamTextChunked(res: Response, text: string): void {
  const chunkSize = 12;
  let full = '';
  for (let i = 0; i < text.length; i += chunkSize) {
    const piece = text.slice(i, i + chunkSize);
    full += piece;
    sendSSE(res, 'delta', { content: piece, fullContent: full });
  }
}

// 单轮 OpenAI 流式：流式输出文本，同时累积 tool_calls。返回最终文本或待执行工具。
function streamOpenAIRound(
  res: Response,
  baseUrl: string,
  apiKey: string,
  body: Record<string, any>,
): Promise<
  | { type: 'final'; content: string }
  | { type: 'tool'; toolCalls: any[]; assistantMsg: any }
> {
  return new Promise((resolve) => {
    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }) })
      .then(async (response) => {
        if (!response.ok) {
          const errorText = await response.text();
          sendSSE(res, 'error', { message: `LLM API 错误 (${response.status}): ${errorText.slice(0, 500)}` });
          res.end();
          return resolve({ type: 'final', content: '' });
        }
        const reader = response.body?.getReader();
        if (!reader) {
          sendSSE(res, 'error', { message: '无法读取流式响应' });
          res.end();
          return resolve({ type: 'final', content: '' });
        }
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';
        const toolAcc: Map<number, { id: string; name: string; args: string }> = new Map();
        let hasTool = false;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const data = trimmed.slice(5).trim();
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta || {};
                if (delta.content) {
                  fullContent += delta.content;
                  sendSSE(res, 'delta', { content: delta.content, fullContent });
                }
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls as any[]) {
                    const idx = typeof tc.index === 'number' ? tc.index : 0;
                    if (!toolAcc.has(idx)) toolAcc.set(idx, { id: '', name: '', args: '' });
                    const acc = toolAcc.get(idx)!;
                    if (tc.id) acc.id = tc.id;
                    if (tc.function?.name) acc.name = tc.function.name;
                    if (tc.function?.arguments) acc.args += tc.function.arguments;
                  }
                  hasTool = true;
                }
              } catch {
                // 跳过非 JSON
              }
            }
          }
          if (hasTool) {
            const toolCalls = Array.from(toolAcc.values());
            const assistantMsg = {
              role: 'assistant',
              content: fullContent,
              tool_calls: toolCalls.map((a) => ({
                id: a.id,
                type: 'function',
                function: { name: a.name, arguments: a.args },
              })),
            };
            resolve({ type: 'tool', toolCalls, assistantMsg });
          } else {
            resolve({ type: 'final', content: fullContent });
          }
        } catch (err: any) {
          sendSSE(res, 'error', { message: err.message });
          res.end();
          resolve({ type: 'final', content: fullContent });
        }
      })
      .catch((err: any) => {
        sendSSE(res, 'error', { message: err.message });
        res.end();
        resolve({ type: 'final', content: '' });
      });
  });
}

// 流式 Agentic 工具循环：多轮工具调用期间流式输出文本，并实时下发 tool 事件
async function streamAgenticLoop(
  provider: string,
  baseUrl: string,
  apiKey: string,
  initialBody: Record<string, any>,
  res: Response,
): Promise<void> {
  let messages: any[] = [...initialBody.messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const body = { ...initialBody, messages };

    if (provider === 'anthropic') {
      const json = await callAnthropicRaw(apiKey, body);
      const toolUses = (json.content || []).filter((b: any) => b.type === 'tool_use');
      const textBlocks = (json.content || []).filter((b: any) => b.type === 'text');
      const text = textBlocks.map((b: any) => b.text).join('\n');

      if (toolUses.length === 0) {
        if (text) streamTextChunked(res, text);
        sendSSE(res, 'done', { content: text });
        res.end();
        return;
      }

      messages.push({ role: 'assistant', content: json.content });
      for (const tu of toolUses) {
        sendSSE(res, 'tool', { name: tu.name, status: 'running' });
        const result = await executeMcpToolByName(tu.name, tu.input || {});
        sendSSE(res, 'tool', { name: tu.name, status: 'done', result });
        messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: tu.id, content: result }],
        });
      }
    } else {
      const outcome = await streamOpenAIRound(res, baseUrl, apiKey, body);
      if (outcome.type === 'final') {
        sendSSE(res, 'done', { content: outcome.content });
        res.end();
        return;
      }
      messages.push(outcome.assistantMsg);
      for (const tc of outcome.toolCalls) {
        sendSSE(res, 'tool', { name: tc.name, status: 'running' });
        const result = await executeMcpToolByName(tc.name, safeParseArgs(tc.args));
        sendSSE(res, 'tool', { name: tc.name, status: 'done', result });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: result,
        });
      }
    }
  }

  sendSSE(res, 'done', { content: '[已达到最大工具调用轮次，停止以避免无限循环]' });
  res.end();
}

// ===== 主路由 =====

// 非流式聊天
router.post('/chat', async (req: Request, res: Response) => {
  const { provider, baseUrl, apiKey, apiKeyEncrypted, model, messages, temperature, maxTokens, tools } = req.body as LLMChatRequest;

  const resolvedApiKey = resolveApiKey(apiKey, apiKeyEncrypted);

  const body: Record<string, any> = {
    model,
    messages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 4096,
  };
  if (tools && tools.length > 0) body.tools = tools;

  try {
    // Phase 6：配置了工具时走 Agentic 工具循环（LLM 可能返回 tool_calls）
    if (tools && tools.length > 0) {
      const content = await runAgenticLoop(provider, baseUrl, resolvedApiKey, body);
      res.json({
        success: true,
        content: content || '',
        model,
        provider,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    let content: string | void;

    if (provider === 'anthropic') {
      content = await callAnthropicFormat(resolvedApiKey, body, false);
    } else {
      // OpenAI / DeepSeek / Azure / 自定义 均走 OpenAI 格式
      const resolvedBaseUrl = provider === 'azure'
        ? `${baseUrl}/openai/deployments/${model}`
        : baseUrl;
      content = await callOpenAIFormat(resolvedBaseUrl, resolvedApiKey, body, false);
    }

    res.json({
      success: true,
      content: content || '',
      model,
      provider,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
      provider,
      model,
    });
  }
});

// SSE 流式聊天
router.post('/chat/stream', async (req: Request, res: Response) => {
  const { provider, baseUrl, apiKey, apiKeyEncrypted, model, messages, temperature, maxTokens, tools } = req.body as LLMChatRequest;

  const resolvedApiKey = resolveApiKey(apiKey, apiKeyEncrypted);
  setupSSE(res);

  // 发送开始事件
  sendSSE(res, 'start', { model, provider, timestamp: new Date().toISOString() });

  const body: Record<string, any> = {
    model,
    messages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 4096,
  };
  if (tools && tools.length > 0) body.tools = tools;

  try {
    // Phase 7：配置了工具时走流式 Agentic 工具循环（逐轮流式 + 实时工具事件）
    if (tools && tools.length > 0) {
      await streamAgenticLoop(provider, baseUrl, resolvedApiKey, body, res);
      return;
    }

    if (provider === 'anthropic') {
      await callAnthropicFormat(resolvedApiKey, body, true, res);
    } else {
      const resolvedBaseUrl = provider === 'azure'
        ? `${baseUrl}/openai/deployments/${model}`
        : baseUrl;
      await callOpenAIFormat(resolvedBaseUrl, resolvedApiKey, body, true, res);
    }
  } catch (error: any) {
    sendSSE(res, 'error', { message: error.message });
    res.end();
  }
});

export default router;
