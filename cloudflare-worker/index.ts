export interface Env {
  AGENTFLOW_KV: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '');
    const method = request.method;
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cache-Control, X-Relay-Secret',
      'Access-Control-Max-Age': '86400',
    };

    if (method === 'OPTIONS') {
      return new Response('', { headers: corsHeaders, status: 204 });
    }

    const res = await handleRequest(path, method, request, env, ctx);
    if (res instanceof Response) {
      return new Response(res.body, { ...res, headers: { ...corsHeaders, ...Object.fromEntries(res.headers) } });
    }
    return json(res, corsHeaders);
  },
};

function json(data: any, extraHeaders?: Record<string, string>): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders || {}),
  };
  return new Response(JSON.stringify(data), { headers });
}

function ok(data?: any, extraHeaders?: Record<string, string>): Response {
  return json({ success: true, ...(data || {}) }, extraHeaders);
}

function fail(message: string, status = 400): Response {
  return json({ success: false, message }, { status: String(status) } as any);
}

async function readBody(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// ===== KV Helpers =====
const KV_PREFIXES = {
  workflow: 'wf:',
  agent: 'ag:',
  channel: 'ch:',
  message: 'msg:',
  session: 'sess:',
  knowledge: 'kn:',
  trace: 'tr:',
  memory: 'mem:',
  reflection: 'refl:',
  routerRecord: 'rr:',
  task: 'task:',
};

async function kvGet<T>(env: Env, key: string, prefix: string): Promise<T | null> {
  const val = await env.AGENTFLOW_KV.get(prefix + key);
  if (!val) return null;
  try { return JSON.parse(val) as T; } catch { return null; }
}

async function kvPut<T>(env: Env, key: string, value: T, prefix: string): Promise<void> {
  await env.AGENTFLOW_KV.put(prefix + key, JSON.stringify(value));
}

async function kvDelete(env: Env, key: string, prefix: string): Promise<void> {
  await env.AGENTFLOW_KV.delete(prefix + key);
}

async function kvList<T>(env: Env, prefix: string): Promise<T[]> {
  const result = await env.AGENTFLOW_KV.list({ prefix });
  const items: T[] = [];
  for (const key of result.keys) {
    const val = await env.AGENTFLOW_KV.get(key.name);
    if (val) {
      try { items.push(JSON.parse(val) as T); } catch { /* skip */ }
    }
  }
  return items;
}

// ===== Router =====
async function handleRequest(
  path: string,
  method: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<any> {
  const body = method !== 'GET' && method !== 'DELETE' ? await readBody(request) : {};

  // --- Health ---
  if (path === '/health') {
    return ok({ status: 'ok', uptime: Date.now() });
  }

  // --- LLM Proxy ---
  if (path === '/llm/chat/stream' && method === 'POST') {
    return handleLLMStream(body, env, ctx);
  }
  if (path === '/llm/chat' && method === 'POST') {
    return handleLLMChat(body, env);
  }
  if (path === '/llm/test' && method === 'POST') {
    return handleLLMTest(body);
  }
  if (path === '/llm/models' && method === 'POST') {
    return handleLLMModels(body);
  }

  // --- Workflows ---
  if (path === '/workflows') {
    if (method === 'GET') return ok({ workflows: await kvList(env, KV_PREFIXES.workflow) });
    if (method === 'POST') {
      const id = body.id || crypto.randomUUID();
      const item = { ...body, id, createdAt: body.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      await kvPut(env, id, item, KV_PREFIXES.workflow);
      return ok({ workflow: item });
    }
  }
  const wfMatch = path.match(/^\/workflows\/([^/]+)$/);
  if (wfMatch) {
    const id = decodeURIComponent(wfMatch[1]);
    if (method === 'GET') {
      const wf = await kvGet(env, id, KV_PREFIXES.workflow);
      if (!wf) return fail('Not found', 404);
      return ok({ workflow: wf });
    }
    if (method === 'PUT') {
      const existing = await kvGet<any>(env, id, KV_PREFIXES.workflow);
      const merged = { ...(existing || {}), ...body, id, updatedAt: new Date().toISOString() };
      await kvPut(env, id, merged, KV_PREFIXES.workflow);
      return ok({ workflow: merged });
    }
    if (method === 'DELETE') {
      await kvDelete(env, id, KV_PREFIXES.workflow);
      return ok();
    }
  }

  // --- Agents ---
  if (path === '/agents') {
    if (method === 'GET') return ok({ agents: await kvList(env, KV_PREFIXES.agent) });
    if (method === 'POST') {
      const id = body.id || crypto.randomUUID();
      const item = { ...body, id, createdAt: body.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      await kvPut(env, id, item, KV_PREFIXES.agent);
      return ok({ agent: item });
    }
  }
  const agMatch = path.match(/^\/agents\/([^/]+)$/);
  if (agMatch) {
    const id = decodeURIComponent(agMatch[1]);
    if (method === 'GET') {
      const item = await kvGet(env, id, KV_PREFIXES.agent);
      if (!item) return fail('Not found', 404);
      return ok({ agent: item });
    }
    if (method === 'PUT') {
      const existing = await kvGet<any>(env, id, KV_PREFIXES.agent);
      const merged = { ...(existing || {}), ...body, id, updatedAt: new Date().toISOString() };
      await kvPut(env, id, merged, KV_PREFIXES.agent);
      return ok({ agent: merged });
    }
    if (method === 'DELETE') {
      await kvDelete(env, id, KV_PREFIXES.agent);
      return ok();
    }
  }

  // --- Channels ---
  if (path === '/channels') {
    if (method === 'GET') return ok({ channels: await kvList(env, KV_PREFIXES.channel) });
    if (method === 'POST') {
      const id = body.id || crypto.randomUUID();
      const item = { ...body, id };
      await kvPut(env, id, item, KV_PREFIXES.channel);
      return ok({ channel: item });
    }
  }
  const chMatch = path.match(/^\/channels\/([^/]+)$/);
  if (chMatch) {
    const id = decodeURIComponent(chMatch[1]);
    if (method === 'PUT') {
      const existing = await kvGet<any>(env, id, KV_PREFIXES.channel);
      const merged = { ...(existing || {}), ...body, id };
      await kvPut(env, id, merged, KV_PREFIXES.channel);
      return ok({ channel: merged });
    }
    if (method === 'DELETE') {
      await kvDelete(env, id, KV_PREFIXES.channel);
      return ok();
    }
  }

  // --- Messages ---
  const msgMatch = path.match(/^\/messages(?:\/session\/([^/]+))?$/);
  if (msgMatch) {
    if (method === 'GET') {
      const sessionId = msgMatch[1];
      const key = sessionId ? `session:${sessionId}` : 'all';
      const msgs = await kvGet<any[]>(env, key, KV_PREFIXES.message) || [];
      return ok({ messages: msgs });
    }
    if (method === 'POST') {
      const sessionId = body.sessionId;
      if (!sessionId) return fail('sessionId required');
      const key = `session:${sessionId}`;
      const existing = await kvGet<any[]>(env, key, KV_PREFIXES.message) || [];
      existing.push(...(body.messages || [body]));
      await kvPut(env, key, existing, KV_PREFIXES.message);
      return ok({ count: existing.length });
    }
    if (method === 'DELETE') {
      const sessionId = msgMatch[1];
      if (sessionId) {
        await kvDelete(env, `session:${sessionId}`, KV_PREFIXES.message);
      }
      return ok();
    }
  }

  // --- Sessions (元数据: title/updatedAt/lastTaskId) ---
  if (path === '/sessions' && method === 'GET') {
    return ok({ sessions: await kvList(env, KV_PREFIXES.session) });
  }
  if (path === '/sessions' && method === 'POST') {
    const id = body.id || crypto.randomUUID();
    const item = { ...body, id, createdAt: body.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    await kvPut(env, id, item, KV_PREFIXES.session);
    return ok({ session: item });
  }
  const sessMatch = path.match(/^\/sessions\/([^/]+)$/);
  if (sessMatch) {
    const id = decodeURIComponent(sessMatch[1]);
    if (method === 'GET') {
      const s = await kvGet(env, id, KV_PREFIXES.session);
      if (!s) return fail('Not found', 404);
      return ok({ session: s });
    }
    if (method === 'PUT') {
      const existing = await kvGet<any>(env, id, KV_PREFIXES.session);
      const merged = { ...(existing || {}), ...body, id, updatedAt: new Date().toISOString() };
      await kvPut(env, id, merged, KV_PREFIXES.session);
      return ok({ session: merged });
    }
    if (method === 'DELETE') {
      await kvDelete(env, id, KV_PREFIXES.session);
      await kvDelete(env, `session:${id}`, KV_PREFIXES.message);
      return ok();
    }
  }

  // --- Tasks (后台任务状态轮询, 断线恢复用) ---
  const taskMatch = path.match(/^\/tasks\/([^/]+)$/);
  if (taskMatch && method === 'GET') {
    const task = await kvGet<any>(env, taskMatch[1], KV_PREFIXES.task);
    if (!task) return fail('Task not found', 404);
    return ok({ task });
  }

  // --- Dashboard ---
  if (path === '/dashboard/stats' && method === 'GET') {
    const workflows = await kvList(env, KV_PREFIXES.workflow);
    const agents = await kvList(env, KV_PREFIXES.agent);
    const traces = await kvList(env, KV_PREFIXES.trace);
    const recent7d = traces.filter((t: any) => {
      const ts = new Date(t.timestamp || t.createdAt || 0).getTime();
      return Date.now() - ts < 7 * 24 * 3600 * 1000;
    });
    const successes = traces.filter((t: any) => t.outcome === 'success').length;
    const total = traces.length;
    return ok({
      workflowCount: workflows.length,
      agentCount: agents.length,
      totalRuns: total,
      successRate: total > 0 ? Math.round((successes / total) * 100) : 0,
      activeSessions7d: new Set(recent7d.map((t: any) => t.sessionId).filter(Boolean)).size,
    });
  }

  // --- Memory ---
  if (path === '/memory/factual' && method === 'GET') {
    return ok({ entries: await kvList(env, KV_PREFIXES.memory) });
  }
  if (path === '/memory/factual' && method === 'POST') {
    const id = body.id || crypto.randomUUID();
    const item = { ...body, id, createdAt: new Date().toISOString() };
    await kvPut(env, id, item, KV_PREFIXES.memory);
    return ok({ entry: item });
  }
  if (path === '/memory/traces' && method === 'GET') {
    return ok({ traces: await kvList(env, KV_PREFIXES.trace) });
  }
  if (path === '/memory/traces' && method === 'POST') {
    const id = body.id || crypto.randomUUID();
    const item = { ...body, id, timestamp: body.timestamp || new Date().toISOString() };
    await kvPut(env, id, item, KV_PREFIXES.trace);
    return ok({ trace: item });
  }
  if (path === '/memory/reflections' && method === 'GET') {
    return ok({ reflections: await kvList(env, KV_PREFIXES.reflection) });
  }
  if (path === '/memory/reflections' && method === 'POST') {
    const id = body.id || crypto.randomUUID();
    const item = { ...body, id, createdAt: new Date().toISOString() };
    await kvPut(env, id, item, KV_PREFIXES.reflection);
    return ok({ reflection: item });
  }
  if (path === '/memory/router-records' && method === 'GET') {
    return ok({ records: await kvList(env, KV_PREFIXES.routerRecord) });
  }
  if (path === '/memory/router-records' && method === 'POST') {
    const id = body.id || crypto.randomUUID();
    const item = { ...body, id };
    await kvPut(env, id, item, KV_PREFIXES.routerRecord);
    return ok({ record: item });
  }

  // --- Knowledge ---
  if (path === '/knowledge' && method === 'GET') {
    return ok({ docs: await kvList(env, KV_PREFIXES.knowledge) });
  }
  if (path === '/knowledge' && method === 'POST') {
    const id = body.id || crypto.randomUUID();
    const item = { ...body, id, createdAt: new Date().toISOString() };
    await kvPut(env, id, item, KV_PREFIXES.knowledge);
    return ok({ doc: item });
  }
  const knMatch = path.match(/^\/knowledge\/([^/]+)$/);
  if (knMatch && method === 'DELETE') {
    await kvDelete(env, decodeURIComponent(knMatch[1]), KV_PREFIXES.knowledge);
    return ok();
  }

  // --- Default ---
  return json({ success: false, message: `Not found: ${path}` }, { status: '404' });
}

// ===== LLM Proxy Implementation =====

function setupSSE(headers: Record<string, string>): void {
  headers['Content-Type'] = 'text/event-stream';
  headers['Cache-Control'] = 'no-cache';
  headers['Connection'] = 'keep-alive';
}

function sendSSEData(data: any): Uint8Array {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  return new TextEncoder().encode(payload);
}

async function handleLLMStream(body: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { provider, baseUrl, apiKey, model, messages, temperature, maxTokens, sessionId, taskId, tools } = body;
  const headers: Record<string, string> = {};
  setupSSE(headers);

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  const safeWrite = (payload: string) =>
    writer.write(encoder.encode(payload)).catch(() => {});

  const sendEvent = (event: string, data: any) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    return safeWrite(payload);
  };

  if (!baseUrl || !apiKey || !model) {
    const errPayload = `event: error\ndata: ${JSON.stringify({ message: '缺少必要参数: baseUrl, apiKey, model' })}\n\n`;
    return new Response(new ReadableStream({ start(ctrl) { ctrl.enqueue(encoder.encode(errPayload)); ctrl.close(); } }), { headers });
  }

  if (sessionId) {
    try {
      const userMsg = messages[messages.length - 1];
      const existing = await kvGet<any[]>(env, `session:${sessionId}`, KV_PREFIXES.message) || [];
      await kvPut(env, `session:${sessionId}`, [...existing, userMsg], KV_PREFIXES.message);
    } catch { /* persistent failure non-blocking */ }
  }
  if (taskId) {
    await kvPut(env, taskId, { status: 'running', sessionId, startedAt: Date.now() }, KV_PREFIXES.task);
  }

  // 工具执行器：Worker 端内置 + 前端委托
  const toolExecutors: Record<string, (args: any) => Promise<any>> = {
    // Worker 直接执行的工具（如记忆、KV 操作）
    memory_save: async (args) => {
      const memId = crypto.randomUUID();
      const mem = {
        id: memId,
        type: args.type || 'reference',
        content: args.content,
        importance: args.importance ?? 0.7,
        createdAt: Date.now(),
        sessionId,
      };
      await kvPut(env, memId, mem, KV_PREFIXES.memory);
      return { success: true, id: memId, message: '记忆已保存' };
    },
    memory_search: async (args) => {
      const results = await kvList<any>(env, KV_PREFIXES.memory);
      const query = (args.query || args.content || '').toLowerCase();
      const typeFilter = args.type;
      const limit = Math.min(parseInt(String(args.limit ?? 5)) || 5, 20);
      const sid = sessionId || '';
      const filtered = results.filter((m: any) => {
        const matchQuery = !query || m.content?.toLowerCase().includes(query)
          || m.keywords?.toLowerCase?.().includes(query)
          || m.tags?.toLowerCase?.().includes(query);
        const matchType = !typeFilter || m.type === typeFilter;
        const matchSession = !sid || m.sessionId === sid || !m.sessionId || m.sessionId === '';
        return matchQuery && matchType && matchSession;
      });
      const sorted = filtered.sort((a: any, b: any) =>
        new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
      );
      return { success: true, count: sorted.length, memories: sorted.slice(0, limit), results: sorted.slice(0, limit) };
    },
    memory_update: async (args) => {
      const existing = await kvGet<any>(env, args.id, KV_PREFIXES.memory);
      if (!existing) return { success: false, message: '记忆未找到' };
      const updated = { ...existing, ...args, updatedAt: Date.now() };
      await kvPut(env, args.id, updated, KV_PREFIXES.memory);
      return { success: true, message: '记忆已更新' };
    },
    memory_delete: async (args) => {
      await kvDelete(env, args.id, KV_PREFIXES.memory);
      return { success: true, message: '记忆已删除' };
    },
    builtin_datetime: async () => {
      const now = new Date();
      return {
        success: true,
        message: '获取当前时间成功',
        data: {
          iso: now.toISOString(),
          locale: now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
          timestamp: now.getTime(),
          date: now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }),
          time: now.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' }),
          dayOfWeek: ['日', '一', '二', '三', '四', '五', '六'][now.getDay()],
        },
      };
    },
    builtin_calculator: async (args) => {
      const expr = String(args.expression || '').trim();
      if (!expr) return { success: false, message: 'expression 不能为空' };
      if (!/^[\d\s+\-*/().%^]+$/.test(expr)) {
        return { success: false, message: '表达式包含非法字符，仅支持数字和 + - * / ( ) % ^' };
      }
      try {
        const result = Function(`"use strict"; return (${expr.replace(/\^/g, '**')});`)();
        if (typeof result !== 'number' || !isFinite(result)) {
          return { success: false, message: '计算结果无效' };
        }
        return { success: true, message: '计算完成', result, expression: expr };
      } catch (e: any) {
        return { success: false, message: `计算错误: ${e.message}` };
      }
    },
    builtin_web_search: async (args) => {
      const query = String(args.query || '').trim();
      if (!query) return { success: false, message: '搜索关键词不能为空' };
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        if (!response.ok) return { success: false, message: `搜索请求失败 (${response.status})` };
        const html = await response.text();
        const results: Array<{ title: string; url: string; snippet: string }> = [];
        const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g;
        const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/g;
        let match: RegExpExecArray | null;
        const snippets: string[] = [];
        while ((match = snippetRegex.exec(html)) !== null) {
          snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
        }
        let i = 0;
        while ((match = linkRegex.exec(html)) !== null && i < 8) {
          const rawUrl = match[1];
          const title = match[2].replace(/<[^>]+>/g, '').trim();
          const urlMatch = rawUrl.match(/uddg=([^&]+)/);
          const actualUrl = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;
          if (title && actualUrl) {
            results.push({ title, url: actualUrl, snippet: snippets[i] || '' });
            i++;
          }
        }
        return { success: true, message: `找到 ${results.length} 条结果`, results };
      } catch (e: any) {
        return { success: false, message: `搜索失败: ${e.message}` };
      }
    },
    builtin_web_fetch: async (args) => {
      const url = String(args.url || '').trim();
      if (!url) return { success: false, message: 'URL 不能为空' };
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { success: false, message: 'URL 格式无效' };
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { success: false, message: `不支持的协议: ${parsed.protocol}` };
      }
      const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      const isPrivate = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|0\.|localhost$|localdomain$|\.internal$|169\.254\.|::1$|fc00:|fe80:)/i.test(hostname)
        || hostname === 'metadata.google.internal'
        || hostname === '169.254.169.254'
        || hostname.endsWith('.amazonaws.com') && hostname.includes('metadata');
      if (isPrivate) {
        return { success: false, message: `禁止访问内网地址: ${hostname}` };
      }
      try {
        const response = await fetch(parsed.href, {
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          redirect: 'manual',
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (location) {
            const redirectUrl = new URL(location, parsed.href);
            return { success: false, message: `重定向被拒绝: ${redirectUrl.hostname}` };
          }
        }
        if (!response.ok) return { success: false, message: `请求失败 (${response.status})` };
        const html = await response.text();
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : '';
        let text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (text.length > 4000) text = text.slice(0, 4000) + '...';
        return { success: true, message: '抓取成功', title, text, url: parsed.href };
      } catch (e: any) {
        return { success: false, message: `抓取失败: ${e.message}` };
      }
    },
    builtin_code_run: async () => {
      return { success: false, message: '代码执行功能暂未在服务端启用' };
    },
  };

  ctx.waitUntil((async () => {
    try {
      await sendEvent('start', { model, provider, taskId });

      const MAX_TOOL_ROUNDS = 5;
      let currentMessages = [...messages];
      let round = 0;

      for (; round < MAX_TOOL_ROUNDS; round++) {
        let toolCallsFromLast: any[] = [];
        let lastContent = '';

        await proxyLLMRequest({
          provider, baseUrl, apiKey, model,
          messages: currentMessages,
          temperature, maxTokens,
          stream: true,
          tools: tools && tools.length > 0 ? tools : undefined,
          onDelta: async (content, fullContent) => {
            await sendEvent('delta', { content, fullContent });
          },
          onReasoning: async (content, fullContent) => {
            await sendEvent('reasoning', { content, fullContent });
          },
          onDone: async (content, toolCalls, reasoningContent) => {
            lastContent = content;
            toolCallsFromLast = toolCalls || [];
            await sendEvent('done', { content, toolCalls: toolCallsFromLast, reasoningContent: reasoningContent || '' });
          },
          onError: async (message) => {
            await sendEvent('error', { message });
          },
        });

        if (toolCallsFromLast.length === 0) {
          // 没有工具调用，结束循环
          break;
        }

        // 有工具调用 → 推送到前端，执行，回填结果
        const assistantMsg: any = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: lastContent,
          timestamp: new Date().toISOString(),
          messageType: 'text',
          tool_calls: toolCallsFromLast.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          })),
        };
        currentMessages.push(assistantMsg);

        const toolResults: any[] = [];
        for (const tc of toolCallsFromLast) {
          await sendEvent('tool', { name: tc.name, status: 'running' });

          let toolResult: any;
          let argsParsed: any;
          try {
            argsParsed = JSON.parse(tc.arguments || '{}');
          } catch {
            argsParsed = {};
          }

          try {
            const executor = toolExecutors[tc.name];
            if (executor) {
              toolResult = await executor(argsParsed);
            } else {
              toolResult = { _delegate: true, toolName: tc.name, args: argsParsed };
            }
          } catch (toolErr: any) {
            toolResult = { success: false, message: `工具执行异常: ${toolErr?.message || String(toolErr)}` };
          }

          await sendEvent('tool', { name: tc.name, status: 'done', result: JSON.stringify(toolResult) });

          toolResults.push({
            tool_call_id: tc.id,
            content: JSON.stringify(toolResult),
          });
        }

        // 将工具结果添加到消息
        for (let i = 0; i < toolResults.length; i++) {
          currentMessages.push({
            role: 'tool',
            content: toolResults[i].content,
            tool_call_id: toolResults[i].tool_call_id,
          });
        }
      }

      // 落盘最终消息
      if (sessionId) {
        try {
          const hist = await kvGet<any[]>(env, `session:${sessionId}`, KV_PREFIXES.message) || [];
          const lastAssistant = currentMessages.filter((m) => m.role === 'assistant').pop();
          if (lastAssistant) {
            await kvPut(env, `session:${sessionId}`, [...hist, {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: lastAssistant.content || '(工具调用完成)',
              timestamp: new Date().toISOString(),
              messageType: 'text',
              model,
              provider,
            }], KV_PREFIXES.message);
          }
        } catch { /* persistent failure non-blocking */ }
      }
      if (taskId) {
        await kvPut(env, taskId, { status: 'done', sessionId, content: lastContent, toolRounds: round, finishedAt: Date.now() }, KV_PREFIXES.task);
      }
    } catch (err: any) {
      try {
        await sendEvent('error', { message: err.message });
      } catch { /* ignore */ }
      if (taskId) {
        await kvPut(env, taskId, { status: 'error', sessionId, message: err.message, finishedAt: Date.now() }, KV_PREFIXES.task);
      }
    } finally {
      writer.close().catch(() => {});
    }
  })());

  return new Response(stream.readable, { headers });
}

