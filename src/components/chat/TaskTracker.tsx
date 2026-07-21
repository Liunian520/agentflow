/**
 * 任务分解与进度展示 — 对标 Codex todo list
 * 多步操作时分解为子任务并实时展示进度
 */

import { CheckCircle2, Circle, Loader2, XCircle, SkipForward } from 'lucide-react';
import type { TaskStep } from '../../types';
import { cn } from '../../lib/utils';

interface TaskTrackerProps {
  steps: TaskStep[];
  className?: string;
}

const statusIcons: Record<TaskStep['status'], React.ReactNode> = {
  pending: <Circle className="w-4 h-4 text-text-tertiary" />,
  running: <Loader2 className="w-4 h-4 text-accent animate-spin" />,
  completed: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  failed: <XCircle className="w-4 h-4 text-red-500" />,
  skipped: <SkipForward className="w-4 h-4 text-text-tertiary" />,
};

export function TaskTracker({ steps, className }: TaskTrackerProps) {
  const completedCount = steps.filter(s => s.status === 'completed').length;
  const totalCount = steps.length;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className={cn('bg-white border border-border rounded-xl p-4', className)}>
      {/* 进度条 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">任务进度</span>
          <span className="text-xs text-text-tertiary">{completedCount}/{totalCount} 完成</span>
        </div>
        <span className="text-xs font-medium text-accent">{Math.round(progressPercent)}%</span>
      </div>
      <div className="w-full h-1.5 bg-bg-secondary rounded-full mb-3 overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* 步骤列表 */}
      <div className="space-y-2">
        {steps.map((step) => (
          <div
            key={step.id}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all',
              step.status === 'running' && 'bg-accent-bg border border-accent/20',
              step.status === 'completed' && 'bg-emerald-50/50',
              step.status === 'failed' && 'bg-red-50/50',
            )}
          >
            <div className="flex-shrink-0">{statusIcons[step.status]}</div>
            <div className="flex-1 min-w-0">
              <div className={cn(
                'text-sm font-medium',
                step.status === 'completed' ? 'text-emerald-600' :
                step.status === 'running' ? 'text-accent' :
                step.status === 'failed' ? 'text-red-600' :
                'text-text-secondary'
              )}>
                {step.label}
              </div>
              {step.detail && (
                <div className="text-xs text-text-tertiary mt-0.5">{step.detail}</div>
              )}
            </div>
            {step.duration && step.status === 'completed' && (
              <span className="text-xs text-text-tertiary">{step.duration}ms</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 根据操作类型生成任务步骤
 */
export function generateTaskSteps(action: string, params: Record<string, any>): TaskStep[] {
  switch (action) {
    case 'create_agent':
      return [
        { id: '1', label: '解析 Agent 配置', status: 'pending', detail: `名称: ${params.name || '新助手'}, 模型: ${params.model || 'GPT-4o'}` },
        { id: '2', label: '创建 Agent 对象', status: 'pending' },
        { id: '3', label: '配置工具和参数', status: 'pending', detail: `工具: ${params.tools?.join(', ') || '无'}` },
        { id: '4', label: '保存到系统', status: 'pending' },
      ];
    case 'create_workflow':
      return [
        { id: '1', label: '解析流程描述', status: 'pending', detail: `名称: ${params.name || '新工作流'}` },
        { id: '2', label: '创建工作流骨架', status: 'pending' },
        { id: '3', label: '添加节点', status: 'pending', detail: `${params.nodeSequence?.length || 0} 个节点` },
        { id: '4', label: '连接节点', status: 'pending' },
        { id: '5', label: '保存工作流', status: 'pending' },
      ];
    case 'run_workflow':
      return [
        { id: '1', label: '加载工作流', status: 'pending' },
        { id: '2', label: '初始化执行环境', status: 'pending' },
        { id: '3', label: '执行节点步骤', status: 'pending' },
        { id: '4', label: '收集执行结果', status: 'pending' },
      ];
    case 'debug':
      return [
        { id: '1', label: '诊断问题', status: 'pending', detail: '分析错误日志和系统状态' },
        { id: '2', label: '定位根因', status: 'pending' },
        { id: '3', label: '生成修复方案', status: 'pending' },
        { id: '4', label: '验证修复结果', status: 'pending' },
      ];
    default:
      return [
        { id: '1', label: '处理请求', status: 'pending' },
        { id: '2', label: '生成响应', status: 'pending' },
      ];
  }
}
