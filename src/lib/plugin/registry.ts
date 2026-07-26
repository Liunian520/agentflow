import type { PluginManifest, PluginRegistryEntry, PluginCategory } from '../../types';

// ===== 内置插件清单 =====

const HEADROOM_MANIFEST: PluginManifest = {
  id: 'headroom',
  name: 'Headroom',
  version: '1.0.0',
  description: 'AI Agent 上下文压缩层 — 在内容发送给 LLM 前进行智能压缩，节省 60-95% Token',
  author: 'chopratejas',
  type: 'skill',
  transport: 'streamable-http',
  installSource: 'npm',
  packageName: 'headroom-ai',
  category: 'context-compression',
  tags: ['compression', 'tokens', 'context', 'mcp'],
  icon: '🗜️',
  verified: true,
  builtin: true,
  configSchema: {
    type: 'object',
    properties: {
      proxyUrl: {
        type: 'string',
        title: 'Proxy URL',
        description: 'Headroom proxy 地址',
        default: 'http://localhost:8787',
      },
      apiKey: {
        type: 'string',
        title: 'API Key',
        description: '可选的 Headroom Cloud API Key',
      },
      mode: {
        type: 'string',
        enum: ['audit', 'optimize', 'simulate'],
        title: '压缩模式',
        default: 'optimize',
      },
    },
  },
};

const FILESYSTEM_MANIFEST: PluginManifest = {
  id: 'filesystem',
  name: 'Filesystem',
  version: '0.6.0',
  description: 'MCP 文件系统服务器 — 读写本地文件与目录',
  author: 'modelcontextprotocol',
  type: 'mcp-server',
  transport: 'stdio',
  installSource: 'npm',
  packageName: '@modelcontextprotocol/server-filesystem',
  category: 'file-system',
  tags: ['files', 'directory', 'read', 'write'],
  icon: '📁',
  verified: true,
  builtin: true,
  configSchema: {
    type: 'object',
    properties: {
      rootDir: {
        type: 'string',
        title: 'Root Directory',
        description: '暴露给 AI 的根目录路径',
      },
    },
  },
};

const MEMORY_MANIFEST: PluginManifest = {
  id: 'memory',
  name: 'Memory',
  version: '0.6.0',
  description: 'MCP 记忆服务器 — 基于知识图谱的持久记忆存储',
  author: 'modelcontextprotocol',
  type: 'mcp-server',
  transport: 'stdio',
  installSource: 'npm',
  packageName: '@modelcontextprotocol/server-memory',
  category: 'ai-models',
  tags: ['memory', 'knowledge-graph', 'persistence'],
  icon: '🧠',
  verified: true,
  builtin: true,
};

const BRAVE_SEARCH_MANIFEST: PluginManifest = {
  id: 'brave-search',
  name: 'Brave Search',
  version: '0.6.0',
  description: 'MCP Brave 搜索服务器 — 通过 Brave Search API 进行网络搜索',
  author: 'modelcontextprotocol',
  type: 'mcp-server',
  transport: 'stdio',
  installSource: 'npm',
  packageName: '@modelcontextprotocol/server-brave-search',
  category: 'search',
  tags: ['search', 'web', 'brave'],
  icon: '🔍',
  verified: true,
  builtin: true,
  configSchema: {
    type: 'object',
    properties: {
      apiKey: {
        type: 'string',
        title: 'Brave API Key',
        description: 'Brave Search API Key',
      },
    },
  },
};

const GITHUB_MANIFEST: PluginManifest = {
  id: 'github',
  name: 'GitHub',
  version: '0.6.0',
  description: 'MCP GitHub 服务器 — 操作 GitHub 仓库、PR、Issue 等',
  author: 'modelcontextprotocol',
  type: 'mcp-server',
  transport: 'stdio',
  installSource: 'npm',
  packageName: '@modelcontextprotocol/server-github',
  category: 'dev-tools',
  tags: ['github', 'repository', 'pr', 'issue'],
  icon: '🐙',
  verified: true,
  builtin: true,
  configSchema: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        title: 'GitHub Token',
        description: 'GitHub Personal Access Token',
      },
    },
  },
};

const POSTGRES_MANIFEST: PluginManifest = {
  id: 'postgres',
  name: 'PostgreSQL',
  version: '0.6.0',
  description: 'MCP PostgreSQL 服务器 — 只读查询 PostgreSQL 数据库',
  author: 'modelcontextprotocol',
  type: 'mcp-server',
  transport: 'stdio',
  installSource: 'npm',
  packageName: '@modelcontextprotocol/server-postgres',
  category: 'database',
  tags: ['postgres', 'sql', 'database', 'query'],
  icon: '🐘',
  verified: true,
  builtin: true,
  configSchema: {
    type: 'object',
    properties: {
      connectionString: {
        type: 'string',
        title: 'Connection String',
        description: 'PostgreSQL 连接字符串',
      },
    },
  },
};

