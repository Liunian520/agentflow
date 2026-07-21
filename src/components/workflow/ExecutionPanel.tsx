import { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  Square,
  StepForward,
  RefreshCw,
  Terminal,
  Database,
  Clock,
  CheckCircle,
  AlertCircle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  FileJson,
  Hash,
  ToggleLeft,
  Type,
  Layers,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useStore } from '../../store/useStore';
import type { ExecutionLog, ExecutionState } from '../../types';

const logLevelColors: Record<string, { bg: string; text: string; border: string }> = {
  info: { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' },
  warn: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200' },
  error: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' },
  success: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' },
};

const statusConfig: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  idle: { label: '空闲', icon: Clock, color: 'text-text-tertiary', bg: 'bg-bg-secondary' },
  running: { label: '运行中', icon: Loader2, color: 'text-accent', bg: 'bg-accent/10' },
  completed: { label: '已完成', icon: CheckCircle, color: 'text-emerald-500', bg: 'bg-emerald-50' },
  failed: { label: '失败', icon: XCircle, color: 'text-red-500', bg: 'bg-red-50' },
  paused: { label: '已暂停', icon: Pause, color: 'text-amber-500', bg: 'bg-amber-50' },
};

const variableTypeConfig: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  string: { icon: Type, color: 'text-blue-600', bg: 'bg-blue-100', label: 'string' },
  number: { icon: Hash, color: 'text-purple-600', bg: 'bg-purple-100', label: 'number' },
  boolean: { icon: ToggleLeft, color: 'text-amber-600', bg: 'bg-amber-100', label: 'boolean' },
  object: { icon: Layers, color: 'text-pink-600', bg: 'bg-pink-100', label: 'object' },
  array: { icon: FileJson, color: 'text-cyan-600', bg: 'bg-cyan-100', label: 'array' },
  undefined: { icon: FileJson, color: 'text-gray-500', bg: 'bg-gray-100', label: 'undefined' },
};

