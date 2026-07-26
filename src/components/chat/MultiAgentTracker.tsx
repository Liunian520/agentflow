import { useState } from 'react';
import { Bot, ChevronDown, ChevronUp, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { TaskStep } from '../../types';

interface MultiAgentTrackerProps {
  steps: TaskStep[];
  className?: string;
}

const statusConfig = {
  pending: { icon: <Clock className="w-3.5 h-3.5 text-slate-400" />, label: '等待中', color: 'text-slate-400' },
  running: { icon: <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />, label: '执行中', color: 'text-blue-600' },
  completed: { icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />, label: '已完成', color: 'text-emerald-600' },
  failed: { icon: <XCircle className="w-3.5 h-3.5 text-red-500" />, label: '失败', color: 'text-red-600' },
  skipped: { icon: <Clock className="w-3.5 h-3.5 text-slate-300" />, label: '已跳过', color: 'text-slate-300' },
};

export function MultiAgentTracker({ steps, className }: MultiAgentTrackerProps) {
  const [expanded, setExpanded] = useState(false);
  const runningCount = steps.filter((s) => s.status === 'running').length;
  const completedCount = steps.filter((s) => s.status === 'completed').length;

  if (steps.length === 0) return null;

  return (
    <div className={cn('rounded-xl border border-indigo-200 bg-indigo-50/60 overflow-hidden', className)}>
      {/* 头部 - 可点击展开 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-indigo-100/50 transition-colors"
      >
        <div className="relative">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
            <Bot className="w-4 h-4 text-indigo-600" />
          </div>
          {runningCount > 0 && (
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-indigo-50" />
          )}
        </div>
        <div className="flex-1 text-left">
          <div className="text-sm font-medium text-indigo-800">
            多 Agent 协作执行中
          </div>
          <div className="text-xs text-indigo-500">
            {completedCount}/{steps.length} 完成
            {runningCount > 0 && ` · ${runningCount} 个运行中`}
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-indigo-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-indigo-400" />
        )}
      </button>

      {/* 展开的详情列表 */}
      {expanded && (
        <div className="px-3.5 pb-3.5 space-y-1.5">
          {steps.map((step) => {
            const config = statusConfig[step.status];
            return (
              <div
                key={step.id}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                  step.status === 'running' ? 'bg-white/80 border border-indigo-100' : 'bg-white/40'
                )}
              >
                {config.icon}
                <span className="flex-1 text-slate-700">{step.label}</span>
                <span className={cn('text-xs font-medium', config.color)}>{config.label}</span>
                {step.detail && (
                  <span className="text-xs text-slate-400 max-w-[200px] truncate">{step.detail}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
