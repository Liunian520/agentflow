import { useState } from 'react';
import {
  Search,
  Play,
  Clock,
  Trash2,
  Zap,
  MessageSquare,
  Check,
  X,
  Pencil,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { formatDate, formatNumber } from '../lib/utils';

export function WorkflowsPage() {
  const navigate = useNavigate();
  const { workflows, deleteWorkflow, updateWorkflow } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const filteredWorkflows = workflows.filter((wf) =>
    wf.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    wf.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  };

  const confirmRename = async () => {
    if (renamingId && renameValue.trim()) {
      await updateWorkflow(renamingId, { name: renameValue.trim() });
    }
    setRenamingId(null);
    setRenameValue('');
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="bg-white border-b border-border px-4 py-4 sm:px-6 sm:py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">技能库</h1>
            <p className="text-sm text-text-secondary">
              Agent 在对话中自动生成的可复用流程，由 Agent 编排与执行
            </p>
          </div>
        </div>

        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary" />
          <input
            type="text"
            placeholder="搜索技能..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-3 h-11 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6 bg-bg-secondary">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredWorkflows.map((wf) => (
            <div
              key={wf.id}
              onClick={() => renamingId !== wf.id && navigate(`/workflow/${wf.id}`)}
              className="bg-white rounded-xl border border-border overflow-hidden hover:shadow-lg transition-all cursor-pointer group active:scale-[0.98]"
            >
              <div className="h-28 bg-gradient-to-br from-violet-50 to-blue-50 relative flex items-center justify-center">
                <div className="w-14 h-14 rounded-2xl bg-white shadow-md flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Zap className="w-7 h-7 text-accent" />
                </div>
              </div>
              <div className="p-4">
                {renamingId === wf.id ? (
                  <div className="flex items-center gap-1.5 mb-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmRename();
                        if (e.key === 'Escape') cancelRename();
                      }}
                      className="flex-1 min-w-0 px-2 py-1 text-sm font-medium border border-accent rounded focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <button
                      onClick={confirmRename}
                      className="p-1 text-accent hover:bg-accent/10 rounded transition-colors"
                      title="确认"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={cancelRename}
                      className="p-1 text-text-tertiary hover:bg-bg-hover rounded transition-colors"
                      title="取消"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <h3 className="font-medium text-text-primary mb-1 group-hover:text-accent transition-colors truncate">
                    {wf.name}
                  </h3>
                )}
                <p className="text-sm text-text-tertiary mb-3 line-clamp-2">
                  {wf.description || '由 Agent 自动生成'}
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
                      startRename(wf.id, wf.name);
                    }}
                    className="flex-1 h-9 flex items-center justify-center gap-1.5 text-sm text-text-secondary hover:text-accent hover:bg-accent/5 rounded-md transition-colors active:scale-[0.98]"
                  >
                    <Pencil className="w-4 h-4" />
                    重命名
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
          ))}
        </div>

        {filteredWorkflows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 rounded-full bg-bg-secondary flex items-center justify-center mb-4">
              <Zap className="w-8 h-8 text-text-tertiary" />
            </div>
            <h3 className="text-lg font-medium text-text-primary mb-1">还没有技能</h3>
            <p className="text-sm text-text-secondary mb-4 text-center max-w-sm">
              技能由 Agent 在对话中自动创建。当 Agent 判断某个任务需要多步骤编排时，会生成可复用的流程并保存在这里。
            </p>
            <button
              onClick={() => navigate('/workspace')}
              className="flex items-center gap-2 px-4 h-11 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors active:scale-[0.98]"
            >
              <MessageSquare className="w-5 h-5" />
              去对话让 Agent 创建
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
