import type { PluginInstallation } from '../../types';
import { getPluginManifest, BUILTIN_PLUGINS } from './registry';

const API_BASE = import.meta.env.VITE_API_BASE || '';

// ===== 安装状态存储 =====

const installations = new Map<string, PluginInstallation>();

/** 确保某个 id 的安装记录存在（默认 available） */
function ensureEntry(id: string): PluginInstallation {
  let entry = installations.get(id);
  if (!entry) {
    entry = {
      id,
      status: 'available',
      enabled: false,
    };
    installations.set(id, entry);
  }
  return entry;
}

// ===== API 辅助 =====

async function pluginApi(method: string, id: string, body?: Record<string, any>): Promise<any> {
  const res = await fetch(`${API_BASE}/plugins/${id}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Plugin API error: ${text}`);
  }
  return res.json();
}

// ===== 公共接口 =====

/** 安装插件（通过后端 API 调 npm install + 启动） */
export async function installPlugin(id: string): Promise<PluginInstallation> {
  const manifest = getPluginManifest(id);
  if (!manifest) throw new Error(`Plugin "${id}" not found in registry`);

  const entry = ensureEntry(id);
  entry.status = 'installing';
  entry.error = undefined;
  installations.set(id, entry);

  try {
    const result = await pluginApi('install', id, {
      packageName: manifest.packageName,
      gitUrl: manifest.gitUrl,
      installSource: manifest.installSource,
      type: manifest.type,
      transport: manifest.transport,
    }) as { installedVersion?: string; installedPath?: string };

    entry.status = 'installed';
    entry.installedVersion = result.installedVersion ?? manifest.version;
    entry.installedPath = result.installedPath;
    entry.enabled = true;
    entry.installedAt = new Date().toISOString();
    installations.set(id, entry);
    return entry;
  } catch (err) {
    entry.status = 'error';
    entry.error = err instanceof Error ? err.message : String(err);
    installations.set(id, entry);
    return entry;
  }
}

/** 卸载插件 */
export async function uninstallPlugin(id: string): Promise<PluginInstallation> {
  const entry = ensureEntry(id);
  if (entry.status !== 'installed') {
    throw new Error(`Plugin "${id}" is not installed (current: ${entry.status})`);
  }

  entry.status = 'uninstalling';
  installations.set(id, entry);

  try {
    await pluginApi('uninstall', id);

    entry.status = 'available';
    entry.installedVersion = undefined;
    entry.installedPath = undefined;
    entry.enabled = false;
    entry.installedAt = undefined;
    entry.error = undefined;
    installations.set(id, entry);
    return entry;
  } catch (err) {
    entry.status = 'error';
    entry.error = err instanceof Error ? err.message : String(err);
    installations.set(id, entry);
    return entry;
  }
}

/** 启用插件 */
export async function enablePlugin(id: string): Promise<PluginInstallation> {
  const entry = ensureEntry(id);
  if (entry.status !== 'installed') {
    throw new Error(`Plugin "${id}" is not installed (current: ${entry.status})`);
  }

  try {
    await pluginApi('enable', id);
    entry.enabled = true;
    installations.set(id, entry);
    return entry;
  } catch (err) {
    entry.error = err instanceof Error ? err.message : String(err);
    installations.set(id, entry);
    throw err;
  }
}

/** 禁用插件 */
export async function disablePlugin(id: string): Promise<PluginInstallation> {
  const entry = ensureEntry(id);
  if (entry.status !== 'installed') {
    throw new Error(`Plugin "${id}" is not installed (current: ${entry.status})`);
  }

  try {
    await pluginApi('disable', id);
    entry.enabled = false;
    installations.set(id, entry);
    return entry;
  } catch (err) {
    entry.error = err instanceof Error ? err.message : String(err);
    installations.set(id, entry);
    throw err;
  }
}

/** 配置插件 */
export async function configurePlugin(id: string, config: Record<string, any>): Promise<PluginInstallation> {
  const entry = ensureEntry(id);
  if (entry.status !== 'installed') {
    throw new Error(`Plugin "${id}" is not installed (current: ${entry.status})`);
  }

  try {
    await pluginApi('configure', id, { config });
    entry.config = { ...entry.config, ...config };
    installations.set(id, entry);
    return entry;
  } catch (err) {
    entry.error = err instanceof Error ? err.message : String(err);
    installations.set(id, entry);
    throw err;
  }
}

/** 获取已安装插件列表 */
export function getInstalledPlugins(): PluginInstallation[] {
  return Array.from(installations.values()).filter((e) => e.status === 'installed');
}

/** 获取插件状态 */
export function getPluginStatus(id: string): PluginInstallation {
  return ensureEntry(id);
}

/** 初始化内置插件为已安装状态 */
export function initBuiltinPlugins(): void {
  for (const m of BUILTIN_PLUGINS) {
    if (m.builtin) {
      installations.set(m.id, {
        id: m.id,
        status: 'installed',
        installedVersion: m.version,
        enabled: true,
        installedAt: new Date().toISOString(),
      });
    }
  }
}
