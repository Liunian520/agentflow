import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import * as Icons from 'lucide-react';
import { cn } from '../../lib/utils';
import { NODE_TYPE_DEFINITIONS } from '../../lib/nodeDefaults';
import type { NodeExecutionStatus } from '../../types';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Webhook: Icons.Webhook,
  Clock: Icons.Clock,
  Play: Icons.Play,
  Bot: Icons.Bot,
  Search: Icons.Search,
  Code2: Icons.Code2,
  PenTool: Icons.PenTool,
  Globe: Icons.Globe,
  Database: Icons.Database,
  FileText: Icons.FileText,
  Mail: Icons.Mail,
  GitBranch: Icons.GitBranch,
  RefreshCw: Icons.RefreshCw,
  Settings: Icons.Settings,
  Send: Icons.Send,
  Bell: Icons.Bell,
  Box: Icons.Box,
  Server: Icons.Server,
  Brain: Icons.Brain,
  Code: Icons.Code,
  User: Icons.User,
  BookOpen: Icons.BookOpen,
  Layers: Icons.Layers,
  Variable: Icons.Variable,
  StopCircle: Icons.StopCircle,
  Repeat: Icons.Repeat,
  UserCheck: Icons.UserCheck,
  Wrench: Icons.Wrench,
  Network: Icons.Network,
  Save: Icons.Save,
};

function getNodeStyles(type: string) {
  const styles: Record<string, { borderColor: string; bgColor: string; iconBg: string; textColor: string }> = {
    start: {
      borderColor: 'border-emerald-500',
      bgColor: 'bg-emerald-50',
      iconBg: 'bg-emerald-500',
      textColor: 'text-emerald-700',
    },
    end: {
      borderColor: 'border-red-500',
      bgColor: 'bg-red-50',
      iconBg: 'bg-red-500',
      textColor: 'text-red-700',
    },
    llm: {
      borderColor: 'border-blue-500',
      bgColor: 'bg-blue-50',
      iconBg: 'bg-blue-500',
      textColor: 'text-blue-700',
    },
    agent: {
      borderColor: 'border-violet-500',
      bgColor: 'bg-violet-50',
      iconBg: 'bg-violet-500',
      textColor: 'text-violet-700',
    },
    tool: {
      borderColor: 'border-amber-500',
      bgColor: 'bg-amber-50',
      iconBg: 'bg-amber-500',
      textColor: 'text-amber-700',
    },
    code: {
      borderColor: 'border-amber-500',
      bgColor: 'bg-amber-50',
      iconBg: 'bg-amber-500',
      textColor: 'text-amber-700',
    },
    template: {
      borderColor: 'border-teal-500',
      bgColor: 'bg-teal-50',
      iconBg: 'bg-teal-500',
      textColor: 'text-teal-700',
    },
    variable: {
      borderColor: 'border-cyan-500',
      bgColor: 'bg-cyan-50',
      iconBg: 'bg-cyan-500',
      textColor: 'text-cyan-700',
    },
    http: {
      borderColor: 'border-orange-500',
      bgColor: 'bg-orange-50',
      iconBg: 'bg-orange-500',
      textColor: 'text-orange-700',
    },
    database: {
      borderColor: 'border-blue-800',
      bgColor: 'bg-blue-50',
      iconBg: 'bg-blue-800',
      textColor: 'text-blue-800',
    },
    knowledge: {
      borderColor: 'border-lime-500',
      bgColor: 'bg-lime-50',
      iconBg: 'bg-lime-500',
      textColor: 'text-lime-700',
    },
    condition: {
      borderColor: 'border-violet-500',
      bgColor: 'bg-violet-50',
      iconBg: 'bg-violet-500',
      textColor: 'text-violet-700',
    },
    loop: {
      borderColor: 'border-pink-500',
      bgColor: 'bg-pink-50',
      iconBg: 'bg-pink-500',
      textColor: 'text-pink-700',
    },
    subworkflow: {
      borderColor: 'border-indigo-500',
      bgColor: 'bg-indigo-50',
      iconBg: 'bg-indigo-500',
      textColor: 'text-indigo-700',
    },
    subagent: {
      borderColor: 'border-violet-600',
      bgColor: 'bg-violet-50',
      iconBg: 'bg-violet-600',
      textColor: 'text-violet-700',
    },
    a2a: {
      borderColor: 'border-cyan-600',
      bgColor: 'bg-cyan-50',
      iconBg: 'bg-cyan-600',
      textColor: 'text-cyan-700',
    },
    memory_read: {
      borderColor: 'border-cyan-500',
      bgColor: 'bg-cyan-50',
      iconBg: 'bg-cyan-500',
      textColor: 'text-cyan-700',
    },
    memory_write: {
      borderColor: 'border-cyan-600',
      bgColor: 'bg-cyan-50',
      iconBg: 'bg-cyan-600',
      textColor: 'text-cyan-700',
    },
    human_in_loop: {
      borderColor: 'border-rose-500',
      bgColor: 'bg-rose-50',
      iconBg: 'bg-rose-500',
      textColor: 'text-rose-700',
    },
    host: {
      borderColor: 'border-gray-500',
      bgColor: 'bg-gray-50',
      iconBg: 'bg-gray-500',
      textColor: 'text-gray-700',
    },
  };
  return styles[type] || styles.host;
}

