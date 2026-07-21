import { useState } from 'react';
import {
  Plus,
  Settings,
  Key,
  Globe,
  Trash2,
  Edit3,
  X,
  Check,
  Eye,
  EyeOff,
  ChevronDown,
  Server,
  Cpu,
  Plug,
  RefreshCw,
  Link2,
  Network,
  Loader2,
} from 'lucide-react';
import { useStore, providerPresets } from '../store/useStore';
import { cn } from '../lib/utils';
import type { Channel, ModelConfig, MCPServer, MCPTool } from '../types';
import { connectMcpServer, listMcpTools } from '../api/llmApi';

type Provider = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'azure' | 'custom';

const providerLabels: Record<Provider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  deepseek: 'DeepSeek',
  azure: 'Azure OpenAI',
  custom: '自定义',
};

interface ChannelForm {
  name: string;
  provider: Provider;
  apiKey: string;
  baseUrl: string;
  models: ModelConfig[];
  enabled: boolean;
}

function genModelId(): string {
  return Date.now().toString() + Math.random().toString(36).slice(2, 6);
}

function maskApiKey(key: string): string {
  if (!key) return '未设置';
  if (key.length <= 8) return '••••••••';
  const last4 = key.slice(-4);
  if (key.startsWith('sk-')) {
    return `sk-****${last4}`;
  }
  return `****${last4}`;
}

function createInitialForm(): ChannelForm {
  const preset = providerPresets.openai;
  return {
    name: '',
    provider: 'openai',
    apiKey: '',
    baseUrl: preset.baseUrl,
    models: preset.models.map((m) => ({ ...m, id: genModelId() })),
    enabled: true,
  };
}

type McpTransport = 'streamable-http' | 'sse' | 'local-fs';

interface McpForm {
  name: string;
  transport: McpTransport;
  url: string;
  fsDir?: string; // local-fs 模式：服务器目录绝对路径
  headers: string; // "Key: Value" 每行一个
  enabled: boolean;
}

function createInitialMcpForm(): McpForm {
  return {
    name: '',
    transport: 'streamable-http',
    url: '',
    headers: '',
    enabled: true,
  };
}

function parseHeaders(text: string): Record<string, string> {
  const obj: Record<string, string> = {};
  text.split('\n').forEach((line) => {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k) obj[k] = v;
    }
  });
  return obj;
}

