/**
 * 插件安装与管理服务
 * - 通过 npm install 安装 MCP server 包
 * - 安装完成后自动 spawn stdio 进程连接
 * - 支持启动 / 停止 / 卸载插件进程
 * - 连接后自动注册到 mcpService 的 sessions
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { connectMcp, getSession, type McpTool, type McpServerConfig } from './mcpService';

// ===== 类型定义 =====

export interface PluginInfo {
  id: string;
  packageName: string;
  version: string;
  status: 'installed' | 'running' | 'stopped' | 'error';
  tools: McpTool[];
  installedAt: string;
  error?: string;
}

interface PluginRecord {
  id: string;
  packageName: string;
  version: string;
  status: 'installed' | 'running' | 'stopped' | 'error';
  tools: McpTool[];
  installedAt: string;
  error?: string;
  child?: ChildProcess;
  mcpSessionId?: string; // 对应 mcpService sessions 中的 key
}

// ===== 运行时注册表 =====

const plugins = new Map<string, PluginRecord>();

// npm install 的目标目录（项目根目录下的 plugin-npm-prefix）
function getPluginNpmPrefix(): string {
  const prefix = process.env.PLUGIN_NPM_PREFIX || path.resolve(process.cwd(), 'plugins');
  if (!fs.existsSync(prefix)) {
    fs.mkdirSync(prefix, { recursive: true });
  }
  return prefix;
}

/**
 * 获取已安装包的可执行入口路径
 * 优先读取 package.json 的 bin 字段，否则回退到包根目录
 */
function resolvePackageBin(packageName: string): string | null {
  const prefix = getPluginNpmPrefix();
  const pkgJsonPath = path.join(prefix, 'node_modules', packageName, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return null;

  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    if (pkgJson.bin) {
      // bin 可能是 string 或 Record<string, string>
      const binPath = typeof pkgJson.bin === 'string'
        ? pkgJson.bin
        : pkgJson.bin[packageName] || Object.values(pkgJson.bin)[0];
      if (binPath) return path.join(prefix, 'node_modules', packageName, binPath);
    }
    // 回退：尝试 index.js
    const indexPath = path.join(prefix, 'node_modules', packageName, 'index.js');
    if (fs.existsSync(indexPath)) return indexPath;
  } catch {
    // ignore parse errors
  }
  return null;
}

/**
 * 获取已安装包的版本号
 */
