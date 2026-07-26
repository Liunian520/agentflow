/**
 * 斜杠命令系统 — 对标 Claude Code 的 /review-pr /deploy-staging
 * 输入 / 时弹出命令列表，快速触发操作
 */

import { useState, useEffect, useRef } from 'react';
import type { SlashCommand } from '../../types';
import { cn } from '../../lib/utils';

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'create-agent', command: '/create-agent', label: '创建 Agent', description: '创建一个新的 AI Agent', mode: 'code', icon: '🤖' },
  { id: 'create-workflow', command: '/create-workflow', label: '创建工作流', description: '设计并创建一个工作流', mode: 'code', icon: '🔄' },
  { id: 'list', command: '/list', label: '查看列表', description: '列出 Agent 和工作流', icon: '📋' },
  { id: 'run', command: '/run', label: '运行工作流', description: '运行指定的工作流', mode: 'code', icon: '▶️' },
  { id: 'debug', command: '/debug', label: '调试诊断', description: '自动诊断和修复问题', mode: 'debug', icon: '🔍' },
  { id: 'status', command: '/status', label: '查看状态', description: '查看系统运行状态', icon: '📊' },
  { id: 'ssh', command: '/ssh', label: 'SSH 命令', description: '在远程主机执行命令', mode: 'code', icon: '🖥️' },
  { id: 'reflect', command: '/reflect', label: '反思进化', description: '基于失败经验进化 Meta-Skill', icon: '🧬' },
  { id: 'optimize', command: '/optimize', label: '多轨迹选优', description: '生成多候选方案并自动选优', mode: 'code', icon: '🔀' },
  { id: 'router', command: '/router', label: '路由仪表盘', description: '查看 ACRouter 自进化路由统计与趋势', icon: '📊' },
  { id: 'dream', command: '/dream', label: '记忆整合', description: '触发 Auto Dream 四阶段跨会话整合', icon: '🌙' },
  { id: 'extract', command: '/extract', label: '手动提取', description: '手动触发 Auto Extraction 从当轮对话提取事实', icon: '💡' },
  { id: 'memory', command: '/memory', label: '记忆统计', description: '查看四层记忆架构的统计信息', icon: '🧠' },
  { id: 'help', command: '/help', label: '帮助', description: '查看所有可用命令', icon: '❓' },
];

interface SlashCommandBarProps {
  inputValue: string;
  onSelect: (command: SlashCommand) => void;
  onClose?: () => void;
}

export function SlashCommandBar({ inputValue, onSelect }: SlashCommandBarProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const filteredRef = useRef<SlashCommand[]>([]);

  const query = inputValue.startsWith('/') ? inputValue.slice(1).toLowerCase() : '';
  const filtered = SLASH_COMMANDS.filter(cmd =>
    cmd.command.toLowerCase().includes(query) ||
    cmd.label.toLowerCase().includes(query) ||
    cmd.description.toLowerCase().includes(query)
  );
  filteredRef.current = filtered;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-white border border-border rounded-xl shadow-lg overflow-hidden z-50">
      <div className="p-2 border-b border-border bg-bg-secondary">
        <span className="text-xs text-text-tertiary">斜杠命令 — 快速操作</span>
      </div>
      <div className="max-h-48 overflow-y-auto py-1">
        {filtered.map((cmd, idx) => (
          <button
            key={cmd.id}
            onClick={() => onSelect(cmd)}
            onMouseEnter={() => setSelectedIndex(idx)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
              idx === selectedIndex ? 'bg-accent-bg' : 'hover:bg-bg-hover'
            )}
          >
            <span className="text-lg flex-shrink-0">{cmd.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text-primary">
                <span className="text-accent">{cmd.command}</span>
                <span className="ml-2 text-text-secondary">{cmd.label}</span>
              </div>
              <div className="text-xs text-text-tertiary truncate">{cmd.description}</div>
            </div>
            {cmd.mode && (
              <span className="px-2 py-0.5 text-xs bg-bg-secondary text-text-tertiary rounded-full">
                {cmd.mode}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export { SLASH_COMMANDS as slashCommands };
