/**
 * 模式选择器 — 对标 Kilo Code 多模式系统
 * Plan: 只分析不执行 | Code: 执行需确认 | Debug: 自动调试 | Orchestrator: 协调多任务
 */

import type { AgentMode, ModeConfig } from '../../types';
import { cn } from '../../lib/utils';

/**
 * 各模式的品牌色（用于激活态高亮，让切换按钮一目了然）
 */
export const MODE_ACTIVE_CLASS: Record<AgentMode, string> = {
  plan: 'bg-amber-500 text-white shadow-sm shadow-amber-200',
  code: 'bg-violet-500 text-white shadow-sm shadow-violet-200',
  debug: 'bg-red-500 text-white shadow-sm shadow-red-200',
  orchestrator: 'bg-blue-500 text-white shadow-sm shadow-blue-200',
  ask: 'bg-emerald-500 text-white shadow-sm shadow-emerald-200',
};

export const MODE_CONFIGS: ModeConfig[] = [
  {
    id: 'plan',
    label: '规划',
    description: '只分析和规划，不执行操作。适合先想清楚再动手。',
    icon: '💡',
    color: 'amber',
    behavior: 'analyze_only',
  },
  {
    id: 'code',
    label: '编码',
    description: '执行操作需确认后再落地。安全可靠，适合日常使用。',
    icon: '💻',
    color: 'violet',
    behavior: 'execute_with_approval',
  },
  {
    id: 'debug',
    label: '调试',
    description: '自动诊断问题并修复，聚焦排错和验证。',
    icon: '🔍',
    color: 'red',
    behavior: 'execute_auto',
  },
  {
    id: 'orchestrator',
    label: '编排',
    description: '协调多 Agent 和工作流并行执行，适合复杂任务。',
    icon: '🧩',
    color: 'blue',
    behavior: 'coordinate',
  },
  {
    id: 'ask',
    label: '问答',
    description: '纯问答，不执行、不规划任何操作。适合咨询、解释、讨论。',
    icon: '💬',
    color: 'emerald',
    behavior: 'analyze_only',
  },
];

interface ModeSelectorProps {
  activeMode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
}

export function ModeSelector({ activeMode, onModeChange }: ModeSelectorProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-bg-secondary rounded-xl">
      {MODE_CONFIGS.map((mode) => (
        <button
          key={mode.id}
          onClick={() => onModeChange(mode.id)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-[0.97]',
            activeMode === mode.id
              ? MODE_ACTIVE_CLASS[mode.id]
              : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover'
          )}
          title={mode.description}
          aria-pressed={activeMode === mode.id}
        >
          <span className="text-sm leading-none">{mode.icon}</span>
          <span>{mode.label}</span>
        </button>
      ))}
    </div>
  );
}

export function getModeConfig(mode: AgentMode): ModeConfig {
  return MODE_CONFIGS.find(m => m.id === mode) || MODE_CONFIGS[1];
}