function getExecutionStatusStyles(status?: NodeExecutionStatus) {
  const statusStyles: Record<NodeExecutionStatus, { border: string; ring: string; badge: string; icon: any; pulse: boolean }> = {
    idle: { border: '', ring: '', badge: 'hidden', icon: null, pulse: false },
    running: { border: 'border-blue-500', ring: 'ring-4 ring-blue-200', badge: 'bg-blue-500', icon: Icons.Loader2, pulse: true },
    completed: { border: 'border-emerald-500', ring: 'ring-2 ring-emerald-200', badge: 'bg-emerald-500', icon: Icons.Check, pulse: false },
    failed: { border: 'border-red-500', ring: 'ring-2 ring-red-200', badge: 'bg-red-500', icon: Icons.X, pulse: false },
    skipped: { border: 'border-gray-400', ring: '', badge: 'bg-gray-400', icon: Icons.SkipForward, pulse: false },
  };
  return status ? statusStyles[status] : statusStyles.idle;
}

function CustomNodeComponent({ data, selected, id }: NodeProps) {
  const { label, description, iconName, type, executionStatus, hasBreakpoint } = data;
  const styles = getNodeStyles(type);
  const execStyles = getExecutionStatusStyles(executionStatus as NodeExecutionStatus);
  const IconComponent = iconMap[iconName] || Icons.Box;
  const StatusIcon = execStyles.icon;
  
  const nodeDef = NODE_TYPE_DEFINITIONS[type];
  const inputs = nodeDef?.inputs || [{ id: 'in', label: '输入', dataType: 'any' }];
  const outputs = nodeDef?.outputs || [{ id: 'out', label: '输出', dataType: 'any' }];

  const hasInputs = inputs.length > 0;
  const hasOutputs = outputs.length > 0;

  return (
    <div className="relative">
      {hasBreakpoint && (
        <div className="absolute -top-2 -left-2 z-10 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center shadow-md border-2 border-white">
          <Icons.GripVertical className="w-3 h-3 text-white" />
        </div>
      )}
      <div
        className={cn(
          'min-w-[180px] rounded-lg border-2 bg-white shadow-sm transition-all duration-300',
          selected ? 'ring-2 ring-offset-2 ring-accent shadow-md scale-[1.02]' : '',
          execStyles.border || styles.borderColor,
          execStyles.ring,
          execStyles.pulse && 'animate-pulse'
        )}
      >
      {hasInputs && inputs.map((input, index) => (
        <Handle
          key={input.id}
          type="target"
          position={Position.Left}
          id={input.id}
          className={cn(
            '!w-3 !h-3 !bg-white !border-2 !border-gray-300 hover:!border-accent hover:!bg-accent transition-colors',
            inputs.length > 1 ? '!-translate-x-1/2' : ''
          )}
          style={{
            top: inputs.length === 1 ? '50%' : `${((index + 1) / (inputs.length + 1)) * 100}%`,
          }}
          title={input.label}
        />
      ))}

      <div className={cn('px-3 py-2 border-b', styles.bgColor)}>
        <div className="flex items-center gap-2">
          <div className={cn('w-6 h-6 rounded flex items-center justify-center shrink-0', styles.iconBg)}>
            <IconComponent className="w-3.5 h-3.5 text-white" />
          </div>
          <span className={cn('text-sm font-medium truncate flex-1', styles.textColor)}>{label}</span>
          {StatusIcon && (
            <div className={cn('w-5 h-5 rounded-full flex items-center justify-center shrink-0', execStyles.badge)}>
              <StatusIcon className={cn('w-3 h-3 text-white', execStyles.pulse && 'animate-spin')} />
            </div>
          )}
        </div>
      </div>

      <div className="px-3 py-2.5">
        <p className="text-xs text-text-secondary line-clamp-2">{description}</p>
      </div>

      {hasOutputs && outputs.map((output, index) => (
        <Handle
          key={output.id}
          type="source"
          position={Position.Right}
          id={output.id}
          className={cn(
            '!w-3 !h-3 !bg-white !border-2 !border-gray-300 hover:!border-accent hover:!bg-accent transition-colors',
            outputs.length > 1 ? '!translate-x-1/2' : ''
          )}
          style={{
            top: outputs.length === 1 ? '50%' : `${((index + 1) / (outputs.length + 1)) * 100}%`,
          }}
          title={output.label}
        />
      ))}
    </div>
    </div>
  );
}

export const CustomNode = memo(CustomNodeComponent);
