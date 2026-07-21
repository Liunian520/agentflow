/**
 * 操作确认机制 — 对标 Codex suggest/auto/full-auto 三级审批
 * 破坏性操作（创建、删除、运行）需要用户确认后才执行
 */

import { Shield, AlertTriangle, Info, Check, X } from 'lucide-react';
import type { ApprovalRequest } from '../../types';
import { cn } from '../../lib/utils';

interface ApprovalPromptProps {
  request: ApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
  className?: string;
}

const riskConfig: Record<ApprovalRequest['riskLevel'], { icon: React.ReactNode; color: string; bg: string }> = {
  low: { icon: <Info className="w-4 h-4" />, color: 'text-blue-600', bg: 'bg-blue-50' },
  medium: { icon: <AlertTriangle className="w-4 h-4" />, color: 'text-amber-600', bg: 'bg-amber-50' },
  high: { icon: <Shield className="w-4 h-4" />, color: 'text-red-600', bg: 'bg-red-50' },
};

export function ApprovalPrompt({ request, onApprove, onReject, className }: ApprovalPromptProps) {
  const risk = riskConfig[request.riskLevel];

  return (
    <div className={cn('border border-border rounded-xl p-4 shadow-sm', className)}>
      {/* 风险等级标记 */}
      <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg mb-3', risk.bg, risk.color)}>
        {risk.icon}
        <span className="text-sm font-medium">
          {request.riskLevel === 'low' ? '低风险操作' :
           request.riskLevel === 'medium' ? '中等风险 — 请确认后执行' :
           '高风险操作 — 请仔细审阅'}
        </span>
      </div>

      {/* 操作描述 */}
      <div className="mb-3">
        <div className="text-sm font-semibold text-text-primary mb-1">
          操作: {request.action}
        </div>
        <div className="text-sm text-text-secondary">
          {request.description}
        </div>
      </div>

      {/* 详情 */}
      {request.details && (
        <div className="mb-3 bg-bg-secondary rounded-lg p-3">
          {Object.entries(request.details).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2 text-sm">
              <span className="text-text-tertiary min-w-[80px]">{key}:</span>
              <span className="text-text-primary font-medium">{String(value)}</span>
            </div>
          ))}
        </div>
      )}

      {/* 确认按钮 */}
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={onApprove}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors active:scale-[0.98]"
        >
          <Check className="w-4 h-4" />
          确认执行
        </button>
        <button
          onClick={onReject}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-text-secondary hover:bg-bg-hover rounded-lg transition-colors active:scale-[0.98]"
        >
          <X className="w-4 h-4" />
          取消
        </button>
      </div>
    </div>
  );
}

/**
 * 判断操作是否需要确认
 */
export function needsApproval(action: string, mode: string): ApprovalRequest | null {
  // Plan 模式不执行任何操作，无需确认
  if (mode === 'plan') return null;

  // Debug 模式自动执行，但高风险仍需确认
  if (mode === 'debug' && action !== 'delete_agent' && action !== 'delete_workflow') return null;

  // Code 模式：创建和运行需确认
  const approvalMap: Record<string, ApprovalRequest> = {
    create_agent: {
      id: 'approval-create-agent',
      action: '创建 Agent',
      description: '将创建一个新的 Agent 并添加到系统中',
      riskLevel: 'medium',
    },
    create_workflow: {
      id: 'approval-create-workflow',
      action: '创建工作流',
      description: '将创建一个新的工作流，包含指定节点和连线',
      riskLevel: 'medium',
    },
    run_workflow: {
      id: 'approval-run-workflow',
      action: '运行工作流',
      description: '将启动工作流执行，可能消耗资源',
      riskLevel: 'medium',
    },
    delete_agent: {
      id: 'approval-delete-agent',
      action: '删除 Agent',
      description: '此操作不可恢复！Agent 将被永久移除',
      riskLevel: 'high',
    },
    delete_workflow: {
      id: 'approval-delete-workflow',
      action: '删除工作流',
      description: '此操作不可恢复！工作流将被永久移除',
      riskLevel: 'high',
    },
    ssh_command: {
      id: 'approval-ssh',
      action: '执行 SSH 命令',
      description: '将在远程主机上执行命令，请确认命令内容',
      riskLevel: 'high',
    },
  };

  return approvalMap[action] || null;
}
