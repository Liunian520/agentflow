/**
 * 服务端内置工具执行器
 *
 * 处理不需要 MCP 连接的内置工具和记忆工具：
 * - builtin_*: 网页搜索、网页抓取、时间日期、计算器、代码执行
 * - memory_*: 记忆保存、搜索、更新、删除（通过 Prisma 直接操作数据库）
 */

import { prisma } from '../db';

// ===== 内置工具执行 =====

export async function executeBuiltinToolServer(name: string, args: any): Promise<string> {
  switch (name) {
    case 'builtin_web_search':
      return await webSearch(args.query || '');
    case 'builtin_web_fetch':
      return await webFetch(args.url || '');
    case 'builtin_datetime':
      return currentDateTime();
    case 'builtin_calculator':
      return calculate(args.expression || '');
    case 'builtin_code_run':
      // 代码执行在服务端禁用，返回结构化 JSON 以便前端正确判断状态
      return JSON.stringify({
        success: false,
        message: '代码执行功能暂未在服务端启用，请使用前端沙箱模式',
      });
    default:
      return JSON.stringify({ success: false, message: `未知内置工具: ${name}` });
  }
}

// ===== 记忆工具执行 =====

export async function executeMemoryToolServer(name: string, args: any): Promise<string> {
  try {
    switch (name) {
      case 'memory_save': {
        const { type = 'user', content, tags = [], keywords = [], source = 'agent', sessionId = '', importance = 0.5 } = args;
        if (!content) return JSON.stringify({ success: false, message: 'content 不能为空' });
        const memory = await prisma.factualMemory.create({
          data: {
            type, content,
            tags: JSON.stringify(tags),
            keywords: JSON.stringify(keywords),
            source, sessionId,
            importance: parseFloat(String(importance)) || 0.5,
          },
        });
        return JSON.stringify({ success: true, message: `记忆已保存（ID: ${memory.id}）`, id: memory.id });
      }
      case 'memory_search': {
        const { query = '', type, limit = 5, sessionId = '' } = args;
        const where: any = {};
        if (type) where.type = type;
        // 按 sessionId 过滤：只返回当前会话保存的记忆 + 无 sessionId 的全局记忆
        // 避免不同会话之间的记忆泄露
        if (sessionId) {
          where.OR = [
            { sessionId },
            { sessionId: null },
            { sessionId: '' },
          ];
          if (query) {
            // 在 sessionId 限制内再做内容匹配
            where.AND = [
              {
                OR: [
                  { content: { contains: query, mode: 'insensitive' } },
                  { keywords: { contains: query, mode: 'insensitive' } },
                  { tags: { contains: query, mode: 'insensitive' } },
                ],
              },
            ];
          }
        } else {
          // 无 sessionId 时不限制（兼容旧调用）
          if (query) {
            where.OR = [
              { content: { contains: query, mode: 'insensitive' } },
              { keywords: { contains: query, mode: 'insensitive' } },
              { tags: { contains: query, mode: 'insensitive' } },
            ];
          }
        }
        const memories = await prisma.factualMemory.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          take: Math.min(parseInt(String(limit)) || 5, 20),
        });
        // 标记为已访问
        for (const m of memories) {
          await prisma.factualMemory.update({
            where: { id: m.id },
            data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
          }).catch(() => {});
        }
        const formatted = memories.map((m: any) => ({
          id: m.id,
          type: m.type,
          content: m.content,
          tags: JSON.parse(m.tags),
          keywords: JSON.parse(m.keywords),
          importance: m.importance,
        }));
        return JSON.stringify({ success: true, message: `找到 ${formatted.length} 条记忆`, memories: formatted });
      }
      case 'memory_update': {
        const { id, content, tags, keywords, importance } = args;
        if (!id) return JSON.stringify({ success: false, message: 'id 不能为空' });
        const data: any = {};
        if (content !== undefined) data.content = content;
        if (tags !== undefined) data.tags = JSON.stringify(tags);
        if (keywords !== undefined) data.keywords = JSON.stringify(keywords);
        if (importance !== undefined) data.importance = parseFloat(String(importance));
        const updated = await prisma.factualMemory.update({ where: { id }, data }).catch(() => null);
        if (!updated) return JSON.stringify({ success: false, message: `未找到记忆 ${id}` });
        return JSON.stringify({ success: true, message: `记忆 ${id} 已更新` });
      }
      case 'memory_delete': {
        const { id } = args;
        if (!id) return JSON.stringify({ success: false, message: 'id 不能为空' });
        const deleted = await prisma.factualMemory.delete({ where: { id } }).catch(() => null);
        if (!deleted) return JSON.stringify({ success: false, message: `未找到记忆 ${id}` });
        return JSON.stringify({ success: true, message: `记忆 ${id} 已删除` });
      }
      default:
        return JSON.stringify({ success: false, message: `未知记忆工具: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ success: false, message: `记忆工具执行失败: ${err.message}` });
  }
}

// ===== 统一入口：判断并执行非 MCP 工具 =====

export async function executeNonMcpTool(name: string, args: any): Promise<string | null> {
  // 内置工具：以 builtin_ 开头，且不是 MCP 命名空间格式（server__tool）
  if (name.startsWith('builtin_') && !name.includes('__')) {
    return await executeBuiltinToolServer(name, args);
  }
  // 记忆工具：以 memory_ 开头，且不是 MCP 命名空间格式
  if (name.startsWith('memory_') && !name.includes('__')) {
    return await executeMemoryToolServer(name, args);
  }
  // 非 MCP 工具，返回 null 表示需要走 MCP 路径
  return null;
}

// ===== 工具实现 =====

/** 网页搜索：使用 DuckDuckGo HTML 接口 */
async function webSearch(query: string): Promise<string> {
  if (!query.trim()) return JSON.stringify({ success: false, message: '搜索关键词不能为空' });
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!response.ok) {
      return JSON.stringify({ success: false, message: `搜索请求失败 (${response.status})` });
    }
    const html = await response.text();
    // 从 HTML 中提取搜索结果
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/g;
    let match: RegExpExecArray | null;
    let snippets: string[] = [];
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
    }
    let i = 0;
    while ((match = linkRegex.exec(html)) !== null) {
      const rawUrl = match[1];
      const title = match[2].replace(/<[^>]+>/g, '').trim();
      // DuckDuckGo 重定向 URL，提取实际 URL
      const urlMatch = rawUrl.match(/uddg=([^&]+)/);
      const actualUrl = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;
      if (title && actualUrl) {
        results.push({ title, url: actualUrl, snippet: snippets[i] || '' });
      }
      i++;
      if (results.length >= 8) break;
    }
    if (results.length === 0) {
      return JSON.stringify({ success: true, message: `未找到关于 "${query}" 的搜索结果`, results: [] });
    }
    return JSON.stringify({ success: true, message: `找到 ${results.length} 条搜索结果`, results });
  } catch (err: any) {
    return JSON.stringify({ success: false, message: `搜索失败: ${err.message}` });
  }
}

/** 网页抓取：获取 URL 内容并提取文本 */
async function webFetch(url: string): Promise<string> {
  if (!url.trim()) return JSON.stringify({ success: false, message: 'URL 不能为空' });
  // SSRF 防护：只允许 http/https 协议
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return JSON.stringify({ success: false, message: 'URL 格式无效' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return JSON.stringify({ success: false, message: `不支持的协议: ${parsed.protocol}（仅允许 http/https）` });
  }
  // 屏蔽内网地址和云元数据端点，防止 SSRF
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ''); // 去除 IPv6 方括号
  // 尝试解析为 IP 地址以检测各种格式（十进制、十六进制、IPv6-mapped IPv4 等）
  const isPrivateHost = checkPrivateHost(hostname);
  if (isPrivateHost) {
    return JSON.stringify({ success: false, message: `出于安全考虑禁止访问内网地址: ${hostname}` });
  }
  try {
    // 不自动跟随重定向，防止重定向 SSRF；手动检查重定向目标
    const response = await fetch(parsed.href, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'manual',
    });
    // 处理重定向：检查 Location 头并递归校验（最多 3 次）
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (location) {
        const redirectUrl = new URL(location, parsed.href);
        return await webFetch(redirectUrl.href); // 递归校验重定向目标
      }
    }
    if (!response.ok && !response.status.toString().startsWith('3')) {
      return JSON.stringify({ success: false, message: `请求失败 (${response.status})` });
    }
    const html = await response.text();
    // 提取 title
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    // 移除 script/style 标签
    const cleaned = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
    // 提取纯文本
    const text = cleaned
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    // 截取前 4000 字符
    const truncated = text.length > 4000 ? text.slice(0, 4000) + '...' : text;
    return JSON.stringify({ success: true, message: `已抓取 ${url}`, title, content: truncated, length: text.length });
  } catch (err: any) {
    return JSON.stringify({ success: false, message: `抓取失败: ${err.message}` });
  }
}

/** 当前时间 */
function currentDateTime(): string {
  const now = new Date();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const w = weekdays[now.getDay()];
  return JSON.stringify({
    success: true,
    message: `当前时间: ${y}-${m}-${d} ${h}:${min}:${s} 星期${w}`,
    datetime: `${y}-${m}-${d} ${h}:${min}:${s}`,
    weekday: `星期${w}`,
    iso: now.toISOString(),
  });
}

/** 安全数学计算 */
function calculate(expression: string): Promise<string> {
  return Promise.resolve((() => {
    if (!expression.trim()) return JSON.stringify({ success: false, message: '表达式不能为空' });
    // 白名单校验：只允许数字、运算符、括号、小数点、空格
    if (!/^[\d+*/%().\s-]+$/.test(expression)) {
      return JSON.stringify({ success: false, message: '表达式包含不允许的字符（仅支持数字和 + - * / % ( )）' });
    }
    try {
      const result = Function(`"use strict"; return (${expression})`)();
      if (typeof result !== 'number' || !isFinite(result)) {
        return JSON.stringify({ success: false, message: '计算结果无效' });
      }
      return JSON.stringify({ success: true, message: `= ${result}`, expression, result });
    } catch (err: any) {
      return JSON.stringify({ success: false, message: `计算失败: ${err.message}` });
    }
  })());
}
