import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Check,
  Loader2,
  RefreshCw,
  Settings,
  X,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Puzzle,
  Package,
  CheckCircle2,
  AlertCircle,
  Download,
  Sparkles,
  Zap,
  Database,
  Code2,
  Wrench,
  Globe,
  FileText,
  Brain,
  Plug,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useStore } from '../store/useStore';
import {
  installPlugin,
  uninstallPlugin,
  startPlugin,
  stopPlugin,
  getInstalledPlugins,
  configurePlugin,
} from '../api/pluginApi';

// ===== 类型定义 =====

type PluginStatus = 'Available' | 'Installing' | 'Installed' | 'Running' | 'Error' | 'Stopping';

interface MarketPlugin {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  author: string;
  version: string;
  status: PluginStatus;
  configSchema?: SchemaProperty;
  config?: Record<string, any>;
  errorMessage?: string;
  tools?: Array<{ name: string; description: string }>;
  downloads?: number;
  tags?: string[];
}

interface SchemaProperty {
  type: string;
  title?: string;
  description?: string;
  default?: any;
  widget?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

// ===== 分类定义 =====

const categories = [
  { key: 'all', label: '全部', icon: Package },
  { key: 'context-compression', label: '上下文压缩', icon: MinimizeIcon },
  { key: 'search', label: '搜索', icon: Search },
  { key: 'database', label: '数据库', icon: Database },
  { key: 'dev-tools', label: '开发工具', icon: Code2 },
  { key: 'mcp', label: 'MCP 工具', icon: Plug },
  { key: 'memory', label: '记忆增强', icon: Brain },
  { key: 'ai', label: 'AI 增强', icon: Sparkles },
  { key: 'web', label: '网络', icon: Globe },
  { key: 'doc', label: '文档', icon: FileText },
] as const;

// ===== 图标映射 =====

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Globe,
  Code2,
  Database,
  Search,
  Sparkles,
  Plug,
  Brain,
  FileText,
  Wrench,
  Zap,
  Puzzle,
  Package,
};

function getPluginIcon(iconName: string) {
  return iconMap[iconName] || Puzzle;
}

function MinimizeIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
    </svg>
  );
}

// ===== 动态配置表单 (基于 SchemaProperty, 参考 PropertiesPanel) =====

interface ConfigFormFieldProps {
  schema: SchemaProperty;
  value: any;
  onChange: (value: any) => void;
  required?: boolean;
  path: string;
}

