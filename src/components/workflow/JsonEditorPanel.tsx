import { useState, useEffect, useCallback } from 'react';
import {
  FileJson,
  RefreshCw,
  Check,
  AlertCircle,
  Copy,
  CheckCheck,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { workflowToJson, validateJson, jsonToWorkflow } from '../../lib/workflowJson';
import type { FlowNode, FlowEdge } from '../../types';

interface JsonEditorPanelProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  workflowId?: string;
  workflowName?: string;
  workflowDescription?: string;
  onApply: (nodes: FlowNode[], edges: FlowEdge[]) => void;
}

export function JsonEditorPanel({
  nodes,
  edges,
  workflowId,
  workflowName,
  workflowDescription,
  onApply,
}: JsonEditorPanelProps) {
  const [jsonText, setJsonText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [copied, setCopied] = useState(false);
  const [applySuccess, setApplySuccess] = useState(false);

  const generateJson = useCallback(() => {
    const json = workflowToJson(nodes, edges, {
      workflowId,
      workflowName,
      workflowDescription,
    });
    setJsonText(json);
    setParseError(null);
    setIsDirty(false);
  }, [nodes, edges, workflowId, workflowName, workflowDescription]);

  useEffect(() => {
    generateJson();
  }, [generateJson]);

  const handleJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setJsonText(newText);
    setIsDirty(true);
    setApplySuccess(false);

    const { valid, error } = validateJson(newText);
    setParseError(valid ? null : error || 'JSON 格式无效');
  };

  const handleReset = () => {
    generateJson();
  };

  const handleApply = () => {
    const { valid, error } = validateJson(jsonText);
    if (!valid) {
      setParseError(error || 'JSON 格式无效');
      return;
    }

    const result = jsonToWorkflow(jsonText);

    if (!result.success) {
      setParseError(result.error || '解析失败');
      return;
    }

    onApply(result.nodes, result.edges);
    setIsDirty(false);
    setApplySuccess(true);
    setTimeout(() => setApplySuccess(false), 2000);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setParseError(null);
    } catch (err: any) {
      setParseError(err.message || '格式化失败');
    }
  };

  const lineCount = jsonText.split('\n').length;

  return (
    <div className="h-full flex flex-col bg-bg-secondary/30">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileJson className="w-4 h-4 text-text-tertiary" />
          <span className="text-xs font-medium text-text-primary">
            JSON 编辑器
          </span>
          {isDirty && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
              未保存
            </span>
          )}
          {applySuccess && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
              已应用
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleFormat}
            className="flex items-center gap-1 px-2 py-1 text-xs text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
            title="格式化 JSON"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            格式化
          </button>

          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 text-xs text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
            title="复制 JSON"
          >
            {copied ? (
              <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copied ? '已复制' : '复制'}
          </button>

          <div className="w-px h-4 bg-border mx-1" />

          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-2 py-1 text-xs text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
            title="从画布重新加载"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            重置
          </button>

          <button
            onClick={handleApply}
            disabled={parseError !== null}
            className={cn(
              'flex items-center gap-1 px-3 py-1 text-xs font-medium rounded transition-colors',
              parseError === null
                ? 'bg-accent hover:bg-accent-hover text-white'
                : 'bg-bg-secondary text-text-tertiary cursor-not-allowed'
            )}
          >
            <Check className="w-3.5 h-3.5" />
            应用
          </button>
        </div>
      </div>

      {parseError && (
        <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border-b border-red-100 flex-shrink-0">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-red-700">JSON 格式错误</p>
            <p className="text-xs text-red-600 font-mono truncate">{parseError}</p>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden relative">
        <div className="absolute inset-0 flex">
          <div className="flex-shrink-0 w-10 bg-bg-secondary border-r border-border text-right pr-2 pt-2 pb-2 overflow-hidden select-none">
            <div className="font-mono text-xs text-text-tertiary leading-5">
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          </div>

          <textarea
            value={jsonText}
            onChange={handleJsonChange}
            className={cn(
              'flex-1 w-full h-full resize-none bg-white p-2 font-mono text-xs leading-5',
              'focus:outline-none focus:ring-0',
              'text-text-primary',
              parseError && 'bg-red-50/30'
            )}
            spellCheck={false}
            placeholder="在此编辑工作流 JSON..."
          />
        </div>
      </div>

      <div className="flex items-center justify-between px-3 py-1.5 border-t border-border bg-white flex-shrink-0">
        <div className="flex items-center gap-3 text-[10px] text-text-tertiary font-mono">
          <span>节点: {nodes.length}</span>
          <span>连线: {edges.length}</span>
        </div>
        <div className="text-[10px] text-text-tertiary font-mono">
          v1.0.0
        </div>
      </div>
    </div>
  );
}
