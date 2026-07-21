import { CheckCircle, XCircle, Clock, Terminal } from 'lucide-react';
import { cn } from '../../../lib/utils';

interface ExecutionResultProps {
  status: 'success' | 'failed' | 'running' | 'paused';
  logs: string[];
  variables?: Record<string, any>;
  duration?: string;
  className?: string;
}

export function ExecutionResult({ status, logs, variables, duration, className }: ExecutionResultProps) {
  const statusConfig = {
    success: { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', label: '执行成功' },
    failed: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', label: '执行失败' },
    running: { icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', label: '运行中' },
    paused: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', label: '暂停中' },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={cn(
      `${config.bg} border ${config.border} rounded-xl p-4 shadow-sm`,
      className
    )}>
      <div className="flex items-center gap-2 mb-3">
        <Icon className={cn('w-5 h-5', config.color)} />
        <span className={cn('font-medium text-sm', config.color)}>{config.label}</span>
        {duration && (
          <span className="text-xs text-text-tertiary ml-auto">耗时 {duration}</span>
        )}
      </div>

      {/* 执行日志 */}
      {logs.length > 0 && (
        <div className="bg-white/80 rounded-lg p-3 mb-2 max-h-32 overflow-y-auto">
          <div className="flex items-center gap-1.5 mb-2 text-xs text-text-tertiary">
            <Terminal className="w-3.5 h-3.5" />
            执行日志
          </div>
          <div className="space-y-1">
            {logs.slice(-5).map((log, idx) => (
              <div key={idx} className="text-xs text-text-secondary font-mono">{log}</div>
            ))}
          </div>
        </div>
      )}

      {/* 输出变量 */}
      {variables && Object.keys(variables).length > 0 && (
        <div className="bg-white/80 rounded-lg p-3">
          <div className="text-xs font-medium text-text-tertiary mb-1.5">输出变量</div>
          <div className="space-y-1">
            {Object.entries(variables).slice(0, 3).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-accent">{key}</span>
                <span className="text-text-tertiary">=</span>
                <span className="text-text-secondary font-mono truncate">{String(value).slice(0, 80)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