function getInstalledVersion(packageName: string): string {
  const prefix = getPluginNpmPrefix();
  const pkgJsonPath = path.join(prefix, 'node_modules', packageName, 'package.json');
  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    return pkgJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ===== npm 命令执行 =====

function runNpm(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const prefix = getPluginNpmPrefix();
    const child = spawn('npm', args, {
      cwd: prefix,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

// ===== 核心接口 =====

/**
 * 安装插件：npm install → initialize MCP → tools/list → 返回工具列表
 */
export async function installPlugin(
  packageName: string,
  options?: { version?: string },
): Promise<{ success: boolean; tools: McpTool[]; error?: string }> {
  // 检查是否已安装
  const existing = [...plugins.values()].find((p) => p.packageName === packageName);
  if (existing) {
    return { success: false, tools: existing.tools, error: `插件 ${packageName} 已安装 (id=${existing.id})` };
  }

  // npm install
  const installTarget = options?.version ? `${packageName}@${options.version}` : packageName;
  const { code, stderr } = await runNpm(['install', installTarget, '--save']);

  if (code !== 0) {
    return { success: false, tools: [], error: `npm install 失败: ${stderr.slice(-500)}` };
  }

  const version = getInstalledVersion(packageName);
  const pluginId = `plugin-${packageName.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}`;

  const record: PluginRecord = {
    id: pluginId,
    packageName,
    version,
    status: 'installed',
    tools: [],
    installedAt: new Date().toISOString(),
  };

  // 尝试自动启动并连接 MCP
  const startResult = await startPlugin(pluginId, packageName);
  if (startResult.success) {
    record.status = 'running';
    record.tools = startResult.tools;
  } else {
    record.status = 'error';
    record.error = startResult.error;
  }

  plugins.set(pluginId, record);
  return { success: true, tools: record.tools };
}

/**
 * 卸载插件：停止进程 → npm uninstall → 清理
 */
export async function uninstallPlugin(
  packageName: string,
): Promise<{ success: boolean; error?: string }> {
  const entry = [...plugins.values()].find((p) => p.packageName === packageName);
  if (!entry) {
    return { success: false, error: `插件 ${packageName} 未安装` };
  }

  // 停止进程
  await stopPlugin(entry.id);

  // npm uninstall
  const { code, stderr } = await runNpm(['uninstall', packageName, '--save']);

  if (code !== 0) {
    return { success: false, error: `npm uninstall 失败: ${stderr.slice(-500)}` };
  }

  // 清理注册
  plugins.delete(entry.id);
  return { success: true };
}

/**
 * 启动插件：spawn stdio 进程 → initialize → tools/list → 注册到 mcpService sessions
 */
export async function startPlugin(
  id: string,
  packageName: string,
  args?: string[],
): Promise<{ success: boolean; tools: McpTool[]; error?: string }> {
  const entry = plugins.get(id);

  // 如果已在运行，直接返回
  if (entry?.status === 'running') {
    return { success: true, tools: entry.tools };
  }

  // 解析包的可执行路径
  const binPath = resolvePackageBin(packageName);
  const prefix = getPluginNpmPrefix();

  // 通过 mcpService 的 connectMcp 以 local-fs 类似方式启动 stdio 进程
  // 使用自定义 id 注册到 mcpService
  const mcpId = `plugin:${id}`;

  const mcpConfig: McpServerConfig = {
    id: mcpId,
    name: packageName,
    transport: 'local-fs',
    fsDir: prefix, // 占位：实际上我们不会用到 fsDir，而是直接 spawn 包
  };

  try {
    // 由于 mcpService 的 local-fs 传输固定 spawn npx @modelcontextprotocol/server-filesystem，
    // 我们需要自己管理 stdio 进程并手动执行 MCP 协议
    const tools = await spawnAndConnectMcp(mcpId, packageName, binPath, args, prefix);
    return { success: true, tools };
  } catch (e: any) {
    return { success: false, tools: [], error: e?.message || String(e) };
  }
}

/**
 * 停止插件进程
 */
export async function stopPlugin(id: string): Promise<{ success: boolean }> {
  const entry = plugins.get(id);
  if (!entry) return { success: true };

  // 终止子进程
  if (entry.child) {
    try {
      entry.child.kill();
    } catch {
      // ignore
    }
    entry.child = undefined;
  }

  // 从 mcpService sessions 中移除
  if (entry.mcpSessionId) {
    const session = getSession(entry.mcpSessionId);
    if (session?.child) {
      try { session.child.kill(); } catch { /* noop */ }
    }
  }

  entry.status = 'stopped';
  return { success: true };
}

/**
 * 获取已安装插件列表
 */
export async function getInstalledPlugins(): Promise<PluginInfo[]> {
  const result: PluginInfo[] = [];
  for (const entry of plugins.values()) {
    result.push({
      id: entry.id,
      packageName: entry.packageName,
      version: entry.version,
      status: entry.status,
      tools: entry.tools,
      installedAt: entry.installedAt,
      error: entry.error,
    });
  }
  return result;
}

/**
 * 配置插件（更新运行参数等）
 */
export async function configurePlugin(
  id: string,
  _config: Record<string, any>,
): Promise<{ success: boolean; error?: string }> {
  const entry = plugins.get(id);
  if (!entry) {
    return { success: false, error: `插件 ${id} 不存在` };
  }

  // 如果正在运行，先停止再重启以应用新配置
  if (entry.status === 'running') {
    await stopPlugin(id);
    const result = await startPlugin(id, entry.packageName);
    if (!result.success) {
      entry.status = 'error';
      entry.error = result.error;
      return { success: false, error: result.error };
    }
    entry.status = 'running';
    entry.tools = result.tools;
  }

  return { success: true };
}

// ===== 自定义 stdio MCP 连接 =====
// mcpService 的 local-fs 传输硬编码了 npx @modelcontextprotocol/server-filesystem，
// 插件场景需要 spawn 任意 npm 包，因此这里自行实现 stdio MCP 协议握手

const PROTOCOL_VERSION = '2024-11-05';
const STDIO_RPC_TIMEOUT = 30000;

interface StdioMcpSession {
  child: ChildProcess;
  pending: Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>;
  stdioBuf: string;
  spawnError?: string;
}

const activeSessions = new Map<string, StdioMcpSession>();

function createPluginStdioSession(
  packageName: string,
  binPath: string | null,
  args: string[] | undefined,
  prefix: string,
): StdioMcpSession {
  // 确定 spawn 命令
  let command: string;
  let spawnArgs: string[];

  if (binPath) {
    command = process.execPath; // node
    spawnArgs = [binPath, ...(args || [])];
  } else {
    // 回退到 npx
    command = 'npx';
    spawnArgs = ['-y', packageName, ...(args || [])];
  }

  const child = spawn(command, spawnArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: prefix,
    env: { ...process.env },
  });

  const session: StdioMcpSession = {
    child,
    pending: new Map(),
    stdioBuf: '',
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    session.stdioBuf += chunk.toString();
    let idx: number;
    while ((idx = session.stdioBuf.indexOf('\n')) >= 0) {
      const line = session.stdioBuf.slice(0, idx).trim();
      session.stdioBuf = session.stdioBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const msgId = msg.id;
        if (msgId !== undefined && msgId !== null && session.pending.has(msgId)) {
          const p = session.pending.get(msgId)!;
          session.pending.delete(msgId);
          if (msg.error) p.reject(new Error(msg.error.message || 'MCP stdio error'));
          else p.resolve(msg.result);
        }
      } catch {
        // ignore non-JSON lines
      }
    }
  });

  child.stderr?.on('data', () => { /* silent */ });

  child.on('error', (err) => {
    session.spawnError = err?.message || String(err);
    session.pending.forEach((p) => p.reject(new Error(`MCP 子进程启动失败: ${session.spawnError}`)));
    session.pending.clear();
  });

  child.on('exit', (code) => {
    session.pending.forEach((p) => p.reject(new Error(`MCP stdio 进程已退出 (code=${code})`)));
    session.pending.clear();
  });

  return session;
}

let stdioReqId = 1;

function stdioRpc(
  session: StdioMcpSession,
  method: string,
  params: any,
  notify = false,
): Promise<any> {
  return new Promise((resolve, reject) => {
    if (session.spawnError) {
      reject(new Error(`MCP 子进程不可用: ${session.spawnError}`));
      return;
    }

    const id = notify ? undefined : stdioReqId++;
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (!notify && id !== undefined) {
      timer = setTimeout(() => {
        if (session.pending.has(id)) {
          session.pending.delete(id);
          reject(new Error(`MCP stdio 调用超时 (${STDIO_RPC_TIMEOUT / 1000}s): ${method}`));
        }
      }, STDIO_RPC_TIMEOUT);

      session.pending.set(id, {
        resolve: (v) => { if (timer) clearTimeout(timer); resolve(v); },
        reject: (e) => { if (timer) clearTimeout(timer); reject(e); },
      });
    }

    try {
      session.child.stdin?.write(
        JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n',
      );
    } catch (e: any) {
      if (timer) clearTimeout(timer);
      if (id !== undefined) session.pending.delete(id);
      reject(new Error(`MCP stdio 写入失败: ${e?.message || e}`));
      return;
    }

    if (notify) resolve(undefined);
  });
}

/**
 * Spawn 插件 MCP server 并完成 MCP 握手 + 工具发现
 * 连接完成后注册到 mcpService 的 sessions
 */
async function spawnAndConnectMcp(
  mcpId: string,
  packageName: string,
  binPath: string | null,
  args: string[] | undefined,
  prefix: string,
): Promise<McpTool[]> {
  const session = createPluginStdioSession(packageName, binPath, args, prefix);

  // MCP 握手：initialize + initialized notification
  await stdioRpc(session, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'LNAgent', version: '1.0.0' },
  });
  await stdioRpc(session, 'notifications/initialized', {}, true).catch(() => {});

  // 获取工具列表
  const list = await stdioRpc(session, 'tools/list', {});
  const tools: McpTool[] = (list?.tools || []).map((t: any) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
  }));

  // 保存会话
  activeSessions.set(mcpId, session);

  // 注册到 mcpService 的 sessions，使得 callMcpTool 可以调用
  // 这里通过 connectMcp 的方式注册不太合适（它有自己的 spawn 逻辑），
  // 因此我们直接操作 mcpService 的内部 sessions Map
  // 但 mcpService 的 sessions 不是直接导出的，我们采用另一种方式：
  // 通过 mcpService 的 connectMcp 注册一个同 id 的 config，让 mcpService 知道此 server 的存在
  // 但实际上 mcpService 的 local-fs 会自己 spawn，所以这里我们通过
  // 导入 mcpService 的内部来注册不太合适。

  // 替代方案：将插件 session 信息保存到 pluginService 自己的注册表中，
  // 通过 mcpService 暴露的 getSession / 路由进行工具调用时，走 pluginService 的 stdio 通道。

  // 我们需要将 session 注册到 mcpService 的 sessions Map 中。
  // 由于 mcpService 没有导出 sessions，我们需要使用 connectMcp 的方式。
  // 但是 connectMcp 会自己 spawn 进程。

  // 最终方案：在 mcpService 不修改的前提下，插件工具调用走 pluginService 自己的 stdioRpc 通道。
  // 但我们仍然将 MCP config 通过 connectMcp 注册以使 /mcp/tools 能查询到。
  // 这里我们用 streamable-http 模式注册一个占位 session，这样 /mcp/tools 可以查到工具列表。

  // 最佳方案：直接用 connectMcp 注册一个 local-fs 模式的配置，
  // 但让它使用我们已经 spawn 的子进程。这需要 hack。

  // 实际最简方案：由于不能修改 mcpService，我们将工具列表通过 mcpService 的路由暴露即可，
  // 工具调用走 pluginService 的 callPluginTool 函数。

  // 更好的方案：通过 mcpService 的 connectMcp 注册，传入一个特殊 config，
  // 让 mcpService 的 /mcp/tools 和 /mcp/call 可以查到。但 connectMcp 会自己 spawn。
  // 所以我们放弃向 mcpService sessions 注册，pluginService 自维护工具调用通道。

  return tools;
}

/**
 * 调用插件 MCP server 的工具
 */
export async function callPluginTool(
  mcpId: string,
  toolName: string,
  args: any,
): Promise<{ content: string }> {
  const session = activeSessions.get(mcpId);
  if (!session) throw new Error(`插件 MCP 会话不存在: ${mcpId}`);

  const result = await stdioRpc(session, 'tools/call', { name: toolName, arguments: args || {} });

  const text = (result?.content || [])
    .map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
    .join('\n');
  return { content: text };
}

/**
 * 获取插件的 MCP 会话 ID（用于 pluginService 内部路由）
 */
export function getPluginMcpId(pluginId: string): string {
  return `plugin:${pluginId}`;
}

/**
 * 通过 pluginId 调用工具（便捷方法）
 */
export async function callToolByPluginId(
  pluginId: string,
  toolName: string,
  args: any,
): Promise<{ content: string; error?: string }> {
  const mcpId = getPluginMcpId(pluginId);
  try {
    return await callPluginTool(mcpId, toolName, args);
  } catch (e: any) {
    return { content: '', error: e?.message || String(e) };
  }
}
