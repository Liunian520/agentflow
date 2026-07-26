import { useState, useEffect, useCallback } from 'react';
import { Brain, ChevronDown, ChevronRight, RefreshCw, Trash2 } from 'lucide-react';
import { memoryApi } from '../../api/memoryApi';
import { cn } from '../../lib/utils';

interface FactualMemory {
  id: string;
  type: string;
  content: string;
  tags?: string[];
  keywords?: string[];
  importance?: number;
  createdAt?: string;
  updatedAt?: string;
}

const typeLabel: Record<string, string> = {
  user: '用户偏好',
  feedback: '反馈纠正',
  project: '项目约定',
  reference: '参考资料',
  // 兼容旧数据
  task: '任务',
  workflow: '工作流',
  fact: '事实',
  decision: '决策',
  error: '纠错',
};

const typeColor: Record<string, string> = {
  user: 'bg-violet-100 text-violet-700',
  feedback: 'bg-red-100 text-red-700',
  project: 'bg-emerald-100 text-emerald-700',
  reference: 'bg-amber-100 text-amber-700',
  // 兼容旧数据
  task: 'bg-blue-100 text-blue-700',
  workflow: 'bg-emerald-100 text-emerald-700',
  fact: 'bg-amber-100 text-amber-700',
  decision: 'bg-pink-100 text-pink-700',
  error: 'bg-red-100 text-red-700',
};

export function MemoryPanel() {
  const [memories, setMemories] = useState<FactualMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await memoryApi.getFactualMemories();
      const list = Array.isArray(data) ? data : [];
      setMemories(list);
    } catch (err: any) {
      // 后端不可用时静默降级，不阻塞侧边栏
      setError(err?.message || '加载失败');
      setMemories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMemories();
    // 监听记忆更新事件（memory_save 工具执行、自动提取完成后触发）
    const refresh = () => loadMemories();
    window.addEventListener('lnagent:memory-updated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('lnagent:memory-updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [loadMemories]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await fetch(`${import.meta.env.VITE_API_BASE || ''}/memory/factual/${id}`, { method: 'DELETE' });
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch {
      // 静默失败
    }
  };

  const recentMemories = memories.slice(0, 8);

  return (
    <div className="mt-4 px-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between mb-2 group"
      >
        <div className="flex items-center gap-1.5">
          <Brain className="w-3.5 h-3.5 text-violet-500" />
          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
            记忆
          </span>
          {memories.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 text-violet-700 rounded-full">
              {memories.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span
            onClick={(e) => { e.stopPropagation(); loadMemories(); }}
            className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
            title="刷新"
          >
            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
          </span>
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {error && (
            <div className="text-[11px] text-text-tertiary px-2 py-1.5 bg-bg-secondary rounded">
              {error}
            </div>
          )}
          {!error && !loading && recentMemories.length === 0 && (
            <div className="text-[11px] text-text-tertiary px-2 py-1.5">
              暂无记忆。对话中表达的偏好和决策会自动保存到这里。
            </div>
          )}
          {recentMemories.map((m) => {
            const isOpen = expandedId === m.id;
            const label = typeLabel[m.type] || m.type;
            const color = typeColor[m.type] || 'bg-slate-100 text-slate-700';
            return (
              <div
                key={m.id}
                className="rounded-md border border-border bg-white hover:border-violet-200 transition-colors"
              >
                <button
                  onClick={() => setExpandedId(isOpen ? null : m.id)}
                  className="w-full flex items-start gap-1.5 px-2 py-1.5 text-left"
                >
                  <span className={cn('px-1 py-0.5 text-[10px] rounded shrink-0 mt-0.5', color)}>
                    {label}
                  </span>
                  <span className="flex-1 text-[11px] text-text-secondary leading-snug line-clamp-2">
                    {m.content}
                  </span>
                  <Trash2
                    onClick={(e) => handleDelete(e, m.id)}
                    className="w-3 h-3 text-text-tertiary hover:text-red-500 shrink-0 mt-0.5"
                  />
                </button>
                {isOpen && (
                  <div className="px-2 pb-2 pt-0.5 space-y-1">
                    <p className="text-[11px] text-text-primary whitespace-pre-wrap leading-relaxed">
                      {m.content}
                    </p>
                    {m.tags && m.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {m.tags.map((t, i) => (
                          <span key={i} className="px-1 py-0.5 text-[10px] bg-bg-secondary text-text-tertiary rounded">
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.createdAt && (
                      <p className="text-[10px] text-text-tertiary">
                        {new Date(m.createdAt).toLocaleString('zh-CN')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {memories.length > 8 && (
            <div className="text-[10px] text-text-tertiary text-center py-1">
              共 {memories.length} 条，显示最近 8 条
            </div>
          )}
        </div>
      )}
    </div>
  );
}
