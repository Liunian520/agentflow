/**
 * 内置工具系统 — 开箱即用、无需安装的 5 个常用工具
 *
 * 与 MCP 工具（需连接 MCP server）和 Self-Editing Memory 工具（memory_*）并列。
 * 工具名统一使用 `builtin_` 前缀，避免与 MCP 工具命名冲突。
 *
 * 5 个内置工具：
 * - builtin_web_search: 网页搜索（依赖后端 /api/tools/web-search）
 * - builtin_web_fetch:  网页抓取（依赖后端 /api/tools/web-fetch）
 * - builtin_datetime:   获取当前时间日期（纯前端实现）
 * - builtin_calculator: 数学表达式计算（纯前端实现，安全沙箱）
 * - builtin_code_run:   代码执行（优先后端 /api/tools/run-code，回退前端受限沙箱）
 */

// ===== 类型定义 =====

/** OpenAI function calling 格式的工具 schema */
interface BuiltinToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/** 可直接拼接至 LLM tools 参数的工具定义 */
interface BuiltinToolDefinition {
  type: 'function';
  function: BuiltinToolSchema;
}

/** 工具执行结果 */
interface ToolResult {
  success: boolean;
  message: string;
  data?: any;
}

// ===== 工具 Schema 定义 =====

/** builtin_web_search: 网页搜索 */
const WEB_SEARCH_SCHEMA: BuiltinToolSchema = {
  name: 'builtin_web_search',
  description: '网页搜索：根据查询词返回搜索结果（标题、链接、摘要）。用于获取最新信息或查找网络资源。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索查询关键词',
      },
    },
    required: ['query'],
  },
};

/** builtin_web_fetch: 网页抓取 */
const WEB_FETCH_SCHEMA: BuiltinToolSchema = {
  name: 'builtin_web_fetch',
  description: '网页抓取：获取指定 URL 的网页正文内容（自动转为 Markdown）。用于读取网页详细内容。',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要抓取的网页 URL（需包含 http:// 或 https://）',
      },
    },
    required: ['url'],
  },
};

/** builtin_datetime: 获取当前时间 */
const DATETIME_SCHEMA: BuiltinToolSchema = {
  name: 'builtin_datetime',
  description: '获取当前时间日期，返回格式 YYYY-MM-DD HH:mm:ss 与星期。无需参数。',
  parameters: {
    type: 'object',
    properties: {},
  },
};

/** builtin_calculator: 数学计算 */
const CALCULATOR_SCHEMA: BuiltinToolSchema = {
  name: 'builtin_calculator',
  description: '数学计算器：安全计算数学表达式，支持 + - * / % () 及小数。不允许字母与函数调用。',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: '数学表达式，例如 "1 + 2 * (3 - 4) / 5"',
      },
    },
    required: ['expression'],
  },
};

/** builtin_code_run: 代码执行 */
const CODE_RUN_SCHEMA: BuiltinToolSchema = {
  name: 'builtin_code_run',
  description: '代码执行：运行 JavaScript/TypeScript/Python 代码并返回输出。优先使用后端沙箱，回退到前端受限沙箱（仅 JavaScript）。',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: '要执行的代码内容',
      },
      language: {
        type: 'string',
        enum: ['javascript', 'typescript', 'python'],
        description: '代码语言（默认 javascript）',
      },
    },
    required: ['code'],
  },
};

/**
 * 内置工具 schema 列表（OpenAI function calling 格式）
 * 可直接拼接到 LLM 的 tools 参数
 */
export const BUILTIN_TOOL_SCHEMAS: BuiltinToolDefinition[] = [
  { type: 'function', function: WEB_SEARCH_SCHEMA },
  { type: 'function', function: WEB_FETCH_SCHEMA },
  { type: 'function', function: DATETIME_SCHEMA },
  { type: 'function', function: CALCULATOR_SCHEMA },
  { type: 'function', function: CODE_RUN_SCHEMA },
];