async function handleLLMChat(body: any, env: Env): Promise<Response> {
  try {
    const { provider, baseUrl, apiKey, model, messages, temperature, maxTokens, tools, sessionId } = body;

    if (!tools || tools.length === 0) {
      const content = await proxyLLMRequest({
        provider, baseUrl, apiKey, model, messages,
        temperature, maxTokens, stream: false,
      });
      return ok({ success: true, content, model, provider, timestamp: new Date().toISOString() });
    }

    const toolExecutors: Record<string, (args: any) => Promise<any>> = {
      memory_save: async (args) => {
        const memId = crypto.randomUUID();
        const mem = {
          id: memId, type: args.type || 'reference',
          content: args.content, importance: args.importance ?? 0.7,
          createdAt: Date.now(), sessionId,
        };
        await kvPut(env, memId, mem, KV_PREFIXES.memory);
        return { success: true, id: memId, message: '记忆已保存' };
      },
      memory_search: async (args) => {
        const results = await kvList<any>(env, KV_PREFIXES.memory);
        const query = (args.query || args.content || '').toLowerCase();
        const typeFilter = args.type;
        const limit = Math.min(parseInt(String(args.limit ?? 5)) || 5, 20);
        const sid = sessionId || '';
        const filtered = results.filter((m: any) => {
          const matchQuery = !query || m.content?.toLowerCase().includes(query)
            || m.keywords?.toLowerCase?.().includes(query)
            || m.tags?.toLowerCase?.().includes(query);
          const matchType = !typeFilter || m.type === typeFilter;
          const matchSession = !sid || m.sessionId === sid || !m.sessionId || m.sessionId === '';
          return matchQuery && matchType && matchSession;
        });
        const sorted = filtered.sort((a: any, b: any) =>
          new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
        );
        return { success: true, count: sorted.length, memories: sorted.slice(0, limit), results: sorted.slice(0, limit) };
      },
      memory_update: async (args) => {
        const existing = await kvGet<any>(env, args.id, KV_PREFIXES.memory);
        if (!existing) return { success: false, message: '记忆未找到' };
        const updated = { ...existing, ...args, updatedAt: Date.now() };
        await kvPut(env, args.id, updated, KV_PREFIXES.memory);
        return { success: true, message: '记忆已更新' };
      },
      memory_delete: async (args) => {
        await kvDelete(env, args.id, KV_PREFIXES.memory);
        return { success: true, message: '记忆已删除' };
      },
      builtin_datetime: async () => {
        const now = new Date();
        return {
          success: true, message: '获取当前时间成功',
          data: {
            iso: now.toISOString(),
            locale: now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
            timestamp: now.getTime(),
            date: now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }),
            time: now.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' }),
            dayOfWeek: ['日', '一', '二', '三', '四', '五', '六'][now.getDay()],
          },
        };
      },
      builtin_calculator: async (args) => {
        const expr = String(args.expression || '').trim();
        if (!expr) return { success: false, message: 'expression 不能为空' };
        if (!/^[\d\s+\-*/().%^]+$/.test(expr)) {
          return { success: false, message: '表达式包含非法字符，仅支持数字和 + - * / ( ) % ^' };
        }
        try {
          const result = Function(`"use strict"; return (${expr.replace(/\^/g, '**')});`)();
          if (typeof result !== 'number' || !isFinite(result)) {
            return { success: false, message: '计算结果无效' };
          }
          return { success: true, message: '计算完成', result, expression: expr };
        } catch (e: any) {
          return { success: false, message: `计算错误: ${e.message}` };
        }
      },
      builtin_web_search: async (args) => {
        const query = String(args.query || '').trim();
        if (!query) return { success: false, message: '搜索关键词不能为空' };
        try {
          const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          });
          if (!response.ok) return { success: false, message: `搜索请求失败 (${response.status})` };
          const html = await response.text();
          const results: Array<{ title: string; url: string; snippet: string }> = [];
          const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g;
          const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/g;
          let match: RegExpExecArray | null;
          const snippets: string[] = [];
          while ((match = snippetRegex.exec(html)) !== null) {
            snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
          }
          let i = 0;
          while ((match = linkRegex.exec(html)) !== null && i < 8) {
            const rawUrl = match[1];
            const title = match[2].replace(/<[^>]+>/g, '').trim();
            const urlMatch = rawUrl.match(/uddg=([^&]+)/);
            const actualUrl = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;
            if (title && actualUrl) {
              results.push({ title, url: actualUrl, snippet: snippets[i] || '' });
              i++;
            }
          }
          return { success: true, message: `找到 ${results.length} 条结果`, results };
        } catch (e: any) {
          return { success: false, message: `搜索失败: ${e.message}` };
        }
      },
      builtin_web_fetch: async (args) => {
        const url = String(args.url || '').trim();
        if (!url) return { success: false, message: 'URL 不能为空' };
        let parsed: URL;
        try { parsed = new URL(url); } catch {
          return { success: false, message: 'URL 格式无效' };
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return { success: false, message: `不支持的协议: ${parsed.protocol}` };
        }
        const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
        const isPrivate = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|0\.|localhost$|localdomain$|\.internal$|169\.254\.|::1$|fc00:|fe80:)/i.test(hostname)
          || hostname === 'metadata.google.internal'
          || hostname === '169.254.169.254'
          || (hostname.endsWith('.amazonaws.com') && hostname.includes('metadata'));
        if (isPrivate) return { success: false, message: `禁止访问内网地址: ${hostname}` };
        try {
          const response = await fetch(parsed.href, {
            method: 'GET',
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            redirect: 'manual',
          });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (location) {
              const redirectUrl = new URL(location, parsed.href);
              return { success: false, message: `重定向被拒绝: ${redirectUrl.hostname}` };
            }
          }
          if (!response.ok) return { success: false, message: `请求失败 (${response.status})` };
          const html = await response.text();
          const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const title = titleMatch ? titleMatch[1].trim() : '';
          let text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (text.length > 4000) text = text.slice(0, 4000) + '...';
          return { success: true, message: '抓取成功', title, text, url: parsed.href };
        } catch (e: any) {
          return { success: false, message: `抓取失败: ${e.message}` };
        }
      },
      builtin_code_run: async () => {
        return { success: false, message: '代码执行功能暂未在服务端启用' };
      },
    };

    const runAgenticLoop = async (): Promise<string> => {
      let currentMessages = [...messages];
      const MAX_ROUNDS = 5;

      for (let round = 0; round < MAX_ROUNDS; round++) {
        const json: any = await proxyLLMRequestRaw({
          provider, baseUrl, apiKey, model,
          messages: currentMessages,
          temperature, maxTokens, stream: false, tools,
        });

        if (provider === 'anthropic') {
          const toolUses = (json.content || []).filter((b: any) => b.type === 'tool_use');
          const textBlocks = (json.content || []).filter((b: any) => b.type === 'text');
          const text = textBlocks.map((b: any) => b.text).join('\n');
          if (toolUses.length === 0) return text;

          currentMessages.push({ role: 'assistant', content: json.content });
          const toolResultBlocks: any[] = [];
          for (const tu of toolUses) {
            let toolResult: any;
            try {
              const executor = toolExecutors[tu.name];
              toolResult = executor ? await executor(tu.input || {}) : { success: false, message: `未知工具: ${tu.name}` };
            } catch (e: any) {
              toolResult = { success: false, message: `工具执行异常: ${e.message}` };
            }
            toolResultBlocks.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify(toolResult),
            });
          }
          currentMessages.push({ role: 'user', content: toolResultBlocks });
        } else if (provider === 'google') {
          throw new Error('当前 agentic loop 暂不支持 Google provider 的工具调用，请使用 OpenAI 或 Anthropic');
        } else {
          const msg = json.choices?.[0]?.message || {};
          const toolCalls = msg.tool_calls || [];
          if (toolCalls.length === 0) return msg.content || '';

          currentMessages.push({
            role: 'assistant', content: msg.content || '',
            tool_calls: toolCalls.map((tc: any) => ({
              id: tc.id, type: 'function',
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          });
          for (const tc of toolCalls) {
            let args = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
            let toolResult: any;
            try {
              const executor = toolExecutors[tc.function.name];
              toolResult = executor ? await executor(args) : { success: false, message: `未知工具: ${tc.function.name}` };
            } catch (e: any) {
              toolResult = { success: false, message: `工具执行异常: ${e.message}` };
            }
            currentMessages.push({
              role: 'tool', tool_call_id: tc.id,
              name: tc.function.name, content: JSON.stringify(toolResult),
            });
          }
        }
      }
      // 达到最大轮次，发送一次不带 tools 的请求做总结
      try {
        const summaryJson: any = await proxyLLMRequestRaw({
          provider, baseUrl, apiKey, model,
          messages: [...currentMessages, { role: 'user', content: '请根据以上工具调用的结果，给出最终回答。' }],
          temperature, maxTokens, stream: false,
          tools: undefined,
        });
        if (provider === 'anthropic') {
          const textBlocks = (summaryJson.content || []).filter((b: any) => b.type === 'text');
          const summary = textBlocks.map((b: any) => b.text).join('\n');
          if (summary) return summary;
        } else {
          const summary = summaryJson.choices?.[0]?.message?.content || '';
          if (summary) return summary;
        }
      } catch {
        // 总结请求失败，返回提示
      }
      return '[已达到最大工具调用轮次，停止以避免无限循环]';
    };

    const content = await runAgenticLoop();
    return ok({ success: true, content, model, provider, timestamp: new Date().toISOString() });
  } catch (err: any) {
    return fail(err.message || 'LLM 调用失败', 500);
  }
}

