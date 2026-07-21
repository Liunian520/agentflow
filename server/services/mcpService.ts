/**
 * MCP 客户端服务 — 纯 fetch 实现的 MCP Streamable HTTP / SSE 客户端
 * 不依赖 @modelcontextprotocol/sdk，避免为浏览器打包引入后端专用依赖
 * 通过 JSON-RPC 2.0 与 MCP 服务器通信：initialize / tools/list / tools/call
 */

import type { Request, Response } from 'express';
import express from 'express';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: any;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: 'streamable-http' | 'sse';
  url: string;
  headers?: Record<string, string>;
}

interface McpSession {
  config: McpServerConfig;
  sessionId?: string;
  tools: McpTool[];
  protocolVersion: string;
}

// 运行时内存会话注册表（按 server id 索引）
const sessions = new Map<string, McpSession>();

const PROTOCOL_VERSION = '2024-11-05';

// 单次 JSON-RPC 调用，兼容 application/json 与 text/event-stream（SSE）响应
async function rpc(session: McpSession, method: string, params: any, notify = false): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(session.config.headers || {}),
  };
  if (session.sessionId) headers['Mcp-Session-Id'] = session.sessionId;

  const res = await fetch(session.config.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: notify ? undefined : Date.now(), method, params }),
  });

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
      } catch {
        // 跳过无法解析的块
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

// 连接 MCP 服务器并完成握手，返回工具清单
export async function connectMcp(config: McpServerConfig): Promise<{ tools: McpTool[] }> {
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

// 调用指定服务器上的工具
export async function callMcpTool(serverId: string, name: string, args: any): Promise<{ content: string }> {
  const session = sessions.get(serverId);
  if (!session) throw new Error('MCP 服务器未连接，请先连接');
  const result = await rpc(session, 'tools/call', { name, arguments: args });
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
      if (!cfg.id || !cfg.url) {
        return res.status(400).json({ success: false, error: '缺少 id 或 url' });
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