/** 内置工具名集合（用于快速判断） */
const BUILTIN_TOOL_NAMES = new Set<string>(
  BUILTIN_TOOL_SCHEMAS.map((t) => t.function.name)
);

/**
 * 判断工具名是否为内置工具
 * @param name 工具名
 */
export function isBuiltinTool(name: string): boolean {
  return BUILTIN_TOOL_NAMES.has(name);
}

// ===== 工具执行器实现 =====

/** 执行 builtin_web_search：通过后端 API 进行网页搜索 */
async function executeWebSearch(query: string): Promise<ToolResult> {
  if (!query || typeof query !== 'string') {
    return { success: false, message: '缺少必填参数 query' };
  }
  try {
    const res = await fetch('/api/tools/web-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      return {
        success: false,
        message: `网页搜索服务不可用（HTTP ${res.status}），请确认后端 /api/tools/web-search 已启用`,
      };
    }
    const data = await res.json();
    const count = Array.isArray(data?.results) ? data.results.length : 0;
    return {
      success: true,
      message: `搜索完成，返回 ${count} 条结果`,
      data,
    };
  } catch (e: any) {
    return {
      success: false,
      message: `网页搜索服务不可用：${e?.message || e}。该工具需要后端 /api/tools/web-search 支持。`,
    };
  }
}

/** 执行 builtin_web_fetch：通过后端 API 抓取网页内容 */
async function executeWebFetch(url: string): Promise<ToolResult> {
  if (!url || typeof url !== 'string') {
    return { success: false, message: '缺少必填参数 url' };
  }
  if (!/^https?:\/\//i.test(url)) {
    return { success: false, message: 'url 必须以 http:// 或 https:// 开头' };
  }
  try {
    const res = await fetch('/api/tools/web-fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      return {
        success: false,
        message: `网页抓取服务不可用（HTTP ${res.status}），请确认后端 /api/tools/web-fetch 已启用`,
      };
    }
    const data = await res.json();
    return { success: true, message: '抓取成功', data };
  } catch (e: any) {
    return {
      success: false,
      message: `网页抓取服务不可用：${e?.message || e}。该工具需要后端 /api/tools/web-fetch 支持。`,
    };
  }
}

/** 执行 builtin_datetime：返回当前时间日期 */
function executeDatetime(): ToolResult {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const week = weekdays[now.getDay()];
  const formatted = `${y}-${m}-${d} ${hh}:${mm}:${ss} ${week}`;
  return {
    success: true,
    message: formatted,
    data: {
      iso: now.toISOString(),
      formatted,
      weekday: week,
    },
  };
}

/** 执行 builtin_calculator：使用 Function 构造器安全计算数学表达式 */
function executeCalculator(expression: string): ToolResult {
  if (!expression || typeof expression !== 'string') {
    return { success: false, message: '缺少必填参数 expression' };
  }
  const trimmed = expression.trim();
  // 安全检查：仅允许数字、运算符、括号、小数点、空格
  if (!/^[\d+*/%().\s-]+$/.test(trimmed)) {
    return {
      success: false,
      message: '表达式包含非法字符，仅允许数字与运算符 + - * / % ( ) .',
    };
  }
  // 必须至少包含一个数字
  if (!/\d/.test(trimmed)) {
    return { success: false, message: '表达式必须包含数字' };
  }
  try {
    // 使用 Function 构造器在受限作用域中求值（已通过字符白名单校验）
    const fn = new Function(`"use strict"; return (${trimmed});`);
    const result = fn();
    if (typeof result !== 'number' || !isFinite(result)) {
      return { success: false, message: `计算结果无效: ${result}` };
    }
    return {
      success: true,
      message: `${trimmed} = ${result}`,
      data: { expression: trimmed, result },
    };
  } catch (e: any) {
    return { success: false, message: `计算失败: ${e?.message || e}` };
  }
}