async function handleLLMTest(body: any): Promise<Response> {
  const { provider, baseUrl, apiKey, model } = body;
  if (!baseUrl || !apiKey) return fail('缺少 baseUrl 或 apiKey');

  const start = Date.now();
  try {
    const url = getProviderUrl(provider, baseUrl, model, false);
    const response = await fetch(url, {
      method: 'POST',
      headers: getProviderHeaders(provider, apiKey),
      body: JSON.stringify(buildProviderBody(provider, model, [{ role: 'user', content: 'hi' }], 0.7, 100, false)),
    });
    const latency = Date.now() - start;
    if (!response.ok) {
      const text = await response.text();
      return {
        success: false, latency, message: `连接失败 (${response.status}): ${text.slice(0, 200)}`,
        status: response.status,
      };
    }
    const json = await response.json();
    const content = extractContent(provider, json);
    return ok({ success: true, latency, message: '连接成功', model: content ? model : undefined });
  } catch (err: any) {
    return {
      success: false, latency: Date.now() - start,
      message: err.message || '连接超时或网络错误',
    };
  }
}

async function handleLLMModels(body: any): Promise<Response> {
  const { provider, apiKey, baseUrl } = body;
  if (!apiKey) return fail('缺少 apiKey');

  try {
    const url = provider === 'anthropic'
      ? `${(baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '').replace(/\/v1$/i, '')}/v1/models`
      : `${(baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '')}/models`;

    const response = await fetch(url, {
      headers: getProviderHeaders(provider, apiKey),
    });
    if (!response.ok) return fail(`拉取模型失败 (${response.status})`);
    const json = await response.json();
    const models = (json.data || []).map((m: any) => ({
      id: m.id,
      name: m.id,
      displayName: m.id,
    }));
    return ok({ models });
  } catch (err: any) {
    return fail(err.message || '拉取模型失败', 500);
  }
}

