import { Check, X, AlertCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';

interface ActionConfirmProps {
  actionType: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
}

export function ActionConfirm({ actionType, description, onConfirm, onCancel, className }: ActionConfirmProps) {
  const actionLabels: Record<string, string> = {
    agent_created: '创建 Agent',
    workflow_created: '创建工作流',
    agent_updated: '修改 Agent',
    workflow_updated: '修改工作流',
    workflow_run: '运行工作流',
  };

  return (
    <div className={cn(
      'bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm',
      className
    )}>
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
          <AlertCircle className="w-4 h-4 text-amber-600" />
        </div>
        <div className="flex-1">
          <div className="font-medium text-amber-800 text-sm mb-1">
            确认操作: {actionLabels[actionType] || actionType}
          </div>
          <div className="text-amber-700 text-sm">{description}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 justify-end">
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 rounded-md transition-colors active:scale-[0.98]"
        >
          <X className="w-3.5 h-3.5" />
          取消
        </button>
        <button
          onClick={onConfirm}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors active:scale-[0.98]"
        >
          <Check className="w-3.5 h-3.5" />
          确认执行
        </button>
      </div>
    </div>
  );
}