/**
 * 执行 builtin_code_run：优先后端 API，不可用则回退前端沙箱
 * @param code 代码内容
 * @param language 语言（javascript/typescript/python），默认 javascript
 */
async function executeCodeRun(code: string, language: string): Promise<ToolResult> {
  if (!code || typeof code !== 'string') {
    return { success: false, message: '缺少必填参数 code' };
  }
  const lang = (language || 'javascript').toLowerCase();

  // 优先尝试后端执行
  try {
    const res = await fetch('/api/tools/run-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language: lang }),
    });
    if (res.ok) {
      const data = await res.json();
      return { success: true, message: '代码执行完成', data };
    }
  } catch {
    // 后端不可用，回退前端沙箱
  }

  // 前端沙箱回退：仅支持 javascript
  if (lang !== 'javascript') {
    return {
      success: false,
      message: `后端代码执行服务不可用，前端沙箱仅支持 javascript（当前语言: ${lang}）。请启用后端 /api/tools/run-code。`,
    };
  }
  return runFrontendSandbox(code);
}

/**
 * 前端受限沙箱执行 JavaScript
 * - 拦截危险 API（fetch/window/localStorage/document/eval/Function/import/require 等）
 * - 捕获 console.log/error/warn/info 输出
 */
function runFrontendSandbox(code: string): ToolResult {
  // 危险标识符黑名单（命中即拒绝执行）
  const dangerPattern =
    /\b(fetch|window|localStorage|sessionStorage|document|globalThis|self|top|parent|eval|Function|process|import|require)\b/;
  if (dangerPattern.test(code)) {
    return {
      success: false,
      message:
        '前端沙箱禁用了 fetch/window/localStorage/sessionStorage/document/globalThis/eval/Function/import/require/process 等危险 API。请启用后端 /api/tools/run-code 执行含这些 API 的代码。',
    };
  }
  try {
    // 捕获 console 输出
    const logs: string[] = [];
    const stringify = (a: any) =>
      typeof a === 'object' ? JSON.stringify(a) : String(a);
    const sandboxConsole = {
      log: (...args: any[]) => logs.push(args.map(stringify).join(' ')),
      error: (...args: any[]) => logs.push('[error] ' + args.map(stringify).join(' ')),
      warn: (...args: any[]) => logs.push('[warn] ' + args.map(stringify).join(' ')),
      info: (...args: any[]) => logs.push(args.map(stringify).join(' ')),
    };
    // 使用 new Function 构造受限作用域
    const fn = new Function(
      'console',
      `"use strict";\ntry {\n${code}\n} catch (e) { console.error(e?.message || e); }`
    );
    let result: any;
    try {
      result = fn(sandboxConsole);
    } catch (e: any) {
      return {
        success: false,
        message: `执行出错: ${e?.message || e}`,
        data: { logs },
      };
    }
    const data: any = { logs };
    if (result !== undefined) data.result = result;
    return {
      success: true,
      message: `执行完成${logs.length ? `，输出 ${logs.length} 行` : ''}`,
      data,
    };
  } catch (e: any) {
    return { success: false, message: `沙箱构建失败: ${e?.message || e}` };
  }
}

// ===== 工具路由器 =====

/**
 * 内置工具执行器：根据工具名路由到对应实现
 * @param name 工具名（需以 builtin_ 前缀）
 * @param args 工具参数对象
 */
export async function executeBuiltinTool(
  name: string,
  args: any
): Promise<ToolResult> {
  switch (name) {
    case 'builtin_web_search':
      return executeWebSearch(args?.query);
    case 'builtin_web_fetch':
      return executeWebFetch(args?.url);
    case 'builtin_datetime':
      return executeDatetime();
    case 'builtin_calculator':
      return executeCalculator(args?.expression);
    case 'builtin_code_run':
      return executeCodeRun(args?.code, args?.language);
    default:
      return { success: false, message: `未知的内置工具: ${name}` };
  }
}
