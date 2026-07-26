import { useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  Loader2,
  Cpu,
  Brain,
  Wrench,
  Workflow,
  Filter,
  Clock,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { TraceSpan, TraceSpanType, TraceSpanStatus, TraceSummary } from '../../lib/workflowTracer';

const spanTypeConfig: Record<TraceSpanType, { label: string; icon: any; color: string; bg: string }> = {
  workflow: { label: '工作流', icon: Workflow, color: 'text-purple-600', bg: 'bg-purple-100' },
  node: { label: '节点', icon: Cpu, color: 'text-blue-600', bg: 'bg-blue-100' },
  tool: { label: '工具', icon: Wrench, color: 'text-amber-600', bg: 'bg-amber-100' },
  llm: { label: 'LLM', icon: Brain, color: 'text-emerald-600', bg: 'bg-emerald-100' },
};

const statusConfig: Record<TraceSpanStatus, { label: string; icon: any; color: string }> = {
  running: { label: '运行中', icon: Loader2, color: 'text-blue-500' },
  completed: { label: '已完成', icon: CheckCircle, color: 'text-emerald-500' },
  failed: { label: '失败', icon: XCircle, color: 'text-red-500' },
};

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
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

interface SpanItemProps {
  span: TraceSpan;
  depth: number;
  rootStartTime: number;
  totalDuration: number;
}

function SpanItem({ span, depth, rootStartTime, totalDuration }: SpanItemProps) {
  const [expanded, setExpanded] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  const typeConfig = spanTypeConfig[span.type];
  const statusInfo = statusConfig[span.status];
  const TypeIcon = typeConfig.icon;
  const StatusIcon = statusInfo.icon;

  const hasChildren = span.children && span.children.length > 0;
  const offset = span.startTime - rootStartTime;
  const widthPercent = totalDuration > 0 ? ((span.duration || 0) / totalDuration) * 100 : 0;
  const leftPercent = totalDuration > 0 ? (offset / totalDuration) * 100 : 0;

  return (
    <div className="border-b border-border/50 last:border-b-0">
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-2 hover:bg-bg-hover/50 cursor-pointer transition-colors',
          span.status === 'failed' && 'bg-red-50/50'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => setShowDetails(!showDetails)}
      >
        <div className="w-5 flex-shrink-0">
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="text-text-tertiary hover:text-text-secondary transition-colors"
            >
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          ) : (
            <div className="w-4 h-4" />
          )}
        </div>

        <div className={cn('p-1 rounded flex-shrink-0', typeConfig.bg)}>
          <TypeIcon className={cn('w-3.5 h-3.5', typeConfig.color)} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary truncate">{span.name}</span>
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0',
              typeConfig.bg,
              typeConfig.color
            )}>
              {typeConfig.label}
            </span>
          </div>

          <div className="relative h-4 mt-1 bg-bg-secondary rounded-full overflow-hidden">
            <div
              className={cn(
                'absolute top-0 left-0 h-full rounded-full',
                span.status === 'completed' && 'bg-emerald-400/60',
                span.status === 'running' && 'bg-blue-400/60',
                span.status === 'failed' && 'bg-red-400/60'
              )}
              style={{
                left: `${leftPercent}%`,
                width: `${Math.max(widthPercent, 1)}%`,
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <StatusIcon className={cn('w-4 h-4', statusInfo.color, span.status === 'running' && 'animate-spin')} />
          <span className="text-xs font-mono text-text-tertiary w-20 text-right">
            {formatDuration(span.duration)}
          </span>
        </div>
      </div>

      {showDetails && (
        <div className="px-4 pb-3 space-y-2" style={{ paddingLeft: `${depth * 16 + 28}px` }}>
          <div className="grid grid-cols-2 gap-2">
            {span.input !== undefined && (
              <div className="bg-bg-secondary rounded-md p-2">
                <div className="text-xs font-medium text-text-tertiary mb-1">输入</div>
                <JsonDisplay data={span.input} />
              </div>
            )}
            {span.output !== undefined && (
              <div className="bg-bg-secondary rounded-md p-2">
                <div className="text-xs font-medium text-text-tertiary mb-1">输出</div>
                <JsonDisplay data={span.output} />
              </div>
            )}
          </div>

          {span.error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-2">
              <div className="text-xs font-medium text-red-600 mb-1">错误</div>
              <div className="text-xs text-red-600 font-mono">{span.error}</div>
            </div>
          )}

          {Object.keys(span.metadata || {}).length > 0 && (
            <div className="bg-bg-secondary rounded-md p-2">
              <div className="text-xs font-medium text-text-tertiary mb-1">元数据</div>
              <JsonDisplay data={span.metadata} />
            </div>
          )}
        </div>
      )}

      {hasChildren && expanded && (
        <div>
          {span.children.map((child) => (
            <SpanItem
              key={child.id}
              span={child}
              depth={depth + 1}
              rootStartTime={rootStartTime}
              totalDuration={totalDuration}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: string | number;
  icon: any;
  color: string;
}

function SummaryCard({ label, value, icon: Icon, color }: SummaryCardProps) {
  return (
    <div className="bg-white border border-border rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn('w-4 h-4', color)} />
        <span className="text-xs text-text-tertiary">{label}</span>
      </div>
      <div className="text-xl font-semibold text-text-primary">{value}</div>
    </div>
  );
}

interface ExecutionTimelineProps {
  rootSpan: TraceSpan | null;
  summary: TraceSummary | null;
}

export function ExecutionTimeline({ rootSpan, summary }: ExecutionTimelineProps) {
  const [typeFilter, setTypeFilter] = useState<TraceSpanType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<TraceSpanStatus | 'all'>('all');

  const filteredSpans = useMemo(() => {
    if (!rootSpan) return [];

    const filterSpan = (span: TraceSpan): TraceSpan | null => {
      const typeMatch = typeFilter === 'all' || span.type === typeFilter;
      const statusMatch = statusFilter === 'all' || span.status === statusFilter;

      const filteredChildren = span.children
        .map(filterSpan)
        .filter((s): s is TraceSpan => s !== null);

      if (typeMatch && statusMatch) {
        return { ...span, children: filteredChildren };
      }

      if (filteredChildren.length > 0) {
        return { ...span, children: filteredChildren };
      }

      return null;
    };

    const filtered = filterSpan(rootSpan);
    return filtered ? [filtered] : [];
  }, [rootSpan, typeFilter, statusFilter]);

  const totalDuration = rootSpan?.duration ?? 1;
  const rootStartTime = rootSpan?.startTime ?? 0;

  if (!rootSpan || !summary) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center py-8">
        <div className="w-12 h-12 rounded-full bg-bg-secondary flex items-center justify-center mb-3">
          <Clock className="w-6 h-6 text-text-tertiary" />
        </div>
        <p className="text-sm text-text-secondary mb-1">暂无追踪数据</p>
        <p className="text-xs text-text-tertiary">运行工作流后将显示执行追踪</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border bg-bg-secondary/30 space-y-3">
        <div className="grid grid-cols-4 gap-2">
          <SummaryCard
            label="总耗时"
            value={formatDuration(summary.totalDuration)}
            icon={Clock}
            color="text-purple-600"
          />
          <SummaryCard
            label="节点数"
            value={`${summary.completedNodes}/${summary.totalNodes}`}
            icon={Cpu}
            color="text-blue-600"
          />
          <SummaryCard
            label="LLM 调用"
            value={summary.llmCallCount}
            icon={Brain}
            color="text-emerald-600"
          />
          <SummaryCard
            label="工具调用"
            value={summary.toolCallCount}
            icon={Wrench}
            color="text-amber-600"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-text-tertiary" />
            <span className="text-xs text-text-tertiary">类型:</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="text-xs border border-border rounded px-2 py-1 bg-white text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="all">全部</option>
              <option value="workflow">工作流</option>
              <option value="node">节点</option>
              <option value="tool">工具</option>
              <option value="llm">LLM</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-tertiary">状态:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="text-xs border border-border rounded px-2 py-1 bg-white text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="all">全部</option>
              <option value="running">运行中</option>
              <option value="completed">已完成</option>
              <option value="failed">失败</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredSpans.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-8">
            <Filter className="w-10 h-10 text-text-tertiary mb-2" />
            <p className="text-sm text-text-secondary">没有符合筛选条件的追踪项</p>
          </div>
        ) : (
          filteredSpans.map((span) => (
            <SpanItem
              key={span.id}
              span={span}
              depth={0}
              rootStartTime={rootStartTime}
              totalDuration={totalDuration}
            />
          ))
        )}
      </div>
    </div>
  );
}