function ConfigFormField({ schema, value, onChange, required, path }: ConfigFormFieldProps) {
  const type = schema.type;
  const widget = schema.widget;

  if (widget === 'textarea' || widget === 'code-editor') {
    return (
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">
          {schema.title || path}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {schema.description && <p className="text-xs text-text-tertiary mb-1.5">{schema.description}</p>}
        <textarea
          value={value ?? schema.default ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={widget === 'code-editor' ? 8 : 4}
          className={cn(
            'w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none',
            widget === 'code-editor' && 'font-mono text-xs'
          )}
        />
      </div>
    );
  }

  if (type === 'string' && schema.enum) {
    return (
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">
          {schema.title || path}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {schema.description && <p className="text-xs text-text-tertiary mb-1.5">{schema.description}</p>}
        <select
          value={value ?? schema.default ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
        >
          {schema.enum.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  if (type === 'string') {
    return (
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">
          {schema.title || path}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {schema.description && <p className="text-xs text-text-tertiary mb-1.5">{schema.description}</p>}
        <input
          type="text"
          value={value ?? schema.default ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
      </div>
    );
  }

  if (type === 'number' || type === 'integer') {
    const hasRange = schema.minimum !== undefined && schema.maximum !== undefined;
    return (
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">
          {schema.title || path}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {schema.description && <p className="text-xs text-text-tertiary mb-1.5">{schema.description}</p>}
        {hasRange ? (
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={schema.minimum}
              max={schema.maximum}
              step={type === 'integer' ? 1 : 0.1}
              value={value ?? schema.default ?? 0}
              onChange={(e) => onChange(parseFloat(e.target.value))}
              className="flex-1 accent-accent"
            />
            <span className="text-sm text-text-secondary w-12 text-right">{value ?? schema.default ?? 0}</span>
          </div>
        ) : (
          <input
            type="number"
            min={schema.minimum}
            max={schema.maximum}
            value={value ?? schema.default ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? '' : parseFloat(e.target.value))}
            className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        )}
      </div>
    );
  }

  if (type === 'boolean') {
    return (
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium text-text-primary">
            {schema.title || path}
            {required && <span className="text-red-500 ml-1">*</span>}
          </label>
          {schema.description && <p className="text-xs text-text-tertiary mt-0.5">{schema.description}</p>}
        </div>
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={cn(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
            value ? 'bg-accent' : 'bg-gray-300'
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
              value ? 'translate-x-6' : 'translate-x-1'
            )}
          />
        </button>
      </div>
    );
  }

  if (type === 'object' && schema.properties) {
    return <ConfigObjectField schema={schema} value={value} onChange={onChange} path={path} />;
  }

  if (type === 'array' && schema.items?.type === 'string') {
    const arrValue = Array.isArray(value) ? value : [];
    const [inputValue, setInputValue] = useState('');

    const addItem = () => {
      if (inputValue.trim()) {
        onChange([...arrValue, inputValue.trim()]);
        setInputValue('');
      }
    };

    return (
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">
          {schema.title || path}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {schema.description && <p className="text-xs text-text-tertiary mb-1.5">{schema.description}</p>}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {arrValue.map((item: string, index: number) => (
            <span key={index} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-accent/10 text-accent rounded-full">
              {item}
              <button onClick={() => onChange(arrValue.filter((_: string, i: number) => i !== index))} className="hover:text-accent-dark">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
            placeholder="输入后按回车添加"
            className="flex-1 px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
          <button type="button" onClick={addItem} className="px-3 py-2 text-sm bg-accent text-white rounded-md hover:bg-accent-hover transition-colors">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function ConfigObjectField({
  schema,
  value,
  onChange,
  path,
}: {
  schema: SchemaProperty;
  value: any;
  onChange: (value: any) => void;
  path: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const objValue = value ?? {};
  const required = schema.required || [];

  const handlePropertyChange = (key: string, val: any) => {
    onChange({ ...objValue, [key]: val });
  };

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3 py-2 bg-bg-secondary hover:bg-bg-hover transition-colors"
      >
        <span className="text-sm font-medium text-text-primary">{schema.title || path}</span>
        {collapsed ? <ChevronRight className="w-4 h-4 text-text-tertiary" /> : <ChevronDown className="w-4 h-4 text-text-tertiary" />}
      </button>
      {!collapsed && (
        <div className="p-3 space-y-3">
          {Object.entries(schema.properties || {}).map(([key, propSchema]) => (
            <ConfigFormField
              key={key}
              schema={propSchema}
              value={objValue[key]}
              onChange={(val) => handlePropertyChange(key, val)}
              required={required.includes(key)}
              path={key}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ===== 主页面组件 =====

export function PluginMarketPage() {
  const { plugins, togglePlugin } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [installedMap, setInstalledMap] = useState<Record<string, { status: PluginStatus; config?: Record<string, any>; errorMessage?: string }>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [configPluginId, setConfigPluginId] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState<Record<string, any>>({});
  const [savingConfig, setSavingConfig] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  // 加载已安装插件列表
  useEffect(() => {
    const loadInstalled = async () => {
      try {
        const installed = await getInstalledPlugins();
        const map: Record<string, { status: PluginStatus; config?: Record<string, any>; errorMessage?: string }> = {};
        installed.forEach((p: any) => {
          map[p.id] = {
            status: p.running ? 'Running' : 'Installed',
            config: p.config || {},
            errorMessage: p.errorMessage,
          };
        });
        setInstalledMap(map);
      } catch {
        // 后端未就绪，使用本地 plugins 数据
        const map: Record<string, { status: PluginStatus; config?: Record<string, any>; errorMessage?: string }> = {};
        plugins.filter((p) => p.installed).forEach((p) => {
          map[p.id] = { status: 'Installed' };
        });
        setInstalledMap(map);
      }
    };
    loadInstalled();
  }, [plugins]);

  // 合并本地插件与安装状态
  const marketPlugins: MarketPlugin[] = plugins.map((p: any) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    icon: p.icon || 'Puzzle',
    category: p.category || 'other',
    author: p.author || 'Unknown',
    version: p.version || '1.0.0',
    status: installedMap[p.id]?.status || 'Available',
    config: installedMap[p.id]?.config,
    errorMessage: installedMap[p.id]?.errorMessage,
    downloads: p.downloads,
    tags: p.tags,
  }));

  // 过滤
  const filteredPlugins = marketPlugins.filter((p) => {
    const matchesSearch =
      !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.author && p.author.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // 安装/卸载/启停 操作
  const handleInstall = async (plugin: MarketPlugin) => {
    setLoadingMap((prev) => ({ ...prev, [plugin.id]: true }));
    setInstalledMap((prev) => ({ ...prev, [plugin.id]: { ...prev[plugin.id], status: 'Installing' } }));
    try {
      const result = await installPlugin(plugin.id);
      if (result.success) {
        setInstalledMap((prev) => ({ ...prev, [plugin.id]: { status: 'Installed', config: {} } }));
        togglePlugin(plugin.id);
        showToast(`${plugin.name} 安装成功`);
      } else {
        setInstalledMap((prev) => ({ ...prev, [plugin.id]: { status: 'Error', errorMessage: '安装失败' } }));
        showToast(`${plugin.name} 安装失败`);
      }
    } catch (e: any) {
      setInstalledMap((prev) => ({ ...prev, [plugin.id]: { status: 'Error', errorMessage: e.message } }));
      showToast(`安装异常: ${e.message}`);
    } finally {
      setLoadingMap((prev) => ({ ...prev, [plugin.id]: false }));
    }
  };

  const handleUninstall = async (plugin: MarketPlugin) => {
    setLoadingMap((prev) => ({ ...prev, [plugin.id]: true }));
    try {
      await uninstallPlugin(plugin.id);
      setInstalledMap((prev) => {
        const next = { ...prev };
        delete next[plugin.id];
        return next;
      });
      togglePlugin(plugin.id);
      showToast(`${plugin.name} 已卸载`);
    } catch (e: any) {
      showToast(`卸载异常: ${e.message}`);
    } finally {
      setLoadingMap((prev) => ({ ...prev, [plugin.id]: false }));
    }
  };

  const handleStart = async (plugin: MarketPlugin) => {
    setLoadingMap((prev) => ({ ...prev, [plugin.id]: true }));
    try {
      const result = await startPlugin(plugin.id);
      if (result.success) {
        setInstalledMap((prev) => ({ ...prev, [plugin.id]: { ...prev[plugin.id], status: 'Running' } }));
        showToast(`${plugin.name} 已启动`);
      }
    } catch (e: any) {
      setInstalledMap((prev) => ({ ...prev, [plugin.id]: { ...prev[plugin.id], status: 'Error', errorMessage: e.message } }));
      showToast(`启动异常: ${e.message}`);
    } finally {
      setLoadingMap((prev) => ({ ...prev, [plugin.id]: false }));
    }
  };

  const handleStop = async (plugin: MarketPlugin) => {
    setLoadingMap((prev) => ({ ...prev, [plugin.id]: true }));
    setInstalledMap((prev) => ({ ...prev, [plugin.id]: { ...prev[plugin.id], status: 'Stopping' } }));
    try {
      await stopPlugin(plugin.id);
      setInstalledMap((prev) => ({ ...prev, [plugin.id]: { ...prev[plugin.id], status: 'Installed' } }));
      showToast(`${plugin.name} 已停止`);
    } catch (e: any) {
      showToast(`停止异常: ${e.message}`);
    } finally {
      setLoadingMap((prev) => ({ ...prev, [plugin.id]: false }));
    }
  };

  // 配置面板
  const handleOpenConfig = (plugin: MarketPlugin) => {
    setConfigPluginId(plugin.id);
    setConfigForm(plugin.config || {});
  };

  const handleSaveConfig = async () => {
    if (!configPluginId) return;
    setSavingConfig(true);
    try {
      const result = await configurePlugin(configPluginId, configForm);
      if (result.success) {
        setInstalledMap((prev) => ({
          ...prev,
          [configPluginId]: { ...prev[configPluginId], config: configForm },
        }));
        showToast('配置已保存');
        setConfigPluginId(null);
      } else {
        showToast('配置保存失败');
      }
    } catch (e: any) {
      showToast(`配置保存异常: ${e.message}`);
    } finally {
      setSavingConfig(false);
    }
  };

  // 获取当前配置面板的插件
  const configPlugin = configPluginId ? marketPlugins.find((p) => p.id === configPluginId) : null;

  // 统计
  const installedCount = Object.keys(installedMap).length;
  const runningCount = Object.values(installedMap).filter((s) => s.status === 'Running').length;

  // 状态按钮渲染
  const renderStatusButton = (plugin: MarketPlugin) => {
    const status = plugin.status;
    const isLoading = loadingMap[plugin.id];

    if (status === 'Installing') {
      return (
        <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent bg-accent-bg rounded-lg">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          安装中...
        </span>
      );
    }

    if (status === 'Stopping') {
      return (
        <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-tertiary bg-bg-secondary rounded-lg">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          停止中...
        </span>
      );
    }

    if (status === 'Error') {
      return (
        <button
          onClick={() => handleInstall(plugin)}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-100 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          重试
        </button>
      );
    }

    if (status === 'Installed') {
      return (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 rounded-lg">
            <Check className="w-3.5 h-3.5" />
            已安装
          </span>
          <button
            onClick={() => handleStart(plugin)}
            disabled={isLoading}
            className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-accent bg-accent-bg hover:bg-accent-bg-hover border border-accent/20 rounded-lg transition-colors disabled:opacity-50"
            title="启动插件"
          >
            <Zap className="w-3 h-3" />
            启动
          </button>
          <button
            onClick={() => handleUninstall(plugin)}
            disabled={isLoading}
            className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-text-secondary hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
            title="卸载插件"
          >
            <Trash2 className="w-3 h-3" />
            卸载
          </button>
        </div>
      );
    }

    if (status === 'Running') {
      return (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 rounded-lg">
            <CheckCircle2 className="w-3.5 h-3.5" />
            运行中
          </span>
          <button
            onClick={() => handleStop(plugin)}
            disabled={isLoading}
            className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-text-secondary hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50"
            title="停止插件"
          >
            <X className="w-3 h-3" />
            停止
          </button>
        </div>
      );
    }

    // Available
    return (
      <button
        onClick={() => handleInstall(plugin)}
        disabled={isLoading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-lg transition-colors disabled:opacity-50 active:scale-[0.98]"
      >
        {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        安装
      </button>
    );
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-secondary">
      {/* Header */}
      <div className="bg-white border-b border-border px-4 md:px-6 py-4 md:py-5 flex-shrink-0">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center flex-shrink-0">
              <Puzzle className="w-5 h-5 text-violet-600" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-semibold text-text-primary">插件市场</h1>
              <p className="text-xs md:text-sm text-text-secondary truncate">
                发现和安装插件，扩展 Agent 能力
              </p>
            </div>
          </div>
        </div>

        {/* 搜索框 */}
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
          <input
            type="text"
            placeholder="搜索插件名称、描述或作者..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
          />
        </div>
      </div>

      {/* 主体区域：左侧分类 + 右侧卡片 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧分类导航 */}
        <div className="w-48 md:w-52 flex-shrink-0 bg-white border-r border-border overflow-y-auto py-4 px-3 hidden md:block">
          <div className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2 px-2">
            分类
          </div>
          <div className="space-y-0.5">
            {categories.map((cat) => {
              const CatIcon = cat.icon;
              const isActive = selectedCategory === cat.key;
              const count = cat.key === 'all'
                ? marketPlugins.length
                : marketPlugins.filter((p) => p.category === cat.key).length;
              return (
                <button
                  key={cat.key}
                  onClick={() => setSelectedCategory(cat.key)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-2 text-sm rounded-md transition-colors',
                    isActive
                      ? 'bg-accent-bg text-accent font-medium'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                  )}
                >
                  <CatIcon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 text-left truncate">{cat.label}</span>
                  {count > 0 && (
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full',
                      isActive ? 'bg-accent/10 text-accent' : 'bg-bg-secondary text-text-tertiary'
                    )}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 移动端分类 pill 栏 */}
        <div className="md:hidden flex-shrink-0 bg-white border-b border-border px-4 py-2 overflow-x-auto">
          <div className="flex items-center gap-2">
            {categories.map((cat) => {
              const isActive = selectedCategory === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => setSelectedCategory(cat.key)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors',
                    isActive
                      ? 'bg-accent text-white'
                      : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover'
                  )}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 右侧内容区 */}
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-6">
          <div className="max-w-5xl mx-auto">
            {/* 统计卡片 */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {[
                { label: '可用插件', value: marketPlugins.length, icon: Package, color: 'bg-violet-50 text-violet-600' },
                { label: '已安装', value: installedCount, icon: CheckCircle2, color: 'bg-emerald-50 text-emerald-600' },
                { label: '运行中', value: runningCount, icon: Zap, color: 'bg-amber-50 text-amber-600' },
              ].map((stat) => {
                const StatIcon = stat.icon;
                return (
                  <div key={stat.label} className="bg-white border border-border rounded-xl p-3 flex items-center gap-3">
                    <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', stat.color)}>
                      <StatIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-text-primary">{stat.value}</div>
                      <div className="text-xs text-text-tertiary">{stat.label}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 插件卡片网格 */}
            {filteredPlugins.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-14 h-14 rounded-2xl bg-bg-tertiary flex items-center justify-center mb-3">
                  <Package className="w-7 h-7 text-text-tertiary" />
                </div>
                <h3 className="text-base font-medium text-text-primary mb-1">未找到插件</h3>
                <p className="text-sm text-text-secondary max-w-sm">
                  {searchQuery ? `没有匹配"${searchQuery}"的插件` : '该分类暂无插件'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                {filteredPlugins.map((plugin) => {
                  const PluginIcon = getPluginIcon(plugin.icon);
                  const isRunning = plugin.status === 'Running';
                  const isInstalled = plugin.status === 'Installed' || isRunning;
                  const hasError = plugin.status === 'Error';

                  return (
                    <div
                      key={plugin.id}
                      className={cn(
                        'rounded-lg border bg-white/60 shadow-sm p-4 transition-all hover:shadow-md',
                        hasError ? 'border-red-200' : isRunning ? 'border-emerald-200' : 'border-border'
                      )}
                    >
                      {/* 头部：图标 + 状态 */}
                      <div className="flex items-start justify-between mb-3">
                        <div className={cn(
                          'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                          isRunning ? 'bg-emerald-50' : hasError ? 'bg-red-50' : 'bg-violet-50'
                        )}>
                          <PluginIcon className={cn(
                            'w-5 h-5',
                            isRunning ? 'text-emerald-600' : hasError ? 'text-red-600' : 'text-violet-600'
                          )} />
                        </div>
                        <div className="flex items-center gap-1.5">
                          {hasError && (
                            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-red-600 bg-red-50 rounded-full">
                              <AlertCircle className="w-3 h-3" />
                              错误
                            </span>
                          )}
                          {isRunning && (
                            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-emerald-600 bg-emerald-50 rounded-full">
                              <CheckCircle2 className="w-3 h-3" />
                              运行中
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 名称与作者 */}
                      <h3 className="font-semibold text-text-primary text-sm mb-0.5 truncate">{plugin.name}</h3>
                      <p className="text-xs text-text-tertiary mb-2">
                        {plugin.author} · v{plugin.version}
                      </p>

                      {/* 描述 */}
                      <p className="text-xs text-text-secondary mb-3 line-clamp-2 min-h-[2.5em]">
                        {plugin.description}
                      </p>

                      {/* 标签 */}
                      {plugin.tags && plugin.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {plugin.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="px-2 py-0.5 bg-bg-secondary text-text-tertiary text-[10px] rounded-full">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* 错误信息 */}
                      {hasError && plugin.errorMessage && (
                        <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-2.5 py-2">
                          <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
                          {plugin.errorMessage}
                        </div>
                      )}

                      {/* 操作区 */}
                      <div className="flex items-center justify-between pt-3 border-t border-border">
                        {renderStatusButton(plugin)}
                        {isInstalled && plugin.configSchema && (
                          <button
                            onClick={() => handleOpenConfig(plugin)}
                            className="flex items-center gap-1 px-2 py-1.5 text-xs text-text-secondary hover:text-accent hover:bg-accent-bg rounded-md transition-colors"
                            title="配置"
                          >
                            <Settings className="w-3.5 h-3.5" />
                            配置
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== 配置面板 Drawer ===== */}
      {configPluginId && configPlugin && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfigPluginId(null)} />
          <div className="relative w-full sm:w-[480px] bg-white h-full flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-accent" />
                <h3 className="font-semibold text-text-primary">配置 - {configPlugin.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setConfigPluginId(null)}
                className="p-1.5 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {configPlugin.configSchema && configPlugin.configSchema.properties ? (
                Object.entries(configPlugin.configSchema.properties).map(([key, propSchema]) => (
                  <ConfigFormField
                    key={key}
                    schema={propSchema}
                    value={configForm[key]}
                    onChange={(val) => setConfigForm((prev) => ({ ...prev, [key]: val }))}
                    required={configPlugin.configSchema?.required?.includes(key)}
                    path={key}
                  />
                ))
              ) : (
                <div className="text-center py-8 text-sm text-text-tertiary">
                  此插件无可配置项
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border flex gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setConfigPluginId(null)}
                className="flex items-center justify-center px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors active:scale-[0.98]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={savingConfig}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium rounded-md transition-colors active:scale-[0.98]',
                  savingConfig
                    ? 'bg-bg-tertiary text-text-tertiary cursor-not-allowed'
                    : 'text-white bg-accent hover:bg-accent-hover'
                )}
              >
                {savingConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                保存配置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