export function SettingsPage() {
  const {
    channels,
    addChannel,
    updateChannel,
    deleteChannel,
    toggleChannelEnabled,
    mcps,
    addMCP,
    updateMCP,
    deleteMCP,
    setMCPStatus,
  } = useStore();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ChannelForm>(createInitialForm);
  const [showApiKey, setShowApiKey] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // MCP 状态
  const [activeTab, setActiveTab] = useState<'channels' | 'mcp'>('channels');
  const [mcpDrawerOpen, setMcpDrawerOpen] = useState(false);
  const [mcpEditingId, setMcpEditingId] = useState<string | null>(null);
  const [mcpForm, setMcpForm] = useState<McpForm>(createInitialMcpForm);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    setForm(createInitialForm());
    setShowApiKey(false);
    setDrawerOpen(true);
  };

  const handleOpenEdit = (channel: Channel) => {
    setEditingId(channel.id);
    setForm({
      name: channel.name,
      provider: channel.provider,
      apiKey: channel.apiKey,
      baseUrl: channel.baseUrl,
      models: channel.models.map((m) => ({ ...m })),
      enabled: channel.enabled,
    });
    setShowApiKey(false);
    setDrawerOpen(true);
  };

  const handleProviderChange = (provider: Provider) => {
    const preset = providerPresets[provider];
    setForm((prev) => ({
      ...prev,
      provider,
      baseUrl: preset.baseUrl,
      models: preset.models.map((m) => ({ ...m, id: genModelId() })),
    }));
  };

  const handleAddModel = () => {
    setForm((prev) => ({
      ...prev,
      models: [...prev.models, { id: genModelId(), name: '', displayName: '' }],
    }));
  };

  const handleRemoveModel = (id: string) => {
    setForm((prev) => ({
      ...prev,
      models: prev.models.filter((m) => m.id !== id),
    }));
  };

  const handleModelChange = (id: string, field: 'name' | 'displayName', value: string) => {
    setForm((prev) => ({
      ...prev,
      models: prev.models.map((m) => (m.id === id ? { ...m, [field]: value } : m)),
    }));
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      showToast('请输入渠道名称');
      return;
    }
    if (form.name.length > 100) {
      showToast('渠道名称不能超过 100 字符');
      return;
    }
    if (form.apiKey && form.apiKey.length > 500) {
      showToast('API Key 长度不能超过 500 字符');
      return;
    }
    const validModels = form.models.filter((m) => m.name.trim());
    if (validModels.length === 0) {
      showToast('至少需要添加一个模型');
      return;
    }
    const payload = {
      name: form.name.trim(),
      provider: form.provider,
      apiKey: form.apiKey.trim(),
      baseUrl: form.baseUrl.trim(),
      models: validModels,
      enabled: form.enabled,
    };
    if (editingId) {
      updateChannel(editingId, payload);
      showToast('渠道已更新');
    } else {
      addChannel(payload);
      showToast('渠道已添加');
    }
    setDrawerOpen(false);
  };

  const handleDelete = (id: string) => {
    deleteChannel(id);
    showToast('渠道已删除');
  };

  // ===== MCP 服务器管理 =====
  const handleOpenAddMcp = () => {
    setMcpEditingId(null);
    setMcpForm(createInitialMcpForm());
    setMcpDrawerOpen(true);
  };

  const handleOpenEditMcp = (server: MCPServer) => {
    setMcpEditingId(server.id);
    setMcpForm({
      name: server.name,
      transport: server.transport,
      url: server.url || '',
      fsDir: server.fsDir || '',
      headers: server.headers
        ? Object.entries(server.headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n')
        : '',
      enabled: server.enabled,
    });
    setMcpDrawerOpen(true);
  };

  const handleMcpSave = () => {
    if (!mcpForm.name.trim()) {
      showToast('请输入服务器名称');
      return;
    }
    if (mcpForm.transport === 'local-fs') {
      if (!mcpForm.fsDir?.trim()) {
        showToast('请输入要暴露给 AI 的目录路径');
        return;
      }
    } else if (!mcpForm.url.trim()) {
      showToast('请输入服务器地址');
      return;
    }
    const payload: any = {
      name: mcpForm.name.trim(),
      transport: mcpForm.transport,
      enabled: mcpForm.enabled,
    };
    if (mcpForm.transport === 'local-fs') {
      payload.fsDir = mcpForm.fsDir!.trim();
    } else {
      payload.url = mcpForm.url.trim();
      payload.headers = parseHeaders(mcpForm.headers);
    }
    if (mcpEditingId) {
      updateMCP(mcpEditingId, payload);
      showToast('MCP 服务器已更新');
    } else {
      addMCP(payload);
      showToast('MCP 服务器已添加');
    }
    setMcpDrawerOpen(false);
  };

  const handleMcpDelete = (id: string) => {
    deleteMCP(id);
    showToast('MCP 服务器已删除');
  };

  const handleMcpConnect = async (server: MCPServer) => {
    setConnectingId(server.id);
    try {
      const res = await connectMcpServer({
        id: server.id,
        name: server.name,
        transport: server.transport,
        url: server.url,
        fsDir: server.fsDir,
        headers: server.headers,
        enabled: server.enabled,
      });
      if (res.success) {
        const tools: MCPTool[] = (res.tools || []).map((t: any) => ({
          name: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema || t.input_schema || { type: 'object', properties: {} },
        }));
        setMCPStatus(server.id, 'connected', tools);
        showToast(`连接成功，发现 ${tools.length} 个工具`);
      } else {
        setMCPStatus(server.id, 'error', undefined, res.error || '连接失败');
        showToast(`连接失败：${res.error || '未知错误'}`);
      }
    } catch (e: any) {
      setMCPStatus(server.id, 'error', undefined, e.message);
      showToast(`连接异常：${e.message}`);
    } finally {
      setConnectingId(null);
    }
  };

  const handleMcpRefresh = async (server: MCPServer) => {
    if (server.status !== 'connected') {
      handleMcpConnect(server);
      return;
    }
    setConnectingId(server.id);
    try {
      const res = await listMcpTools(server.id);
      if (res.success) {
        const tools: MCPTool[] = (res.tools || []).map((t: any) => ({
          name: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema || t.input_schema || { type: 'object', properties: {} },
        }));
        setMCPStatus(server.id, 'connected', tools);
        showToast(`已刷新，当前 ${tools.length} 个工具`);
      } else {
        showToast(`刷新失败：${res.error || '未知错误'}`);
      }
    } catch (e: any) {
      showToast(`刷新异常：${e.message}`);
    } finally {
      setConnectingId(null);
    }
  };

  const renderToggle = (on: boolean, onClick: () => void, title?: string) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'relative w-10 h-6 rounded-full transition-colors flex-shrink-0',
        on ? 'bg-accent' : 'bg-bg-active'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0 w-5 h-5 bg-white rounded-full shadow-sm transition-transform',
          on ? 'translate-x-[18px]' : 'translate-x-0.5'
        )}
      />
    </button>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-secondary">
      {/* Header */}
      <div className="bg-white border-b border-border px-4 md:px-6 py-4 md:py-5 flex-shrink-0">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-accent-bg flex items-center justify-center flex-shrink-0">
              <Settings className="w-5 h-5 text-accent" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-semibold text-text-primary">系统设置</h1>
              <p className="text-xs md:text-sm text-text-secondary truncate">
                管理 AI 模型渠道与 MCP 工具服务器
              </p>
            </div>
          </div>
          {activeTab === 'channels' ? (
            <button
              onClick={handleOpenAdd}
              className="flex items-center gap-1.5 px-3 md:px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors active:scale-[0.98] flex-shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">添加渠道</span>
              <span className="sm:hidden">添加</span>
            </button>
          ) : (
            <button
              onClick={handleOpenAddMcp}
              className="flex items-center gap-1.5 px-3 md:px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors active:scale-[0.98] flex-shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">添加服务器</span>
              <span className="sm:hidden">添加</span>
            </button>
          )}
        </div>

        {/* 标签切换 */}
        <div className="flex items-center gap-1 bg-bg-secondary rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab('channels')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
              activeTab === 'channels'
                ? 'bg-white text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            )}
          >
            <Cpu className="w-4 h-4" />
            AI 渠道
          </button>
          <button
            onClick={() => setActiveTab('mcp')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
              activeTab === 'mcp'
                ? 'bg-white text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            )}
          >
            <Plug className="w-4 h-4" />
            MCP 服务器
            {mcps.length > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium text-accent bg-accent-bg rounded-full">
                {mcps.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      {activeTab === 'channels' && (
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-6">
        <div className="max-w-5xl mx-auto">
          {channels.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 md:py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-bg-tertiary flex items-center justify-center mb-4">
                <Server className="w-8 h-8 text-text-tertiary" />
              </div>
              <h3 className="text-base md:text-lg font-medium text-text-primary mb-1">
                还没有配置渠道
              </h3>
              <p className="text-sm text-text-secondary mb-5 max-w-sm">
                添加你的第一个 AI 模型提供商，配置 API 密钥即可开始使用
              </p>
              <button
                onClick={handleOpenAdd}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors active:scale-[0.98]"
              >
                <Plus className="w-4 h-4" />
                添加第一个渠道
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              {channels.map((channel) => (
                <div
                  key={channel.id}
                  className={cn(
                    'bg-white border rounded-xl p-4 transition-all',
                    channel.enabled ? 'border-border' : 'border-border opacity-70'
                  )}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        className={cn(
                          'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                          channel.enabled ? 'bg-accent-bg' : 'bg-bg-tertiary'
                        )}
                      >
                        <Cpu
                          className={cn(
                            'w-5 h-5',
                            channel.enabled ? 'text-accent' : 'text-text-tertiary'
                          )}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-text-primary text-sm truncate">
                            {channel.name}
                          </h3>
                          <span className="px-1.5 py-0.5 text-[10px] font-medium text-accent bg-accent-bg rounded flex-shrink-0">
                            {providerLabels[channel.provider]}
                          </span>
                        </div>
                        <div className="text-xs text-text-tertiary mt-0.5">
                          {channel.models.length} 个模型
                        </div>
                      </div>
                    </div>
                    {renderToggle(
                      channel.enabled,
                      () => toggleChannelEnabled(channel.id),
                      channel.enabled ? '点击禁用' : '点击启用'
                    )}
                  </div>

                  {/* Base URL */}
                  <div className="flex items-center gap-2 mb-2 text-xs">
                    <Globe className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                    <span className="text-text-secondary truncate flex-1">
                      {channel.baseUrl || '未设置 Base URL'}
                    </span>
                  </div>

                  {/* API Key */}
                  <div className="flex items-center gap-2 mb-3 text-xs">
                    <Key className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                    <span className="text-text-secondary font-mono flex-1 truncate">
                      {revealedKey === channel.id ? channel.apiKey : maskApiKey(channel.apiKey)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setRevealedKey(revealedKey === channel.id ? null : channel.id)
                      }
                      className="text-text-tertiary hover:text-text-primary transition-colors"
                      title={revealedKey === channel.id ? '隐藏' : '显示'}
                    >
                      {revealedKey === channel.id ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {/* Models as tags */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {channel.models.length === 0 ? (
                      <span className="text-xs text-text-tertiary">暂无模型</span>
                    ) : (
                      <>
                        {channel.models.slice(0, 8).map((m) => (
                          <span
                            key={m.id}
                            className="px-2 py-0.5 text-[11px] bg-bg-secondary text-text-secondary rounded border border-border"
                          >
                            {m.displayName || m.name}
                          </span>
                        ))}
                        {channel.models.length > 8 && (
                          <span className="px-2 py-0.5 text-[11px] text-text-tertiary">
                            +{channel.models.length - 8}
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-3 border-t border-border">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(channel)}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-text-secondary hover:text-accent hover:bg-accent-bg rounded-md transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(channel.id)}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-text-secondary hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}

      {/* MCP 服务器内容 */}
      {activeTab === 'mcp' && (
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-6">
          <div className="max-w-5xl mx-auto">
            {mcps.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 md:py-24 text-center">
                <div className="w-16 h-16 rounded-2xl bg-bg-tertiary flex items-center justify-center mb-4">
                  <Plug className="w-8 h-8 text-text-tertiary" />
                </div>
                <h3 className="text-base md:text-lg font-medium text-text-primary mb-1">
                  还没有配置 MCP 服务器
                </h3>
                <p className="text-sm text-text-secondary mb-5 max-w-sm">
                  通过 MCP（Model Context Protocol）接入外部工具，让 Agent 调用真实能力（搜索、数据库、代码执行等）
                </p>
                <button
                  onClick={handleOpenAddMcp}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors active:scale-[0.98]"
                >
                  <Plus className="w-4 h-4" />
                  添加第一个 MCP 服务器
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                {mcps.map((server) => {
                  const toolCount = server.tools?.length || 0;
                  const isConnecting = connectingId === server.id;
                  const statusColor =
                    server.status === 'connected'
                      ? 'text-emerald-600 bg-emerald-50'
                      : server.status === 'error'
                        ? 'text-red-600 bg-red-50'
                        : 'text-text-tertiary bg-bg-tertiary';
                  return (
                    <div
                      key={server.id}
                      className={cn(
                        'bg-white border rounded-xl p-4 transition-all',
                        server.enabled ? 'border-border' : 'border-border opacity-70'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div
                            className={cn(
                              'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                              server.status === 'connected' ? 'bg-emerald-50' : 'bg-bg-tertiary'
                            )}
                          >
                            <Plug
                              className={cn(
                                'w-5 h-5',
                                server.status === 'connected' ? 'text-emerald-600' : 'text-text-tertiary'
                              )}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium text-text-primary text-sm truncate">
                                {server.name}
                              </h3>
                              <span className={cn('px-1.5 py-0.5 text-[10px] font-medium rounded flex-shrink-0', statusColor)}>
                                {server.status === 'connected' ? '已连接' : server.status === 'error' ? '错误' : '未连接'}
                              </span>
                            </div>
                            <div className="text-xs text-text-tertiary mt-0.5 flex items-center gap-1">
                              <span className="px-1 py-0.5 bg-bg-secondary rounded border border-border">
                                {server.transport === 'sse' ? 'SSE' : server.transport === 'local-fs' ? '本地文件系统' : 'Streamable HTTP'}
                              </span>
                              <span>{toolCount} 个工具</span>
                            </div>
                          </div>
                        </div>
                        {renderToggle(
                          server.enabled,
                          () => updateMCP(server.id, { enabled: !server.enabled }),
                          server.enabled ? '点击禁用' : '点击启用'
                        )}
                      </div>

                      {/* URL */}
                      <div className="flex items-center gap-2 mb-2 text-xs">
                        <Link2 className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                        <span className="text-text-secondary truncate flex-1 font-mono">
                          {server.url}
                        </span>
                      </div>

                      {/* 错误信息 */}
                      {server.status === 'error' && server.lastError && (
                        <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-2 py-1.5 truncate">
                          {server.lastError}
                        </div>
                      )}

                      {/* 工具列表 */}
                      {toolCount > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-3 max-h-24 overflow-y-auto">
                          {server.tools.slice(0, 10).map((t) => (
                            <span
                              key={t.name}
                              title={t.description}
                              className="px-2 py-0.5 text-[11px] bg-bg-secondary text-text-secondary rounded border border-border"
                            >
                              {t.name}
                            </span>
                          ))}
                          {toolCount > 10 && (
                            <span className="px-2 py-0.5 text-[11px] text-text-tertiary">
                              +{toolCount - 10}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-3 border-t border-border">
                        {server.status === 'connected' ? (
                          <button
                            type="button"
                            onClick={() => handleMcpRefresh(server)}
                            disabled={isConnecting}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-text-secondary hover:text-accent hover:bg-accent-bg rounded-md transition-colors disabled:opacity-50"
                          >
                            <RefreshCw className={cn('w-3.5 h-3.5', isConnecting && 'animate-spin')} />
                            刷新工具
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleMcpConnect(server)}
                            disabled={isConnecting}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-accent hover:bg-accent-bg rounded-md transition-colors disabled:opacity-50"
                          >
                            {isConnecting ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Network className="w-3.5 h-3.5" />
                            )}
                            连接测试
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleOpenEditMcp(server)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-text-secondary hover:text-accent hover:bg-accent-bg rounded-md transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMcpDelete(server.id)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-text-secondary hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          删除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="relative w-full sm:w-[480px] bg-white h-full flex flex-col shadow-2xl">
            {/* Drawer Header */}
            <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                {editingId ? (
                  <Edit3 className="w-4 h-4 text-accent" />
                ) : (
                  <Plus className="w-4 h-4 text-accent" />
                )}
                <h3 className="font-semibold text-text-primary">
                  {editingId ? '编辑渠道' : '添加渠道'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">
                  渠道名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="例如：生产环境 OpenAI"
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>

              {/* Provider */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">提供商</label>
                <div className="relative">
                  <select
                    value={form.provider}
                    onChange={(e) => handleProviderChange(e.target.value as Provider)}
                    className="w-full pl-3 pr-9 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white appearance-none"
                  >
                    {(Object.keys(providerPresets) as Provider[]).map((p) => (
                      <option key={p} value={p}>
                        {providerLabels[p]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
                </div>
              </div>

              {/* API Key */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">API Key</label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={form.apiKey}
                    onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                    placeholder="sk-..."
                    className="w-full pl-3 pr-10 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors p-1"
                    title={showApiKey ? '隐藏' : '显示'}
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Base URL */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">Base URL</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
                  <input
                    type="text"
                    value={form.baseUrl}
                    onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                    placeholder="https://api.example.com/v1"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>

              {/* Models */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-text-primary">
                    模型列表{' '}
                    <span className="text-xs text-text-tertiary">({form.models.length})</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAddModel}
                    className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    添加模型
                  </button>
                </div>
                <div className="space-y-2">
                  {form.models.length === 0 ? (
                    <div className="text-center py-6 bg-bg-secondary rounded-md border border-dashed border-border">
                      <Cpu className="w-6 h-6 text-text-tertiary mx-auto mb-1.5" />
                      <p className="text-xs text-text-tertiary">暂无模型，点击"添加模型"创建</p>
                    </div>
                  ) : (
                    form.models.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center gap-2 p-2 bg-bg-secondary rounded-md border border-border"
                      >
                        <div className="flex-1 grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={m.name}
                            onChange={(e) => handleModelChange(m.id, 'name', e.target.value)}
                            placeholder="模型名称（如 gpt-4o）"
                            className="px-2 py-1.5 text-xs border border-border rounded bg-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent font-mono"
                          />
                          <input
                            type="text"
                            value={m.displayName}
                            onChange={(e) => handleModelChange(m.id, 'displayName', e.target.value)}
                            placeholder="显示名称（如 GPT-4o）"
                            className="px-2 py-1.5 text-xs border border-border rounded bg-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveModel(m.id)}
                          className="p-1.5 text-text-tertiary hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                          title="删除模型"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Enabled toggle in form */}
              <div className="flex items-center justify-between p-3 bg-bg-secondary rounded-md border border-border">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-primary">启用渠道</div>
                  <div className="text-xs text-text-tertiary">禁用后将不会在模型选择中显示</div>
                </div>
                {renderToggle(
                  form.enabled,
                  () => setForm((prev) => ({ ...prev, enabled: !prev.enabled })),
                  form.enabled ? '点击禁用' : '点击启用'
                )}
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-border flex gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="flex items-center justify-center px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors active:scale-[0.98]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!form.name.trim()}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium rounded-md transition-colors active:scale-[0.98]',
                  form.name.trim()
                    ? 'text-white bg-accent hover:bg-accent-hover'
                    : 'bg-bg-tertiary text-text-tertiary cursor-not-allowed'
                )}
              >
                <Check className="w-4 h-4" />
                {editingId ? '保存修改' : '添加渠道'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MCP Drawer */}
      {mcpDrawerOpen && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMcpDrawerOpen(false)} />
          <div className="relative w-full sm:w-[480px] bg-white h-full flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                {mcpEditingId ? (
                  <Edit3 className="w-4 h-4 text-accent" />
                ) : (
                  <Plus className="w-4 h-4 text-accent" />
                )}
                <h3 className="font-semibold text-text-primary">
                  {mcpEditingId ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMcpDrawerOpen(false)}
                className="p-1.5 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">
                  服务器名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={mcpForm.name}
                  onChange={(e) => setMcpForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="例如：文件系统 MCP"
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>

              {/* Transport */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">传输协议</label>
                <div className="relative">
                  <select
                    value={mcpForm.transport}
                    onChange={(e) => setMcpForm((prev) => ({ ...prev, transport: e.target.value as McpTransport }))}
                    className="w-full pl-3 pr-9 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white appearance-none"
                  >
                    <option value="streamable-http">Streamable HTTP</option>
                    <option value="sse">SSE</option>
                    <option value="local-fs">本地文件系统（服务器目录）</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
                </div>
              </div>

              {/* URL / 目录路径（按传输协议切换） */}
              {mcpForm.transport === 'local-fs' ? (
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1.5">
                    目录路径 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={mcpForm.fsDir || ''}
                    onChange={(e) => setMcpForm((prev) => ({ ...prev, fsDir: e.target.value }))}
                    placeholder="/home/user/project 或 C:\\projects\\myapp"
                    className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent font-mono"
                  />
                  <p className="text-xs text-text-tertiary mt-1.5">
                    该目录位于 AgentFlow 后端服务器上，连接后 AI 将能直接读写其中的文件。
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1.5">
                    服务器地址 <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
                    <input
                      type="text"
                      value={mcpForm.url}
                      onChange={(e) => setMcpForm((prev) => ({ ...prev, url: e.target.value }))}
                      placeholder="https://example.com/mcp"
                      className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Headers（仅 HTTP/SSE） */}
              {mcpForm.transport !== 'local-fs' && (
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1.5">
                    Header 认证 <span className="text-xs text-text-tertiary font-normal">（每行一个，格式 Key: Value）</span>
                  </label>
                  <textarea
                    value={mcpForm.headers}
                    onChange={(e) => setMcpForm((prev) => ({ ...prev, headers: e.target.value }))}
                    placeholder={'Authorization: Bearer xxx\nX-Api-Key: yyy'}
                    rows={3}
                    className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none font-mono text-xs"
                  />
                </div>
              )}

              {/* Enabled toggle */}
              <div className="flex items-center justify-between p-3 bg-bg-secondary rounded-md border border-border">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-primary">启用服务器</div>
                  <div className="text-xs text-text-tertiary">禁用后该服务器的工具不会被 Agent 调用</div>
                </div>
                {renderToggle(
                  mcpForm.enabled,
                  () => setMcpForm((prev) => ({ ...prev, enabled: !prev.enabled })),
                  mcpForm.enabled ? '点击禁用' : '点击启用'
                )}
              </div>
            </div>

            <div className="p-4 border-t border-border flex gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setMcpDrawerOpen(false)}
                className="flex items-center justify-center px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors active:scale-[0.98]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleMcpSave}
                disabled={!mcpForm.name.trim()}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium rounded-md transition-colors active:scale-[0.98]',
                  mcpForm.name.trim()
                    ? 'text-white bg-accent hover:bg-accent-hover'
                    : 'bg-bg-tertiary text-text-tertiary cursor-not-allowed'
                )}
              >
                <Check className="w-4 h-4" />
                {mcpEditingId ? '保存修改' : '添加服务器'}
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
