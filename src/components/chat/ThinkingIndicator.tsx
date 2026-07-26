/**
 * 思考过程展示 — 对标 Claude Code Extended Thinking
 * 透明展示 Agent 的推理步骤，而非仅显示"正在处理..."
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Brain, Sparkles } from 'lucide-react';
import type { ThinkingStep } from '../../types';
import { cn } from '../../lib/utils';

interface ThinkingIndicatorProps {
  steps: ThinkingStep[];
  isThinking: boolean;
  className?: string;
}

const phaseLabels: Record<ThinkingStep['phase'], { label: string; icon: string; color: string }> = {
  analyzing: { label: '分析中', icon: '🔍', color: 'amber' },
  planning: { label: '规划中', icon: '💡', color: 'violet' },
  executing: { label: '执行中', icon: '⚡', color: 'blue' },
  validating: { label: '验证中', icon: '✅', color: 'emerald' },
};

export function ThinkingIndicator({ steps, isThinking, className }: ThinkingIndicatorProps) {
  const [expanded, setExpanded] = useState(false);

  if (steps.length === 0 && !isThinking) return null;

  return (
    <div className={cn('bg-gradient-to-r from-violet-50 to-pink-50 border border-violet-100 rounded-xl', className)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        {isThinking ? (
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center animate-pulse">
            <Brain className="w-3 h-3 text-white" />
          </div>
        ) : (
          <Sparkles className="w-5 h-5 text-violet-500" />
        )}
        <span className="text-sm font-medium text-violet-700">
          {isThinking ? '正在思考...' : `思考过程 (${steps.length} 步)`}
        </span>
        {expanded ? <ChevronDown className="w-4 h-4 text-violet-400" /> : <ChevronRight className="w-4 h-4 text-violet-400" />}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1.5">
          {steps.map((step) => {
            const phase = phaseLabels[step.phase];
            return (
              <div key={step.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/60">
                <span className="text-sm">{phase.icon}</span>
                <span className={cn('text-xs font-medium', `text-${phase.color}-600`)}>
                  {phase.label}
                </span>
                <span className="text-sm text-text-secondary flex-1">{step.content}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 根据意图和模式生成思考步骤
 */
export function generateThinkingSteps(action: string, mode: string, params: Record<string, any>): ThinkingStep[] {
  const now = new Date().toISOString();
  const steps: ThinkingStep[] = [];

  if (mode === 'plan') {
    steps.push({ id: 't1', phase: 'analyzing', content: `理解用户意图: ${action}`, timestamp: now });
    steps.push({ id: 't2', phase: 'planning', content: '制定执行计划（仅规划，不执行）', timestamp: now });
    steps.push({ id: 't3', phase: 'validating', content: '验证计划可行性', timestamp: now });
  } else if (mode === 'debug') {
    steps.push({ id: 't1', phase: 'analyzing', content: '扫描系统状态和错误信息', timestamp: now });
    steps.push({ id: 't2', phase: 'planning', content: '推断可能的根因', timestamp: now });
    steps.push({ id: 't3', phase: 'executing', content: '应用修复方案', timestamp: now });
    steps.push({ id: 't4', phase: 'validating', content: '验证修复是否生效', timestamp: now });
  } else if (mode === 'orchestrator') {
    steps.push({ id: 't1', phase: 'analyzing', content: '评估任务复杂度', timestamp: now });
    steps.push({ id: 't2', phase: 'planning', content: '分解为子任务并分配给各 Agent', timestamp: now });
    steps.push({ id: 't3', phase: 'executing', content: '协调多 Agent 并行执行', timestamp: now });
    steps.push({ id: 't4', phase: 'validating', content: '合并结果并验证一致性', timestamp: now });
  } else {
    // code mode
    steps.push({ id: 't1', phase: 'analyzing', content: `解析操作类型: ${action}`, timestamp: now });
    if (action === 'create_agent') {
      steps.push({ id: 't2', phase: 'planning', content: `配置 Agent: ${params.name || '新助手'} (${params.model || 'GPT-4o'})`, timestamp: now });
    } else if (action === 'create_workflow') {
      steps.push({ id: 't2', phase: 'planning', content: `编排流程: ${params.name || '新工作流'}`, timestamp: now });
    } else {
      steps.push({ id: 't2', phase: 'planning', content: '准备执行方案', timestamp: now });
    }
    steps.push({ id: 't3', phase: 'executing', content: '等待用户确认后执行', timestamp: now });
  }

  return steps;
}
