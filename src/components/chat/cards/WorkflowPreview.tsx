import { Workflow, ExternalLink, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Workflow as WorkflowType } from '../../../types';
import { cn } from '../../../lib/utils';

interface WorkflowPreviewProps {
  workflow: WorkflowType;
  className?: string;
}

// 简化版节点颜色映射
const nodeColorMap: Record<string, string> = {
  start: '#10b981',
  end: '#ef4444',
  llm: '#8b5cf6',
  agent: '#3b82f6',
  code: '#f59e0b',
  http: '#06b6d4',
  condition: '#f97316',
  loop: '#ec4899',
  variable: '#14b8a6',
  database: '#6366f1',
  host: '#64748b',
  knowledge: '#a855f7',
  template: '#84cc16',
  'human-in-loop': '#fb923c',
  subworkflow: '#0ea5e9',
};

export function WorkflowPreview({ workflow, className }: WorkflowPreviewProps) {
  const navigate = useNavigate();
  const nodeCount = workflow.nodes.length;
  const edgeCount = workflow.edges.length;

  return (
    <div className={cn(
      'bg-white border border-border rounded-xl p-4 shadow-sm hover:shadow-md transition-all duration-200',
      className
    )}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
          <Workflow className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-text-primary text-base mb-0.5">{workflow.name}</div>
          <div className="text-sm text-text-secondary line-clamp-1">{workflow.description}</div>
        </div>
        <div className={cn(
          'px-2 py-0.5 text-xs font-medium rounded-full',
          workflow.status === 'published' ? 'bg-emerald-50 text-emerald-600' :
          workflow.status === 'running' ? 'bg-blue-50 text-blue-600' :
          workflow.status === 'paused' ? 'bg-amber-50 text-amber-600' :
          'bg-gray-50 text-gray-500'
        )}>
          {workflow.status === 'draft' ? '草稿' :
           workflow.status === 'published' ? '已发布' :
           workflow.status === 'running' ? '运行中' : '暂停'}
        </div>
      </div>

      {/* 节点流程缩略图 */}
      {nodeCount > 0 && (
        <div className="mb-3 bg-bg-secondary rounded-lg p-3">
          <div className="flex items-center gap-1 overflow-x-auto">
            {workflow.nodes.map((node, idx) => (
              <div key={node.id} className="flex items-center gap-1 flex-shrink-0">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium text-white"
                  style={{ backgroundColor: nodeColorMap[node.type] || '#9ca3af' }}
                >
                  {node.icon || node.type.slice(0, 2).toUpperCase()}
                </div>
                {idx < workflow.nodes.length - 1 && (
                  <div className="w-4 h-0.5 bg-border flex-shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 统计信息 */}
      <div className="flex items-center gap-4 text-xs text-text-tertiary mb-3">
        <span className="flex items-center gap-1">
          <CheckCircle className="w-3.5 h-3.5" />
          {nodeCount} 个节点
        </span>
        <span>{edgeCount} 条连线</span>
        <span>运行 {workflow.runs} 次</span>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate(`/workflow/${workflow.id}`)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors active:scale-[0.98]"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          打开编辑器
        </button>
        {nodeCount > 0 && (
          <button
            onClick={() => navigate(`/workflow/${workflow.id}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover rounded-md transition-colors active:scale-[0.98]"
          >
            运行工作流
          </button>
        )}
      </div>
    </div>
  );
}
