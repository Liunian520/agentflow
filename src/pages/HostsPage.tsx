import { useState } from 'react';
import {
  Server,
  Plus,
  Edit3,
  Trash2,
  Power,
  PowerOff,
  RefreshCw,
  X,
  Key,
  Globe,
  Tag,
  Monitor,
  Wifi,
  WifiOff,
  Loader2,
  Check,
  Terminal,
  Info,
  ShieldAlert,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { getSecurityWarning } from '../lib/cryptoUtils';
import type { RemoteHost } from '../types';
import { sshApi } from '../api/sshApi';

type DrawerMode = 'create' | 'edit' | null;

interface HostForm {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password: string;
  privateKey: string;
  description: string;
  tags: string;
  enabled: boolean;
}

const defaultForm: HostForm = {
  name: '',
  host: '',
  port: 22,
  username: '',
  authType: 'password',
  password: '',
  privateKey: '',
  description: '',
  tags: '',
  enabled: true,
};

export function HostsPage() {
  const { hosts, addHost, updateHost, deleteHost } = useStore();
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [editingHost, setEditingHost] = useState<RemoteHost | null>(null);
  const [form, setForm] = useState<HostForm>(defaultForm);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const handleOpenCreate = () => {
    setForm(defaultForm);
    setEditingHost(null);
    setDrawerMode('create');
  };

  const handleOpenEdit = (host: RemoteHost) => {
    setForm({
      name: host.name,
      host: host.host,
      port: host.port,
      username: host.username,
      authType: host.authType,
      password: host.password || '',
      privateKey: host.privateKey || '',
      description: host.description || '',
      tags: host.tags.join(', '),
      enabled: host.enabled,
    });
    setEditingHost(host);
    setDrawerMode('edit');
  };

  const handleCloseDrawer = () => {
    setDrawerMode(null);
    setEditingHost(null);
  };

  const handleSubmit = () => {
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) return;

    // 验证端口范围
    if (form.port < 1 || form.port > 65535) {
      showToast('端口范围应为 1-65535');
      return;
    }

    // 验证主机名/IP 格式（简单校验）
    const hostPattern = /^[a-zA-Z0-9._-]+$/;
    if (!hostPattern.test(form.host.trim())) {
      showToast('主机地址格式不正确');
      return;
    }

    const tags = form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const hostData = {
      name: form.name.trim().slice(0, 100),
      host: form.host.trim(),
      port: form.port,
      username: form.username.trim().slice(0, 100),
      authType: form.authType,
      password: form.authType === 'password' ? form.password : undefined,
      privateKey: form.authType === 'privateKey' ? form.privateKey : undefined,
      description: form.description.trim().slice(0, 500) || undefined,
      tags,
      enabled: form.enabled,
    };

    if (drawerMode === 'create') {
      addHost(hostData);
      showToast('主机添加成功');
    } else if (drawerMode === 'edit' && editingHost) {
      updateHost(editingHost.id, hostData);
      showToast('主机更新成功');
    }

    handleCloseDrawer();
  };

  const handleTestConnection = async (hostId: string) => {
    const host = hosts.find((h) => h.id === hostId);
    if (!host) return;

    setTestingId(hostId);
    setTestResult(null);

    try {
      const result = await sshApi.connect({
        hostId: host.id,
        host: host.host,
        port: host.port,
        username: host.username,
        authType: host.authType,
        password: host.password,
        privateKey: host.privateKey,
      });

      if (result.success) {
        updateHost(host.id, { status: 'online', lastConnected: new Date().toISOString() });
      }
      setTestResult({ id: hostId, success: result.success });
      showToast(result.success ? '连接测试成功' : result.message || '连接失败');
      setTimeout(() => setTestResult(null), 3000);
    } catch (error: any) {
      setTestResult({ id: hostId, success: false });
      showToast('连接测试失败: ' + error.message);
      setTimeout(() => setTestResult(null), 3000);
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleConnect = async (host: RemoteHost) => {
    if (host.status === 'online') {
      await sshApi.disconnect(host.id);
      updateHost(host.id, { status: 'offline' });
      showToast('已断开连接');
    } else {
      updateHost(host.id, { status: 'connecting' });
      try {
        const result = await sshApi.connect({
          hostId: host.id,
          host: host.host,
          port: host.port,
          username: host.username,
          authType: host.authType,
          password: host.password,
          privateKey: host.privateKey,
        });

        if (result.success) {
          updateHost(host.id, { status: 'online', lastConnected: new Date().toISOString() });
          showToast('连接成功');
        } else {
          updateHost(host.id, { status: 'offline' });
          showToast('连接失败: ' + result.message);
        }
      } catch (error: any) {
        updateHost(host.id, { status: 'offline' });
        showToast('连接失败: ' + error.message);
      }
    }
  };

  const handleDelete = (hostId: string) => {
    deleteHost(hostId);
    showToast('主机已删除');
    handleCloseDrawer();
  };

  const getStatusColor = (status: RemoteHost['status']) => {
    switch (status) {
      case 'online':
        return 'bg-emerald-100 text-emerald-700';
      case 'connecting':
        return 'bg-amber-100 text-amber-700';
      case 'offline':
        return 'bg-gray-100 text-gray-600';
    }
  };

  const getStatusIcon = (status: RemoteHost['status']) => {
    switch (status) {
      case 'online':
        return <Wifi className="w-3.5 h-3.5" />;
      case 'connecting':
        return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
      case 'offline':
        return <WifiOff className="w-3.5 h-3.5" />;
    }
  };

  const getStatusText = (status: RemoteHost['status']) => {
    switch (status) {
      case 'online':
        return '在线';
      case 'connecting':
        return '连接中';
      case 'offline':
        return '离线';
    }
  };

  const isFormValid = form.name.trim() && form.host.trim() && form.username.trim();

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-secondary">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Server className="w-6 h-6 text-accent" />
                <h1 className="text-xl font-bold text-text-primary">远程主机</h1>
              </div>
              <p className="text-sm text-text-secondary">管理您的 SSH 远程主机连接</p>
            </div>
            <button
              onClick={handleOpenCreate}
              className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">添加主机</span>
            </button>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                <Info className="w-4 h-4 text-amber-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-amber-800 mb-1">SSH 后端服务</h3>
                <p className="text-xs text-amber-700 mb-3">
                  远程主机连接需要后端 SSH 服务支持。请确保已启动后端服务：
                </p>
                <div className="bg-amber-100/50 rounded-lg p-3 font-mono text-xs">
                  <code className="block text-amber-900">$ npm run server</code>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-amber-600">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>服务地址: http://localhost:3001</span>
                </div>
              </div>
            </div>
          </div>

          {hosts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 md:py-24">
              <div className="w-20 h-20 rounded-2xl bg-white border border-border flex items-center justify-center mb-4">
                <Server className="w-10 h-10 text-text-tertiary" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary mb-2">暂无远程主机</h3>
              <p className="text-sm text-text-secondary mb-6 text-center max-w-xs">
                添加您的第一台远程主机，开始管理 SSH 连接
              </p>
              <button
                onClick={handleOpenCreate}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors active:scale-[0.98]"
              >
                <Plus className="w-4 h-4" />
                添加主机
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {hosts.map((host) => (
                <div
                  key={host.id}
                  className="bg-white border border-border rounded-xl p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-accent-bg flex items-center justify-center flex-shrink-0">
                        <Monitor className="w-5 h-5 text-accent" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-text-primary text-sm truncate">{host.name}</h3>
                        <div className="flex items-center gap-1 text-xs text-text-tertiary">
                          <Globe className="w-3 h-3" />
                          <span className="truncate">{host.host}:{host.port}</span>
                        </div>
                      </div>
                    </div>
                    <div className={cn(
                      'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0',
                      getStatusColor(host.status)
                    )}>
                      {getStatusIcon(host.status)}
                      {getStatusText(host.status)}
                    </div>
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                      <Tag className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                      <span className="truncate">{host.username}</span>
                    </div>
                    {host.description && (
                      <p className="text-xs text-text-tertiary line-clamp-2">{host.description}</p>
                    )}
                  </div>

                  {host.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-4">
                      {host.tags.slice(0, 3).map((tag, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 text-[10px] bg-bg-secondary text-text-secondary rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                      {host.tags.length > 3 && (
                        <span className="px-2 py-0.5 text-[10px] bg-bg-secondary text-text-tertiary rounded-full">
                          +{host.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 pt-3 border-t border-border">
                    <button
                      onClick={() => handleTestConnection(host.id)}
                      disabled={testingId === host.id}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-md transition-colors disabled:opacity-50"
                      title="连接测试"
                    >
                      {testingId === host.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : testResult?.id === host.id ? (
                        testResult.success ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <X className="w-3.5 h-3.5 text-red-500" />
                        )
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span className="hidden sm:inline">测试</span>
                    </button>

                    <button
                      onClick={() => handleToggleConnect(host)}
                      disabled={host.status === 'connecting'}
                      className={cn(
                        'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-md transition-colors disabled:opacity-50',
                        host.status === 'online'
                          ? 'text-red-500 hover:bg-red-50'
                          : 'text-emerald-600 hover:bg-emerald-50'
                      )}
                      title={host.status === 'online' ? '断开连接' : '连接'}
                    >
                      {host.status === 'online' ? (
                        <>
                          <PowerOff className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">断开</span>
                        </>
                      ) : host.status === 'connecting' ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span className="hidden sm:inline">连接中</span>
                        </>
                      ) : (
                        <>
                          <Power className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">连接</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => handleOpenEdit(host)}
                      className="flex items-center justify-center p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-secondary rounded-md transition-colors"
                      title="编辑"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleDelete(host.id)}
                      className="flex items-center justify-center p-1.5 text-text-tertiary hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {drawerMode && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={handleCloseDrawer} />
          <div className="relative w-full md:w-[480px] bg-white h-full flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                {drawerMode === 'create' ? (
                  <Plus className="w-4 h-4 text-accent" />
                ) : (
                  <Edit3 className="w-4 h-4 text-accent" />
                )}
                <h3 className="font-semibold text-text-primary">
                  {drawerMode === 'create' ? '添加主机' : '编辑主机'}
                </h3>
              </div>
              <button
                onClick={handleCloseDrawer}
                className="p-1.5 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">
                  主机名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例如：生产服务器"
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-text-primary mb-1.5">
                    主机地址 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    placeholder="IP 或域名"
                    className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-text-primary mb-1.5">端口</label>
                  <input
                    type="number"
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 22 })}
                    className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">
                  用户名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="例如：root"
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">认证方式</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setForm({ ...form, authType: 'password' })}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md border transition-colors',
                      form.authType === 'password'
                        ? 'border-accent bg-accent-bg text-accent'
                        : 'border-border text-text-secondary hover:bg-bg-secondary'
                    )}
                  >
                    <Key className="w-4 h-4" />
                    密码
                  </button>
                  <button
                    onClick={() => setForm({ ...form, authType: 'privateKey' })}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md border transition-colors',
                      form.authType === 'privateKey'
                        ? 'border-accent bg-accent-bg text-accent'
                        : 'border-border text-text-secondary hover:bg-bg-secondary'
                    )}
                  >
                    <Terminal className="w-4 h-4" />
                    私钥
                  </button>
                </div>
              </div>

              {form.authType === 'password' ? (
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1.5">密码</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="输入 SSH 密码"
                    className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1.5">私钥内容</label>
                  {getSecurityWarning() && (
                    <div className="mb-2 flex items-start gap-2 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                      <ShieldAlert className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <span>{getSecurityWarning()}</span>
                    </div>
                  )}
                  <textarea
                    value={form.privateKey}
                    onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
                    placeholder="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
                    rows={6}
                    className="w-full px-3 py-2 text-sm font-mono border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none"
                  />
                  <p className="mt-1 text-xs text-text-tertiary">私钥将通过 AES-GCM 加密后传输，不会以明文发送到后端。</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">描述</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="可选的描述信息"
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">标签</label>
                <input
                  type="text"
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="多个标签用逗号分隔，如：生产, 数据库, Linux"
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm font-medium text-text-primary">启用</div>
                  <div className="text-xs text-text-tertiary">关闭后将无法连接此主机</div>
                </div>
                <button
                  onClick={() => setForm({ ...form, enabled: !form.enabled })}
                  className={cn(
                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                    form.enabled ? 'bg-accent' : 'bg-gray-300'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow-sm',
                      form.enabled ? 'translate-x-5' : 'translate-x-0.5'
                    )}
                  />
                </button>
              </div>
            </div>

            <div className="p-4 border-t border-border flex gap-2 flex-shrink-0">
              {drawerMode === 'edit' && editingHost && (
                <button
                  onClick={() => handleDelete(editingHost.id)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm text-red-500 hover:bg-red-50 rounded-md transition-colors active:scale-[0.98]"
                >
                  <Trash2 className="w-4 h-4" />
                  删除
                </button>
              )}
              <button
                onClick={handleSubmit}
                disabled={!isFormValid}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium rounded-md transition-colors active:scale-[0.98]',
                  isFormValid
                    ? 'text-white bg-accent hover:bg-accent-hover'
                    : 'bg-bg-tertiary text-text-tertiary cursor-not-allowed'
                )}
              >
                <Check className="w-4 h-4" />
                {drawerMode === 'create' ? '添加主机' : '保存修改'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