/** 内置插件列表 */
export const BUILTIN_PLUGINS: PluginManifest[] = [
  HEADROOM_MANIFEST,
  FILESYSTEM_MANIFEST,
  MEMORY_MANIFEST,
  BRAVE_SEARCH_MANIFEST,
  GITHUB_MANIFEST,
  POSTGRES_MANIFEST,
];

// ===== 分类映射 =====

export const categories: Record<PluginCategory, { label: string; icon: string }> = {
  'context-compression': { label: '上下文压缩', icon: '🗜️' },
  search: { label: '搜索', icon: '🔍' },
  database: { label: '数据库', icon: '🗃️' },
  'dev-tools': { label: '开发工具', icon: '🛠️' },
  'ai-models': { label: 'AI 模型', icon: '🤖' },
  'file-system': { label: '文件系统', icon: '📁' },
  communication: { label: '通信', icon: '📡' },
  monitoring: { label: '监控', icon: '📊' },
  other: { label: '其他', icon: '📦' },
};

// ===== 内置目录索引 =====

const builtinRegistry: Map<string, PluginRegistryEntry> = new Map(
  BUILTIN_PLUGINS.map((m) => [
    m.id,
    {
      manifest: m,
      popularity: m.builtin ? 100 : 50,
      rating: m.verified ? 5 : 4,
    },
  ]),
);

// ===== 搜索与查询 =====

/** 搜索插件（内置目录 + npm） */
export async function searchPlugins(query: string): Promise<PluginRegistryEntry[]> {
  const lower = query.toLowerCase();
  const results: PluginRegistryEntry[] = [];

  // 从内置目录搜索
  for (const entry of builtinRegistry.values()) {
    const m = entry.manifest;
    const haystack = `${m.id} ${m.name} ${m.description} ${m.tags.join(' ')} ${m.category}`.toLowerCase();
    if (haystack.includes(lower)) {
      results.push(entry);
    }
  }

  // 从 npm 搜索（按分类关键词搜索 mcp-server 包）
  try {
    const npmResults = await searchNpmPlugins(query);
    for (const entry of npmResults) {
      if (!builtinRegistry.has(entry.manifest.id)) {
        results.push(entry);
      }
    }
  } catch {
    // npm 搜索失败时静默降级，仅返回内置结果
  }

  return results;
}

/** 获取插件清单 */
export function getPluginManifest(id: string): PluginManifest | undefined {
  return builtinRegistry.get(id)?.manifest;
}

/** 获取所有内置注册表条目 */
export function getBuiltinEntries(): PluginRegistryEntry[] {
  return Array.from(builtinRegistry.values());
}

// ===== npm 搜索辅助 =====

interface NpmSearchResult {
  package: {
    name: string;
    version: string;
    description?: string;
    author?: { name?: string } | string;
    keywords?: string[];
  };
  score?: { detail?: { popularity?: number } };
}

async function searchNpmPlugins(query: string): Promise<PluginRegistryEntry[]> {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query + ' mcp server')}&size=20`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { objects: NpmSearchResult[] };
  return (data.objects ?? [])
    .filter((o) => o.package.name)
    .map((o) => npmResultToEntry(o));
}

function npmResultToEntry(o: NpmSearchResult): PluginRegistryEntry {
  const pkg = o.package;
  const authorName = typeof pkg.author === 'object' ? pkg.author.name ?? 'unknown' : (pkg.author ?? 'unknown');
  return {
    manifest: {
      id: pkg.name.replace(/^@/, '').replace(/\//g, '-'),
      name: pkg.name,
      version: pkg.version,
      description: pkg.description ?? '',
      author: authorName,
      type: 'mcp-server',
      transport: 'stdio',
      installSource: 'npm',
      packageName: pkg.name,
      category: guessCategory(pkg.keywords ?? []),
      tags: (pkg.keywords ?? []).slice(0, 8),
      verified: false,
      builtin: false,
    },
    popularity: o.score?.detail?.popularity ?? 0,
    rating: 0,
  };
}

function guessCategory(keywords: string[]): PluginCategory {
  const k = keywords.join(' ').toLowerCase();
  if (k.includes('search')) return 'search';
  if (k.includes('database') || k.includes('sql') || k.includes('postgres') || k.includes('mysql')) return 'database';
  if (k.includes('file') || k.includes('filesystem')) return 'file-system';
  if (k.includes('memory') || k.includes('context') || k.includes('compression')) return 'context-compression';
  if (k.includes('github') || k.includes('git') || k.includes('dev')) return 'dev-tools';
  if (k.includes('monitor') || k.includes('observ')) return 'monitoring';
  if (k.includes('chat') || k.includes('message') || k.includes('comm')) return 'communication';
  if (k.includes('ai') || k.includes('model') || k.includes('llm')) return 'ai-models';
  return 'other';
}
