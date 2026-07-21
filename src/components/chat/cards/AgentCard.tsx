import { Bot, Eye, Edit3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Agent } from '../../../types';
import { cn } from '../../../lib/utils';

interface AgentCardProps {
  agent: Agent;
  className?: string;
}

export function AgentCard({ agent, className }: AgentCardProps) {
  const navigate = useNavigate();

  return (
    <div className={cn(
      'bg-white border border-border rounded-xl p-4 shadow-sm hover:shadow-md transition-all duration-200',
      className
    )}>
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center text-2xl flex-shrink-0">
          {agent.avatar}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-text-primary text-base mb-0.5">{agent.name}</div>
          <div className="text-sm text-text-secondary line-clamp-2 mb-2">{agent.description}</div>
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent-bg text-accent rounded-full font-medium">
              <Bot className="w-3 h-3" />
              {agent.model}
            </span>
            {agent.tools.length > 0 && (
              <span className="text-text-tertiary">
                {agent.tools.length} 个工具
              </span>
            )}
          </div>
        </div>
      </div>

      {agent.tools.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {agent.tools.map((tool) => (
            <span key={tool} className="px-2 py-0.5 text-xs bg-bg-secondary text-text-secondary rounded-full">
              {tool}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => navigate(`/agents`)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-bg rounded-md transition-colors active:scale-[0.98]"
        >
          <Eye className="w-3.5 h-3.5" />
          查看
        </button>
        <button
          onClick={() => navigate(`/agents`)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover rounded-md transition-colors active:scale-[0.98]"
        >
          <Edit3 className="w-3.5 h-3.5" />
          编辑
        </button>
      </div>
    </div>
  );
}