// ===== LLM Proxy Core =====

interface ProxyOptions {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: any[];
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
  tools?: any[];
  onDelta?: (content: string, fullContent: string) => Promise<void>;
  onReasoning?: (content: string, fullContent: string) => Promise<void>;
  onDone?: (content: string, toolCalls?: any[], reasoningContent?: string) => Promise<void>;
  onError?: (message: string) => Promise<void>;
}

async function proxyLLMRequestRaw(opts: ProxyOptions): Promise<any> {
  const { provider, baseUrl, apiKey, model, messages, temperature, maxTokens, stream, tools } = opts;

  const url = getProviderUrl(provider, baseUrl, model, stream);
  const body = buildProviderBody(provider, model, messages, temperature, maxTokens, stream, tools);
  const headers = getProviderHeaders(provider, apiKey);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API 错误 (${response.status}): ${text.slice(0, 500)}`);
  }

  return response.json();
}

async function proxyLLMRequest(opts: ProxyOptions): Promise<string> {
  const { provider, baseUrl, apiKey, model, messages, temperature, maxTokens, stream, tools } = opts;

  const url = getProviderUrl(provider, baseUrl, model, stream);
  const body = buildProviderBody(provider, model, messages, temperature, maxTokens, stream, tools);
  const headers = getProviderHeaders(provider, apiKey);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API 错误 (${response.status}): ${text.slice(0, 500)}`);
  }

  if (!stream) {
    const json = await response.json();
    const toolCalls = extractToolCalls(provider, json);
    const content = extractContent(provider, json);
    if (toolCalls && toolCalls.length > 0) {
      opts.onDone?.(content, toolCalls);
    } else {
      opts.onDone?.(content);
    }
    return content;
  }

  // Stream mode
  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取流式响应');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let fullReasoningContent = '';
  let accumulatedToolCalls: any[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === ':') continue;

      if (provider === 'anthropic') {
        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            await opts.onDone?.(fullContent, accumulatedToolCalls, fullReasoningContent || undefined);
            return fullContent;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta') {
              const delta = parsed.delta?.text || '';
              const thinkingDelta = parsed.delta?.thinking || '';
              if (delta) {
                fullContent += delta;
                await opts.onDelta?.(delta, fullContent);
              }
              if (thinkingDelta) {
                fullReasoningContent += thinkingDelta;
                await opts.onReasoning?.(thinkingDelta, fullReasoningContent);
              }
            } else if (parsed.type === 'tool_use_start' || parsed.type === 'tool_use_delta') {
              const tcIndex = accumulatedToolCalls.length;
              if (!accumulatedToolCalls[tcIndex]) {
                accumulatedToolCalls[tcIndex] = { id: parsed.id || `tool-${Date.now()}`, name: parsed.name || '', arguments: '' };
              }
              if (parsed.input) {
                accumulatedToolCalls[tcIndex].arguments += parsed.input;
              }
            } else if (parsed.type === 'message_stop') {
              await opts.onDone?.(fullContent, accumulatedToolCalls, fullReasoningContent || undefined);
              return fullContent;
            }
          } catch { /* skip */ }
        }
      } else {
        // OpenAI / DeepSeek / Gemini compatible
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            await opts.onDone?.(fullContent, accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined, fullReasoningContent || undefined);
            return fullContent;
          }
          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            if (!choice) continue;

            // 处理 tool_calls 流式增量
            if (choice.delta?.tool_calls) {
              for (const tcDelta of choice.delta.tool_calls) {
                const tcIndex = tcDelta.index ?? 0;
                if (!accumulatedToolCalls[tcIndex]) {
                  accumulatedToolCalls[tcIndex] = { id: '', name: '', arguments: '' };
                }
                const tc = accumulatedToolCalls[tcIndex];
                if (tcDelta.id) tc.id = tcDelta.id;
                if (tcDelta.function?.name) tc.name = tcDelta.function.name;
                if (tcDelta.function?.arguments) tc.arguments += tcDelta.function.arguments;
              }
            }

            // 处理推理内容（DeepSeek-R1 等模型的 reasoning_content）
            const reasoningDelta = choice.delta?.reasoning_content || '';
            if (reasoningDelta) {
              fullReasoningContent += reasoningDelta;
              await opts.onReasoning?.(reasoningDelta, fullReasoningContent);
            }

            const delta = choice.delta?.content || '';
            if (delta) {
              fullContent += delta;
              await opts.onDelta?.(delta, fullContent);
            }
          } catch { /* skip */ }
        }
      }
    }
  }

  await opts.onDone?.(fullContent, accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined, fullReasoningContent || undefined);
  return fullContent;
}

