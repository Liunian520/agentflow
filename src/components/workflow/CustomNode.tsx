import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import * as Icons from 'lucide-react';
import { cn } from '../../lib/utils';

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
    'human-in-loop': {
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

function CustomNodeComponent({ data, selected }: NodeProps) {
  const { label, description, iconName, type } = data;
  const styles = getNodeStyles(type);
  const IconComponent = iconMap[iconName] || Icons.Box;

  return (
    <div
      className={cn(
        'min-w-[180px] rounded-lg border-2 bg-white shadow-sm transition-all',
        selected ? 'ring-2 ring-offset-2 ring-accent shadow-md' : '',
        styles.borderColor
      )}
    >
      {type !== 'start' && (
        <Handle
          type="target"
          position={Position.Left}
          className="!w-3 !h-3 !bg-white !border-2 !border-gray-300 hover:!border-accent hover:!bg-accent"
        />
      )}

      <div className={cn('px-3 py-2 border-b', styles.bgColor)}>
        <div className="flex items-center gap-2">
          <div className={cn('w-6 h-6 rounded flex items-center justify-center', styles.iconBg)}>
            <IconComponent className="w-3.5 h-3.5 text-white" />
          </div>
          <span className={cn('text-sm font-medium', styles.textColor)}>{label}</span>
        </div>
      </div>

      <div className="px-3 py-2.5">
        <p className="text-xs text-text-secondary line-clamp-2">{description}</p>
      </div>

      {type !== 'end' && (
        <Handle
          type="source"
          position={Position.Right}
          className="!w-3 !h-3 !bg-white !border-2 !border-gray-300 hover:!border-accent hover:!bg-accent"
        />
      )}
    </div>
  );
}

export const CustomNode = memo(CustomNodeComponent);
