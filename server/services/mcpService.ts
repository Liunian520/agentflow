/**
 * MCP 客户端服务
 * - HTTP/SSE 传输：纯 fetch 实现的 MCP Streamable HTTP / SSE 客户端（不依赖 SDK，避免浏览器打包引入后端依赖）
 * - local-fs 传输：在后端本地 spawn stdio 型 MCP server（如 @modelcontextprotocol/server-filesystem <dir>），
 *   通过子进程 stdin/stdout 做 JSON-RPC，让对话式 AI 能直接读写"服务器上的某个目录"
 * 统一通过 JSON-RPC 2.0 与 MCP 服务器通信：initialize / tools/list / tools/call
 */

import type { Request, Response } from 'express';
import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { assertSafeOutboundUrl, safeFetch } from './urlGuard';

/**
 * 校验 local-fs 要暴露的目录：
 *  - 必须是绝对路径且真实存在的目录
 *  - 拒绝路径穿越 (..)
 *  - 拒绝系统敏感根目录
 *  - 若配置了 MCP_FS_ALLOWED_ROOTS（逗号分隔），则必须位于其中之一
 */
export function assertSafeFsDir(dir: string): string {
  if (!dir || !path.isAbsolute(dir)) {
    throw new Error('fsDir 必须为绝对路径');
  }
  const resolved = path.resolve(dir);

  let real = resolved;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    throw new Error(`fsDir 不存在: ${resolved}`);
  }

  const deniedRoots = ['/etc', '/root', '/boot', '/sys', '/proc', '/dev', '/run', '/bin', '/sbin', '/usr', '/var'];
  const lower = real.toLowerCase();
  if (lower === '/' || deniedRoots.some((root) => lower === root || lower.startsWith(root + path.sep))) {
    throw new Error(`fsDir 拒绝暴露系统目录: ${real}`);
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(real);
  } catch {
    throw new Error(`fsDir 不存在: ${real}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`fsDir 不是目录: ${real}`);
  }

  const allowed = (process.env.MCP_FS_ALLOWED_ROOTS || '')
    .split(',').map((s) => s.trim()).filter(Boolean).map((p) => path.resolve(p));
  if (allowed.length > 0) {
    const ok = allowed.some((root) => {
      const rel = path.relative(root, real);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
    if (!ok) {
      throw new Error(`fsDir 不在允许的根目录白名单内: ${real}`);
    }
  }
  return real;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: any;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: 'streamable-http' | 'sse' | 'local-fs';
  url?: string;            // streamable-http / sse 使用
  fsDir?: string;          // local-fs 使用：要暴露给 AI 的目录绝对路径
  headers?: Record<string, string>;
}

interface McpSession {
  config: McpServerConfig;
  sessionId?: string;
  tools: McpTool[];
  protocolVersion: string;
  // local-fs 专用
  child?: any;
  pending?: Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>;
  stdioBuf?: string;
  spawnError?: string;
}

// 运行时内存会话注册表（按 server id 索引）
const sessions = new Map<string, McpSession>();

const PROTOCOL_VERSION = '2024-11-05';

// ===== HTTP / SSE 传输（fetch 实现） =====
// 单次 JSON-RPC 调用，兼容 application/json 与 text/event-stream（SSE）响应
async function rpc(session: McpSession, method: string, params: any, notify = false): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(session.config.headers || {}),
  };
  if (session.sessionId) headers['Mcp-Session-Id'] = session.sessionId;

  const res = await safeFetch(session.config.url!, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: notify ? undefined : Date.now(), method, params }),
  }, 'MCP url');

  // 捕获 MCP Streamable HTTP 在 initialize 响应头返回的会话 ID
  const sid = res.headers.get('mcp-session-id');
  if (sid) session.sessionId = sid;

  const ct = res.headers.get('content-type') || '';
  const raw = await res.text();

  if (ct.includes('text/event-stream')) {
    // SSE：逐块解析 data: {...}，取最后一个含 result / error 的消息
    const blocks = raw.split('\n\n');
    for (const b of blocks) {
      const dataLine = b.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      try {
        const msg = JSON.parse(dataLine.slice(5).trim());
        if (msg.error) throw new Error(msg.error.message || 'MCP RPC error');
        if (msg.result) return msg.result;
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
    return null;
  }

  try {
    const json = JSON.parse(raw);
    if (json.error) throw new Error(json.error.message || 'MCP RPC error');
    return json.result;
  } catch (e: any) {
    if (ct.includes('text/event-stream')) return null;
    throw e;
  }
}

// ===== local-fs 传输（stdio 子进程） =====
function createStdioSession(config: McpServerConfig): McpSession {
  const child = spawn(
    'npx',
    ['-y', '@modelcontextprotocol/server-filesystem', config.fsDir || process.cwd()],
    { stdio: ['pipe', 'pipe', 'pipe'], env: process.env },
  );
  const session: McpSession = {
    config,
    tools: [],
    protocolVersion: PROTOCOL_VERSION,
    child,
    pending: new Map(),
    stdioBuf: '',
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    session.stdioBuf = (session.stdioBuf || '') + chunk.toString();
    let idx: number;
    while ((idx = session.stdioBuf.indexOf('\n')) >= 0) {
      const line = session.stdioBuf.slice(0, idx).trim();
      session.stdioBuf = session.stdioBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const id = msg.id;
        if (id !== undefined && id !== null && session.pending?.has(id)) {
          const p = session.pending.get(id)!;
          session.pending!.delete(id);
          if (msg.error) p.reject(new Error(msg.error.message || 'MCP stdio error'));
          else p.resolve(msg.result);
        }
      } catch {
        // 忽略无法解析的非 JSON 行
      }
    }
  });
  child.stderr?.on('data', () => {
    /* 静默忽略子进程日志 */
  });
  // spawn 失败（如 npx 不存在 / 权限不足）会触发 error 事件；若不处理会导致后端进程崩溃
  child.on('error', (err: any) => {
    session.spawnError = err?.message || String(err);
    session.pending?.forEach((p) => p.reject(new Error(`MCP 子进程启动失败: ${session.spawnError}`)));
    session.pending?.clear();
  });
  child.on('exit', (code: number) => {
    session.pending?.forEach((p) => p.reject(new Error(`MCP stdio 进程已退出 (code=${code})`)));
    session.pending?.clear();
  });

  return session;
}

const STDIO_RPC_TIMEOUT = 30000;
let stdioReqId = 1;
function stdioRpc(session: McpSession, method: string, params: any, notify = false): Promise<any> {
  return new Promise((resolve, reject) => {
    if (session.spawnError) {
      reject(new Error(`MCP 子进程不可用: ${session.spawnError}`));
      return;
    }
    const id = notify ? undefined : stdioReqId++;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (!notify && id !== undefined) {
      timer = setTimeout(() => {
        if (session.pending?.has(id)) {
          session.pending.delete(id);
          reject(new Error(`MCP stdio 调用超时 (${STDIO_RPC_TIMEOUT / 1000}s): ${method}`));
        }
      }, STDIO_RPC_TIMEOUT);
      session.pending?.set(id, {
        resolve: (v) => { if (timer) clearTimeout(timer); resolve(v); },
        reject: (e) => { if (timer) clearTimeout(timer); reject(e); },
      });
    }
    try {
      session.child?.stdin?.write(
        JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n',
      );
    } catch (e: any) {
      if (timer) clearTimeout(timer);
      if (id !== undefined) session.pending?.delete(id);
      reject(new Error(`MCP stdio 写入失败: ${e?.message || e}`));
      return;
    }
    if (notify) resolve(undefined);
  });
}

// ===== 连接入口 =====
export async function connectMcp(config: McpServerConfig): Promise<{ tools: McpTool[] }> {
  // —— local-fs：spawn 本地 stdio filesystem server ——
  if (config.transport === 'local-fs') {
    // 校验暴露目录，防止 AI 读写系统敏感目录
    const safeDir = assertSafeFsDir(config.fsDir || '');
    config = { ...config, fsDir: safeDir };

    // 同一 id 已存在则先回收旧子进程
    const old = sessions.get(config.id);
    if (old?.child) {
      try { old.child.kill(); } catch { /* noop */ }
    }

    const session = createStdioSession(config);
    await stdioRpc(session, 'initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'AgentFlow', version: '1.0.0' },
    });
    await stdioRpc(session, 'notifications/initialized', {}, true).catch(() => {});

    const list = await stdioRpc(session, 'tools/list', {});
    const tools: McpTool[] = (list?.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }));

    session.tools = tools;
    sessions.set(config.id, session);
    return { tools };
  }

  // —— streamable-http / sse ——
  await assertSafeOutboundUrl(config.url!, 'MCP url');
  const session: McpSession = { config, tools: [], protocolVersion: PROTOCOL_VERSION };

  await rpc(session, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'AgentFlow', version: '1.0.0' },
  });

  // 发送 initialized 通知（部分服务器要求）
  await rpc(session, 'notifications/initialized', {}, true).catch(() => {});

  const list = await rpc(session, 'tools/list', {});
  const tools: McpTool[] = (list?.tools || []).map((t: any) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
  }));

  session.tools = tools;
  sessions.set(config.id, session);
  return { tools };
}

export function getSession(id: string): McpSession | undefined {
  return sessions.get(id);
}

// 调用指定服务器上的工具（按 transport 分支）
export async function callMcpTool(serverId: string, name: string, args: any): Promise<{ content: string }> {
  const session = sessions.get(serverId);
  if (!session) throw new Error('MCP 服务器未连接，请先连接');

  let result: any;
  if (session.config.transport === 'local-fs') {
    result = await stdioRpc(session, 'tools/call', { name, arguments: args || {} });
  } else {
    result = await rpc(session, 'tools/call', { name, arguments: args || {} });
  }

  const text = (result?.content || [])
    .map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
    .join('\n');
  return { content: text };
}

// 按工具名在所有已连接服务器中查找并执行（供 LLM 代理的工具循环使用）
export async function executeMcpToolByName(name: string, args: any): Promise<string> {
  for (const session of sessions.values()) {
    if (session.tools.some((t) => t.name === name)) {
      try {
        const r = await callMcpTool(session.config.id, name, args || {});
        return r.content;
      } catch (e: any) {
        return `[工具执行失败: ${e.message}]`;
      }
    }
  }
  return `[未找到提供工具 "${name}" 的 MCP 服务器]`;
}

// ===== Express 路由 =====
export function registerMcpRoutes(router: express.Router): void {
  router.post('/mcp/connect', async (req: Request, res: Response) => {
    try {
      const cfg = req.body as McpServerConfig;
      if (!cfg.id) {
        return res.status(400).json({ success: false, error: '缺少 id' });
      }
      if (cfg.transport === 'local-fs') {
        if (!cfg.fsDir) {
          return res.status(400).json({ success: false, error: 'local-fs 模式缺少 fsDir（目录路径）' });
        }
      } else if (!cfg.url) {
        return res.status(400).json({ success: false, error: '缺少 url' });
      }
      const { tools } = await connectMcp(cfg);
      res.json({ success: true, tools });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.get('/mcp/tools', (req: Request, res: Response) => {
    const serverId = req.query.serverId as string;
    const s = sessions.get(serverId);
    if (!s) return res.json({ success: false, error: '未连接', tools: [] });
    res.json({ success: true, tools: s.tools });
  });

  router.post('/mcp/call', async (req: Request, res: Response) => {
    try {
      const { serverId, name, args } = req.body;
      const r = await callMcpTool(serverId, name, args || {});
      res.json({ success: true, ...r });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
}