/** 从非流式响应中提取 tool_calls */
function extractToolCalls(provider: string, json: any): any[] {
  if (provider === 'anthropic') {
    const content = json.content || [];
    return content
      .filter((b: any) => b.type === 'tool_use')
      .map((b: any) => ({
        id: b.id,
        name: b.name,
        arguments: typeof b.input === 'string' ? b.input : JSON.stringify(b.input || {}),
      }));
  }
  const msg = json.choices?.[0]?.message;
  if (msg?.tool_calls) {
    return msg.tool_calls.map((tc: any) => ({
      id: tc.id,
      name: tc.function?.name,
      arguments: tc.function?.arguments || '',
    }));
  }
  return [];
}

function getProviderUrl(provider: string, baseUrl: string, model: string, stream: boolean): string {
  switch (provider) {
    case 'anthropic': {
      const cleanBase = (baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '').replace(/\/v1$/i, '') || 'https://api.anthropic.com';
      return `${cleanBase}/v1/messages`;
    }
    case 'google': {
      const cleanBase = (baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '').replace(/\/v1(?:beta)?$/i, '') || 'https://generativelanguage.googleapis.com';
      const action = stream ? 'streamGenerateContent' : 'generateContent';
      return `${cleanBase}/v1beta/models/${model}:${action}`;
    }
    default: {
      const cleanBase = (baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
      return `${cleanBase}/chat/completions`;
    }
  }
}

function getProviderHeaders(provider: string, apiKey: string): Record<string, string> {
  switch (provider) {
    case 'anthropic':
      return {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
    case 'google':
      return { 'Content-Type': 'application/json' };
    default:
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      };
  }
}

function toAnthropicMessages(messages: any[]): { role: string; content: any }[] {
  const out: any[] = [];
  for (const m of messages || []) {
    const role = m.role;
    if (role === 'system') continue;
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
          let input = {};
          try { input = JSON.parse(tc.function?.arguments || '{}'); } catch {}
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function?.name || tc.name,
            input,
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
    if (Array.isArray(m.content)) {
      out.push({ role: 'user', content: m.content });
    } else {
      out.push({ role: 'user', content: m.content || '' });
    }
  }
  return out;
}

function buildProviderBody(provider: string, model: string, messages: any[], temperature?: number, maxTokens?: number, stream?: boolean, tools?: any[]): any {
  switch (provider) {
    case 'anthropic': {
      const systemContent = messages.find((m: any) => m.role === 'system')?.content;
      const anthropicMessages = toAnthropicMessages(messages);
      const body: any = {
        model,
        max_tokens: maxTokens || 4096,
        temperature: temperature ?? 0.7,
        messages: anthropicMessages,
        stream,
        ...(systemContent ? { system: systemContent } : {}),
      };
      if (tools && tools.length > 0) {
        body.tools = tools.map((t) => ({
          name: t.function?.name || t.name,
          description: t.function?.description || t.description || '',
          input_schema: t.function?.parameters || t.parameters || { type: 'object', properties: {} },
        }));
      }
      return body;
    }
    case 'google': {
      const systemContent = messages.find((m: any) => m.role === 'system')?.content || '';
      const contents = (messages || [])
        .filter((m: any) => m.role !== 'system')
        .map((m: any) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));
      const body: any = {
        contents,
        generationConfig: {
          temperature: temperature ?? 0.7,
          maxOutputTokens: maxTokens || 4096,
        },
      };
      if (systemContent) body.systemInstruction = { parts: [{ text: systemContent }] };
      if (tools && tools.length > 0) {
        body.tools = [{
          functionDeclarations: tools.map((t) => ({
            name: t.function?.name || t.name,
            description: t.function?.description || t.description || '',
            parameters: t.function?.parameters || t.parameters || { type: 'object', properties: {} },
          })),
        }];
      }
      return body;
    }
    default: {
      const body: any = {
        model,
        messages,
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens || 4096,
        stream,
      };
      if (tools && tools.length > 0) {
        body.tools = tools.map((t) => {
          if (t.type === 'function' && t.function) {
            return { type: 'function', function: t.function };
          }
          return { type: 'function', function: t };
        });
      }
      return body;
    }
  }
}

function extractContent(provider: string, json: any): string {
  switch (provider) {
    case 'google':
      return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    default:
      return json.choices?.[0]?.message?.content || '';
  }
}
