import {
  FolderOpen, File as FileIcon, Folder, RefreshCw, AlertCircle, Check, X,
} from 'lucide-react';
import { cn } from '../../lib/utils';

export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
}

export interface FileChange {
  path: string;
  content: string;
  status: 'pending' | 'applied' | 'skipped';
}

interface Props {
  projectName: string | null;
  fileTree: FileNode[];
  selected: Set<string>;
  dirBusy: boolean;
  dirError: string | null;
  changes: FileChange[];
  onSelectDir: () => void;
  onToggleFile: (path: string) => void;
  onApplyChange: (c: FileChange) => void;
  onSkipChange: (c: FileChange) => void;
  onClearChanges: () => void;
}

function TreeNode({
  node, depth, selected, onToggle,
}: {
  node: FileNode;
  depth: number;
  selected: Set<string>;
  onToggle: (p: string) => void;
}) {
  if (node.isDir) {
    return (
      <div>
        <div
          className="flex items-center gap-1.5 py-1 text-text-secondary"
          style={{ paddingLeft: depth * 12 }}
        >
          <Folder className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          <span className="text-xs truncate">{node.name}</span>
        </div>
        {node.children?.map((c) => (
          <TreeNode key={c.path} node={c} depth={depth + 1} selected={selected} onToggle={onToggle} />
        ))}
      </div>
    );
  }
  const checked = selected.has(node.path);
  return (
    <label
      className="flex items-center gap-1.5 py-1 cursor-pointer hover:bg-bg-hover rounded"
      style={{ paddingLeft: depth * 12 + 14 }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(node.path)}
        className="flex-shrink-0 accent-accent"
      />
      <FileIcon className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
      <span className={cn('text-xs truncate', checked ? 'text-text-primary' : 'text-text-secondary')}>
        {node.name}
      </span>
    </label>
  );
}

export function ProjectDirPanel({
  projectName, fileTree, selected, dirBusy, dirError, changes,
  onSelectDir, onToggleFile, onApplyChange, onSkipChange, onClearChanges,
}: Props) {
  const pendingCount = changes.filter((c) => c.status === 'pending').length;

  return (
    <div className="border-b border-border bg-bg-secondary/60">
      {/* 头部：选择目录 */}
      <div className="flex items-center justify-between px-3 py-2">
        <button
          onClick={onSelectDir}
          disabled={dirBusy}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-border bg-white hover:border-accent transition-colors disabled:opacity-50"
          title="选择本机项目目录（AI 可读写其中的文件）"
        >
          <FolderOpen className="w-3.5 h-3.5 text-accent" />
          {projectName ? (
            <span className="max-w-[180px] truncate">{projectName}</span>
          ) : (
            '选择项目目录'
          )}
          {dirBusy && <RefreshCw className="w-3 h-3 animate-spin" />}
        </button>
        {selected.size > 0 && (
          <span className="text-xs text-text-tertiary">已选 {selected.size} 个文件作为上下文</span>
        )}
      </div>

      {dirError && (
        <div className="mx-3 mb-2 flex items-center gap-1.5 px-2 py-1.5 text-xs text-red-600 bg-red-50 rounded-md">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{dirError}</span>
        </div>
      )}

      {/* 文件树 */}
      {projectName && fileTree.length > 0 && (
        <div className="max-h-52 overflow-y-auto px-2 pb-2 border-t border-border pt-2">
          <div className="text-[11px] text-text-tertiary mb-1 px-1">
            勾选要纳入对话的文件（仅读权限，AI 改完需你点「应用」才写回）
          </div>
          {fileTree.map((n) => (
            <TreeNode key={n.path} node={n} depth={0} selected={selected} onToggle={onToggleFile} />
          ))}
        </div>
      )}

      {/* 待应用改动 */}
      {changes.length > 0 && (
        <div className="border-t border-border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-primary">
              检测到 {pendingCount} 处文件改动
            </span>
            <button onClick={onClearChanges} className="text-xs text-text-tertiary hover:text-text-primary">
              清除
            </button>
          </div>
          {changes.map((c, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-2 bg-white border border-border rounded-md px-2.5 py-1.5"
            >
              <span className="text-xs font-mono text-text-primary truncate flex-1">{c.path}</span>
              {c.status === 'pending' ? (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => onApplyChange(c)}
                    className="px-2 py-0.5 text-xs rounded bg-accent text-white hover:bg-accent-hover"
                  >
                    应用
                  </button>
                  <button
                    onClick={() => onSkipChange(c)}
                    className="p-0.5 text-text-tertiary hover:text-text-primary"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <span
                  className={cn(
                    'text-xs flex-shrink-0 flex items-center gap-1',
                    c.status === 'applied' ? 'text-emerald-600' : 'text-text-tertiary',
                  )}
                >
                  {c.status === 'applied' && <Check className="w-3.5 h-3.5" />}
                  {c.status === 'applied' ? '已写回' : '已跳过'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