function getVariableType(value: any): string {
  if (value === null || value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function formatDuration(startTime: string | null, endTime: string | null, isRunning: boolean): string {
  if (!startTime) return '00:00:00';
  const end = endTime ? new Date(endTime) : isRunning ? new Date() : null;
  if (!end) return '00:00:00';
  const diff = end.getTime() - new Date(startTime).getTime();
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function JsonDisplay({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(true);

  const renderValue = (value: any, depth: number = 0) => {
    if (value === null) {
      return <span className="text-gray-400">null</span>;
    }

    if (typeof value === 'string') {
      return <span className="text-emerald-600">"{value}"</span>;
    }

    if (typeof value === 'number') {
      return <span className="text-blue-600">{value}</span>;
    }

    if (typeof value === 'boolean') {
      return <span className="text-amber-600">{value.toString()}</span>;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return <span className="text-text-tertiary">[]</span>;
      }
      return (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-text-tertiary hover:text-text-secondary transition-colors"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <span className="text-text-tertiary">Array({value.length})</span>
          </button>
          {expanded && (
            <div className="ml-4 border-l border-border pl-2 mt-1 space-y-0.5">
              {value.map((item, index) => (
                <div key={index} className="flex gap-2">
                  <span className="text-text-tertiary font-mono text-xs">{index}:</span>
                  {renderValue(item, depth + 1)}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        return <span className="text-text-tertiary">{'{}'}</span>;
      }
      return (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-text-tertiary hover:text-text-secondary transition-colors"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <span className="text-text-tertiary">Object({keys.length})</span>
          </button>
          {expanded && (
            <div className="ml-4 border-l border-border pl-2 mt-1 space-y-0.5">
              {keys.map((key) => (
                <div key={key} className="flex gap-2">
                  <span className="text-pink-600 font-mono text-xs">{key}:</span>
                  {renderValue(value[key], depth + 1)}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    return <span className="text-text-secondary">{String(value)}</span>;
  };

  return (
    <div className="font-mono text-xs">
      {renderValue(data)}
    </div>
  );
}

function LogItem({ log }: { log: ExecutionLog }) {
  const [expanded, setExpanded] = useState(false);
  const levelConfig = logLevelColors[log.level] || logLevelColors.info;
  const hasData = log.data !== undefined && log.data !== null;

  return (
    <div className={cn(
      'border-l-2 pl-3 py-2',
      levelConfig.border,
      hasData ? 'cursor-pointer hover:bg-bg-hover/50' : ''
    )}
      onClick={() => hasData && setExpanded(!expanded)}
    >
      <div className="flex items-start gap-2">
        <span className="text-xs text-text-tertiary font-mono flex-shrink-0 mt-0.5">
          {formatTime(log.timestamp)}
        </span>
        <span className={cn(
          'text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5 uppercase',
          levelConfig.bg,
          levelConfig.text
        )}>
          {log.level}
        </span>
        <span className={cn('text-sm flex-1', levelConfig.text)}>
          {log.message}
        </span>
        {hasData && (
          <button className="text-text-tertiary hover:text-text-secondary transition-colors flex-shrink-0">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      {log.nodeName && (
        <div className="mt-1 ml-14 text-xs text-text-tertiary">
          节点: {log.nodeName}
        </div>
      )}
      {hasData && expanded && (
        <div className="mt-2 ml-14 p-2 bg-bg-secondary rounded-md">
          <div className="text-xs font-medium text-text-tertiary mb-1">数据详情</div>
          <JsonDisplay data={log.data} />
        </div>
      )}
    </div>
  );
}

function VariableItem({ name, value }: { name: string; value: any }) {
  const [expanded, setExpanded] = useState(false);
  const type = getVariableType(value);
  const typeConfig = variableTypeConfig[type] || variableTypeConfig.undefined;
  const TypeIcon = typeConfig.icon;
  const isExpandable = type === 'object' || type === 'array';

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-white">
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2.5',
          isExpandable ? 'cursor-pointer hover:bg-bg-hover/50' : '',
          'bg-bg-secondary/50'
        )}
        onClick={() => isExpandable && setExpanded(!expanded)}
      >
        {isExpandable ? (
          expanded ? (
            <ChevronDown className="w-4 h-4 text-text-tertiary flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-tertiary flex-shrink-0" />
          )
        ) : (
          <div className="w-4 h-4 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary truncate font-mono">
            {name}
          </div>
        </div>
        <span className={cn(
          'text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-1 flex-shrink-0',
          typeConfig.bg,
          typeConfig.color
        )}>
          <TypeIcon className="w-3 h-3" />
          {typeConfig.label}
        </span>
      </div>

      {isExpandable ? (
        expanded && (
          <div className="p-3 border-t border-border bg-white">
            <JsonDisplay data={value} />
          </div>
        )
      ) : (
        <div className="px-3 py-2 border-t border-border bg-white">
          <div className="text-sm font-mono text-text-secondary break-all">
            {type === 'string' && `"${value}"`}
            {type === 'number' && value}
            {type === 'boolean' && value.toString()}
            {type === 'undefined' && <span className="text-text-tertiary">undefined</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function ExecutionPanel() {
  const [activeTab, setActiveTab] = useState<'logs' | 'variables'>('logs');
  const [duration, setDuration] = useState('00:00:00');
  const logsEndRef = useRef<HTMLDivElement>(null);

  const executionState = useStore((state) => (state as any).executionState as ExecutionState) || {
    isRunning: false,
    currentNodeId: null,
    completedNodeIds: [],
    variables: {},
    logs: [],
    startTime: null,
    endTime: null,
    status: 'idle' as const,
  };

  const startExecution = useStore((state) => (state as any).startExecution || (() => {}));
  const pauseExecution = useStore((state) => (state as any).pauseExecution || (() => {}));
  const resumeExecution = useStore((state) => (state as any).resumeExecution || (() => {}));
  const stopExecution = useStore((state) => (state as any).stopExecution || (() => {}));
  const stepExecution = useStore((state) => (state as any).stepExecution || (() => {}));

  const status = executionState?.status || 'idle';
  const StatusIcon = statusConfig[status]?.icon || Clock;
  const statusInfo = statusConfig[status] || statusConfig.idle;
  const logs = executionState?.logs || [];
  const variables = executionState?.variables || {};

  useEffect(() => {
    const updateDuration = () => {
      setDuration(formatDuration(executionState?.startTime || null, executionState?.endTime || null, executionState?.isRunning || false));
    };

    updateDuration();
    let interval: ReturnType<typeof setInterval> | null = null;

    if (executionState?.isRunning) {
      interval = setInterval(updateDuration, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [executionState?.startTime, executionState?.endTime, executionState?.isRunning]);

  useEffect(() => {
    if (activeTab === 'logs' && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs.length, activeTab]);

  const sortedVariableNames = Object.keys(variables).sort((a, b) => a.localeCompare(b));

  const tabs = [
    { id: 'logs', label: '日志', icon: Terminal, count: logs.length },
    { id: 'variables', label: '变量', icon: Database, count: sortedVariableNames.length },
  ];

  const canStart = status === 'idle' || status === 'completed' || status === 'failed';
  const canPause = status === 'running';
  const canResume = status === 'paused';
  const canStop = status === 'running' || status === 'paused';
  const canStep = status === 'paused' || status === 'idle';

  const handleStart = () => {
    if (canStart) {
      startExecution();
    } else if (canResume) {
      resumeExecution();
    }
  };

  return (
    <div className="w-full bg-white border-t border-border flex flex-col" style={{ height: '320px' }}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0 bg-bg-secondary/30">
        <div className="flex items-center gap-3">
          <div className={cn(
            'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium',
            statusInfo.bg,
            statusInfo.color
          )}>
            <StatusIcon className={cn('w-3.5 h-3.5', status === 'running' && 'animate-spin')} />
            {statusInfo.label}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <Clock className="w-3.5 h-3.5" />
            <span className="font-mono">{duration}</span>
          </div>
          {executionState?.completedNodeIds && executionState.completedNodeIds.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-text-tertiary">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
              <span>已完成 {executionState.completedNodeIds.length} 个节点</span>
            </div>
          )}
          {executionState?.error && (
            <div className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="w-3.5 h-3.5" />
              <span className="truncate max-w-[200px]">{executionState.error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleStart}
            disabled={!canStart && !canResume}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              canStart || canResume
                ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                : 'bg-bg-secondary text-text-tertiary cursor-not-allowed'
            )}
          >
            <Play className="w-3.5 h-3.5" />
            {canResume ? '继续' : '开始'}
          </button>

          <button
            onClick={pauseExecution}
            disabled={!canPause}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              canPause
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-bg-secondary text-text-tertiary cursor-not-allowed'
            )}
          >
            <Pause className="w-3.5 h-3.5" />
            暂停
          </button>

          <button
            onClick={stepExecution}
            disabled={!canStep}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              canStep
                ? 'bg-blue-500 hover:bg-blue-600 text-white'
                : 'bg-bg-secondary text-text-tertiary cursor-not-allowed'
            )}
          >
            <StepForward className="w-3.5 h-3.5" />
            单步
          </button>

          <button
            onClick={stopExecution}
            disabled={!canStop}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              canStop
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-bg-secondary text-text-tertiary cursor-not-allowed'
            )}
          >
            <Square className="w-3.5 h-3.5" />
            停止
          </button>

          <div className="w-px h-5 bg-border mx-1" />

          <button
            onClick={startExecution}
            disabled={status === 'running'}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md transition-colors',
              status !== 'running'
                ? 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                : 'text-text-tertiary cursor-not-allowed'
            )}
            title="重新运行"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', status === 'running' && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="flex border-b border-border flex-shrink-0">
        {tabs.map((tab) => {
          const TabIcon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-accent text-accent bg-accent/5'
                  : 'border-transparent text-text-tertiary hover:text-text-secondary hover:bg-bg-hover/30'
              )}
            >
              <TabIcon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.count > 0 && (
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full font-mono',
                  activeTab === tab.id ? 'bg-accent/20 text-accent' : 'bg-bg-secondary text-text-tertiary'
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === 'logs' && (
          <div className="h-full overflow-y-auto p-2 space-y-1">
            {logs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-8">
                <div className="w-12 h-12 rounded-full bg-bg-secondary flex items-center justify-center mb-3">
                  <Terminal className="w-6 h-6 text-text-tertiary" />
                </div>
                <p className="text-sm text-text-secondary mb-1">暂无执行日志</p>
                <p className="text-xs text-text-tertiary">点击"开始"运行工作流</p>
              </div>
            ) : (
              <>
                {logs.map((log) => (
                  <LogItem key={log.id} log={log} />
                ))}
                <div ref={logsEndRef} />
              </>
            )}
          </div>
        )}

        {activeTab === 'variables' && (
          <div className="h-full overflow-y-auto p-3 space-y-2">
            {sortedVariableNames.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-8">
                <div className="w-12 h-12 rounded-full bg-bg-secondary flex items-center justify-center mb-3">
                  <Database className="w-6 h-6 text-text-tertiary" />
                </div>
                <p className="text-sm text-text-secondary mb-1">暂无变量</p>
                <p className="text-xs text-text-tertiary">运行工作流后变量将显示在这里</p>
              </div>
            ) : (
              sortedVariableNames.map((name) => (
                <VariableItem key={name} name={name} value={variables[name]} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
