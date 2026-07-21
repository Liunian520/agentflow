import { useEffect, useState } from 'react';
import {
  Plus,
  Search,
  Play,
  Clock,
  Trash2,
  Edit,
  Copy,
  Filter,
  LayoutGrid,
  List,
  Zap,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { formatDate, formatNumber, cn } from '../lib/utils';

export function WorkflowsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { workflows, createWorkflow, deleteWorkflow, duplicateWorkflow } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      const name = `新工作流 ${workflows.length + 1}`;
      const id = createWorkflow(name);
      if (id) {
        // 移除 URL 参数，防止刷新重复创建
        navigate(`/workflow/${id}`, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredWorkflows = workflows.filter((wf) => {
    const matchesSearch =
      wf.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      wf.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || wf.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    draft: { label: '草稿', color: 'text-gray-600', bg: 'bg-gray-100' },
    published: { label: '已发布', color: 'text-emerald-600', bg: 'bg-emerald-100' },
    running: { label: '运行中', color: 'text-blue-600', bg: 'bg-blue-100' },
    paused: { label: '已暂停', color: 'text-amber-600', bg: 'bg-amber-100' },
  };

  const handleCreate = () => {
    const name = `新工作流 ${workflows.length + 1}`;
    const id = createWorkflow(name);
    if (id) {
      navigate(`/workflow/${id}`);
    }
  };

  const handleDelete = (id: string) => {
    deleteWorkflow(id);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="bg-white border-b border-border px-4 py-4 sm:px-6 sm:py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">工作流</h1>
            <p className="text-sm text-text-secondary">管理和创建你的自动化工作流</p>
          </div>
          <button
            onClick={handleCreate}
            className="flex items-center justify-center gap-2 px-4 h-11 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors active:scale-[0.98]"
          >
            <Plus className="w-5 h-5" />
            创建工作流
          </button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative w-full sm:flex-1 sm:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary" />
            <input
              type="text"
              placeholder="搜索工作流..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3 h-11 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-bg-secondary rounded-md p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={cn(
                  'h-9 w-9 flex items-center justify-center rounded transition-colors active:scale-[0.98]',
                  viewMode === 'grid'
                    ? 'bg-white text-text-primary shadow-sm'
                    : 'text-text-tertiary hover:text-text-secondary'
                )}
              >
                <LayoutGrid className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'h-9 w-9 flex items-center justify-center rounded transition-colors active:scale-[0.98]',
                  viewMode === 'list'
                    ? 'bg-white text-text-primary shadow-sm'
                    : 'text-text-tertiary hover:text-text-secondary'
                )}
              >
                <List className="w-5 h-5" />
              </button>
            </div>

            <div className="relative">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="appearance-none pl-10 pr-10 h-11 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
              >
                <option value="all">全部状态</option>
                <option value="draft">草稿</option>
                <option value="published">已发布</option>
                <option value="running">运行中</option>
                <option value="paused">已暂停</option>
              </select>
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6 bg-bg-secondary">
        {/* 移动端始终卡片视图 + 桌面端跟随 viewMode */}
        <div className="hidden sm:block">
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredWorkflows.map((wf) => {
                const status = statusConfig[wf.status];
                return (
                  <div
                    key={wf.id}
                    onClick={() => navigate(`/workflow/${wf.id}`)}
                    className="bg-white rounded-xl border border-border overflow-hidden hover:shadow-lg transition-all cursor-pointer group active:scale-[0.98]"
                  >
                    <div className="h-32 bg-gradient-to-br from-violet-50 to-blue-50 relative flex items-center justify-center">
                      <div className="w-16 h-16 rounded-2xl bg-white shadow-md flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Zap className="w-8 h-8 text-accent" />
                      </div>
                      <div className="absolute top-3 right-3">
                        <span className={cn('px-2 py-0.5 text-xs font-medium rounded-full', status.bg, status.color)}>
                          {status.label}
                        </span>
                      </div>
                    </div>
                    <div className="p-4">
                      <h3 className="font-medium text-text-primary mb-1 group-hover:text-accent transition-colors">
                        {wf.name}
                      </h3>
                      <p className="text-sm text-text-tertiary mb-3 line-clamp-2">
                        {wf.description}
                      </p>
                      <div className="flex items-center justify-between text-xs text-text-tertiary mb-3">
                        <span className="flex items-center gap-1">
                          <Play className="w-3 h-3" />
                          {formatNumber(wf.runs)} 次运行
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDate(wf.updatedAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 pt-3 border-t border-border">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/workflow/${wf.id}`);
                          }}
                          className="flex-1 h-9 flex items-center justify-center gap-1.5 text-sm text-text-secondary hover:text-accent hover:bg-accent/5 rounded-md transition-colors active:scale-[0.98]"
                        >
                          <Edit className="w-4 h-4" />
                          编辑
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            duplicateWorkflow(wf.id);
                          }}
                          className="flex-1 h-9 flex items-center justify-center gap-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-active rounded-md transition-colors active:scale-[0.98]"
                        >
                          <Copy className="w-4 h-4" />
                          复制
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteWorkflow(wf.id);
                          }}
                          className="flex-1 h-9 flex items-center justify-center gap-1.5 text-sm text-text-secondary hover:text-red-500 hover:bg-red-50 rounded-md transition-colors active:scale-[0.98]"
                        >
                          <Trash2 className="w-4 h-4" />
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead className="bg-bg-secondary border-b border-border">
                    <tr>
                      <th className="text-left text-xs font-medium text-text-tertiary uppercase tracking-wider px-4 py-3">
                        名称
                      </th>
                      <th className="text-left text-xs font-medium text-text-tertiary uppercase tracking-wider px-4 py-3">
                        状态
                      </th>
                      <th className="text-left text-xs font-medium text-text-tertiary uppercase tracking-wider px-4 py-3">
                        运行次数
                      </th>
                      <th className="text-left text-xs font-medium text-text-tertiary uppercase tracking-wider px-4 py-3">
                        更新时间
                      </th>
                      <th className="text-right text-xs font-medium text-text-tertiary uppercase tracking-wider px-4 py-3">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredWorkflows.map((wf) => {
                      const status = statusConfig[wf.status];
                      return (
                        <tr
                          key={wf.id}
                          className="hover:bg-bg-secondary cursor-pointer transition-colors"
                          onClick={() => navigate(`/workflow/${wf.id}`)}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium text-text-primary">{wf.name}</div>
                            <div className="text-sm text-text-tertiary truncate max-w-xs">
                              {wf.description}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn('px-2 py-0.5 text-xs font-medium rounded-full', status.bg, status.color)}>
                              {status.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-text-secondary">
                            {formatNumber(wf.runs)}
                          </td>
                          <td className="px-4 py-3 text-sm text-text-secondary">
                            {formatDate(wf.updatedAt)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/workflow/${wf.id}`);
                                }}
                                className="h-9 w-9 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-active rounded transition-colors active:scale-[0.98]"
                              >
                                <Edit className="w-5 h-5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  duplicateWorkflow(wf.id);
                                }}
                                className="h-9 w-9 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-active rounded transition-colors active:scale-[0.98]"
                                title="复制"
                              >
                                <Copy className="w-5 h-5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteWorkflow(wf.id);
                                }}
                                className="h-9 w-9 flex items-center justify-center text-text-tertiary hover:text-red-500 hover:bg-red-50 rounded transition-colors active:scale-[0.98]"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* 移动端卡片视图（始终显示） */}
        <div className="sm:hidden">
          <div className="flex flex-col gap-3">
            {filteredWorkflows.map((wf) => {
              const status = statusConfig[wf.status];
              return (
                <div
                  key={wf.id}
                  className="bg-white rounded-xl border border-border overflow-hidden active:scale-[0.98] transition-transform"
                >
                  <div
                    onClick={() => navigate(`/workflow/${wf.id}`)}
                    className="p-4 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-text-primary mb-1 truncate">
                          {wf.name}
                        </h3>
                        <p className="text-sm text-text-tertiary line-clamp-2">
                          {wf.description}
                        </p>
                      </div>
                      <span className={cn('shrink-0 px-2 py-0.5 text-xs font-medium rounded-full', status.bg, status.color)}>
                        {status.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-text-tertiary">
                      <span className="flex items-center gap-1">
                        <Play className="w-4 h-4" />
                        {formatNumber(wf.runs)} 次运行
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {formatDate(wf.updatedAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center border-t border-border">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/workflow/${wf.id}`);
                      }}
                      className="flex-1 h-12 flex items-center justify-center gap-1.5 text-sm text-text-secondary hover:text-accent hover:bg-accent/5 transition-colors active:scale-[0.98]"
                    >
                      <Edit className="w-5 h-5" />
                      编辑
                    </button>
                    <div className="w-px h-6 bg-border" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicateWorkflow(wf.id);
                      }}
                      className="flex-1 h-12 flex items-center justify-center gap-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-active transition-colors active:scale-[0.98]"
                    >
                      <Copy className="w-5 h-5" />
                      复制
                    </button>
                    <div className="w-px h-6 bg-border" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(wf.id);
                      }}
                      className="flex-1 h-12 flex items-center justify-center gap-1.5 text-sm text-text-secondary hover:text-red-500 hover:bg-red-50 transition-colors active:scale-[0.98]"
                    >
                      <Trash2 className="w-5 h-5" />
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {filteredWorkflows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 rounded-full bg-bg-secondary flex items-center justify-center mb-4">
              <Search className="w-8 h-8 text-text-tertiary" />
            </div>
            <h3 className="text-lg font-medium text-text-primary mb-1">没有找到工作流</h3>
            <p className="text-sm text-text-secondary mb-4">尝试调整搜索条件或创建新的工作流</p>
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 px-4 h-11 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors active:scale-[0.98]"
            >
              <Plus className="w-5 h-5" />
              创建工作流
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
