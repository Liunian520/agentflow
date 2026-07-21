/**
 * 模式选择器 — 对标 Kilo Code 多模式系统
 * Plan: 只分析不执行 | Code: 执行需确认 | Debug: 自动调试 | Orchestrator: 协调多任务
 */

import type { AgentMode, ModeConfig } from '../../types';
import { cn } from '../../lib/utils';

export const MODE_CONFIGS: ModeConfig[] = [
  {
    id: 'plan',
    label: '规划模式',
    description: '只分析和规划，不执行操作。适合先想清楚再动手。',
    icon: '💡',
    color: 'amber',
    behavior: 'analyze_only',
  },
  {
    id: 'code',
    label: '编码模式',
    description: '执行操作需确认后再落地。安全可靠，适合日常使用。',
    icon: '💻',
    color: 'violet',
    behavior: 'execute_with_approval',
  },
  {
    id: 'debug',
    label: '调试模式',
    description: '自动诊断问题并修复，聚焦排错和验证。',
    icon: '🔍',
    color: 'red',
    behavior: 'execute_auto',
  },
  {
    id: 'orchestrator',
    label: '编排模式',
    description: '协调多 Agent 和工作流并行执行，适合复杂任务。',
    icon: '🧩',
    color: 'blue',
    behavior: 'coordinate',
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
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-[0.98]',
            activeMode === mode.id
              ? `bg-white shadow-sm text-text-primary`
              : 'text-text-tertiary hover:text-text-secondary hover:bg-white/50'
          )}
          title={mode.description}
        >
          <span className="text-sm">{mode.icon}</span>
          <span>{mode.label}</span>
        </button>
      ))}
    </div>
  );
}

export function getModeConfig(mode: AgentMode): ModeConfig {
  return MODE_CONFIGS.find(m => m.id === mode) || MODE_CONFIGS[1];
}
