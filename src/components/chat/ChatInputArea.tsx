import { useEffect, useRef, useMemo } from 'react';
import {
  Send, Plus, Paperclip, MessageSquare, X, Image as ImageIcon,
  Cpu, Zap, Plug, ShieldCheck, ChevronDown, Check, FileText,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type {
  AgentMode, Channel, Agent, Workflow as WorkflowType,
  FileAttachment, SlashCommand,
} from '../../types';
import { MODE_CONFIGS, getModeConfig } from './ModeSelector';
import { SlashCommandBar } from './SlashCommandBar';

interface ModelOption {
  key: string;
  channelId: string;
  channelName: string;
  modelName: string;
  displayName: string;
}

interface ChatInputAreaProps {
  inputValue: string;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  onSend: () => void;
  isProcessing: boolean;
  activeMode: AgentMode;
  // Slash commands
  showSlashMenu: boolean;
  setShowSlashMenu: React.Dispatch<React.SetStateAction<boolean>>;
  onSlashSelect: (cmd: SlashCommand) => void;
  // File upload
  uploadedFiles: Array<FileAttachment>;
  onRemoveUploadedFile: (id: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  showAttachMenu: boolean;
  setShowAttachMenu: React.Dispatch<React.SetStateAction<boolean>>;
  showRefPicker: boolean;
  setShowRefPicker: React.Dispatch<React.SetStateAction<boolean>>;
  refSelection: string[];
  setRefSelection: React.Dispatch<React.SetStateAction<string[]>>;
  conversationAttachments: FileAttachment[];
  onConfirmRefAttachments: () => void;
  // Model selection
  channels: Channel[];
  defaultModelId: string | null;
  routerEnabled: boolean;
  setDefaultModelId: (id: string | null) => void;
  setRouterEnabled: (v: boolean) => void;
  showModelMenu: boolean;
  setShowModelMenu: React.Dispatch<React.SetStateAction<boolean>>;
  // Mode switch
  showModeMenu: boolean;
  setShowModeMenu: React.Dispatch<React.SetStateAction<boolean>>;
  onModeChange: (mode: AgentMode) => void;
  // Connector menu
  showConnectorMenu: boolean;
  setShowConnectorMenu: React.Dispatch<React.SetStateAction<boolean>>;
  mcps: Array<{ id: string; name: string }>;
  agents: Agent[];
  workflows: WorkflowType[];
  onInsertRef: (text: string) => void;
  // Full access
  allowFullAccess: boolean;
  setAllowFullAccess: (v: boolean) => void;
}

export function ChatInputArea({
  inputValue,
  setInputValue,
  onSend,
  isProcessing,
  activeMode,
  showSlashMenu,
  setShowSlashMenu,
  onSlashSelect,
  uploadedFiles,
  onRemoveUploadedFile,
  fileInputRef,
  onFileSelect,
  showAttachMenu,
  setShowAttachMenu,
  showRefPicker,
  setShowRefPicker,
  refSelection,
  setRefSelection,
  conversationAttachments,
  onConfirmRefAttachments,
  channels,
  defaultModelId,
  routerEnabled,
  setDefaultModelId,
  setRouterEnabled,
  showModelMenu,
  setShowModelMenu,
  showModeMenu,
  setShowModeMenu,
  onModeChange,
  showConnectorMenu,
  setShowConnectorMenu,
  mcps,
  agents,
  workflows,
  onInsertRef,
  allowFullAccess,
  setAllowFullAccess,
}: ChatInputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modeConfig = getModeConfig(activeMode);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 128) + 'px';
    }
  }, [inputValue]);

  useEffect(() => {
    setShowSlashMenu(inputValue.startsWith('/') && inputValue.length < 30);
  }, [inputValue, setShowSlashMenu]);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!showModelMenu) return;
    const close = () => setShowModelMenu(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showModelMenu, setShowModelMenu]);

  useEffect(() => {
    if (!showModeMenu) return;
    const close = () => setShowModeMenu(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showModeMenu, setShowModeMenu]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlashMenu) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const modelOptions = useMemo(() => {
    const list: ModelOption[] = [];
    const seen = new Set<string>();
    for (const ch of channels) {
      if (!ch.enabled || !ch.apiKey) continue;
      for (const m of ch.models) {
        if (!m.name) continue;
        const key = `${ch.id}:${m.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({
          key,
          channelId: ch.id,
          channelName: ch.name,
          modelName: m.name,
          displayName: m.displayName || m.name,
        });
      }
    }
    return list;
  }, [channels]);

  const currentModelKey = defaultModelId ?? null;
  const currentModelLabel = currentModelKey
    ? modelOptions.find((m) => m.key === currentModelKey)?.displayName || '已选模型'
    : '自动路由';

  return (
    <div className="border-t border-border bg-white p-4 md:px-8 pb-[calc(16px+env(safe-area-inset-bottom))] md:pb-4">
      <div className="max-w-3xl mx-auto relative">
        {/* 斜杠命令下拉 */}
        {showSlashMenu && (
          <SlashCommandBar
            inputValue={inputValue}
            onSelect={onSlashSelect}
            onClose={() => setShowSlashMenu(false)}
          />
        )}

        {/* 已上传文件 chips */}
        {uploadedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {uploadedFiles.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg bg-bg-secondary border border-border text-xs text-text-secondary max-w-[220px]"
              >
                {f.kind === 'image' ? (
                  <ImageIcon className="w-3.5 h-3.5 shrink-0 text-accent" />
                ) : (
                  <FileText className="w-3.5 h-3.5 shrink-0 text-accent" />
                )}
                <span className="truncate">{f.name}</span>
                <span className="text-text-tertiary shrink-0">{(f.size / 1024).toFixed(0)}KB</span>
                <button
                  type="button"
                  onClick={() => onRemoveUploadedFile(f.id)}
                  className="shrink-0 ml-0.5 text-text-tertiary hover:text-red-500 transition-colors"
                  title="移除"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 隐藏的文件选择器 */}
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFileSelect} accept="*/*" />

        <div className="relative bg-bg-secondary rounded-2xl border border-border focus-within:border-accent focus-within:ring-1 focus-within:ring-accent transition-all">
          {/* 输入行 */}
          <div className="flex items-end gap-2 p-2">
            {/* 左侧「+」附件菜单 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowAttachMenu((v) => !v);
                  setShowConnectorMenu(false);
                }}
                disabled={isProcessing}
                className={cn(
                  'p-2 rounded-lg transition-colors disabled:opacity-50 shrink-0',
                  showAttachMenu ? 'bg-accent/10 text-accent' : 'text-text-tertiary hover:text-accent hover:bg-bg-hover'
                )}
                title="添加文件 / 引用对话中的文件"
              >
                <Plus className="w-5 h-5" />
              </button>
              {showAttachMenu && (
                <div className="absolute bottom-full left-0 mb-2 w-52 rounded-xl border border-border bg-bg-primary shadow-lg py-1 z-30">
                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                      setShowAttachMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
                  >
                    <Paperclip className="w-4 h-4 shrink-0" />
                    添加文件
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRefSelection(conversationAttachments.map((a) => a.id));
                      setShowRefPicker(true);
                      setShowAttachMenu(false);
                    }}
                    disabled={conversationAttachments.length === 0}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title={
                      conversationAttachments.length === 0
                        ? '当前对话还没有可引用的文件'
                        : '从对话历史中引用已上传的文件'
                    }
                  >
                    <MessageSquare className="w-4 h-4 shrink-0" />
                    引用对话中的文件
                    {conversationAttachments.length > 0 && (
                      <span className="ml-auto text-xs text-text-tertiary">
                        {conversationAttachments.length}
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>

            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                activeMode === 'plan'
                  ? '描述你的需求，我会帮你规划方案（不执行）...'
                  : activeMode === 'debug'
                    ? '描述问题现象，我会自动诊断修复...'
                    : activeMode === 'orchestrator'
                      ? '描述复杂任务，我会分解并协调执行...'
                      : activeMode === 'ask'
                        ? '有什么问题尽管问，我会直接回答（不执行任何操作）...'
                        : '输入需求或 / 命令，如 /create-agent 或 "帮我创建Agent"'
              }
              rows={1}
              disabled={isProcessing}
              className="flex-1 bg-transparent resize-none outline-none text-sm text-text-primary placeholder:text-text-tertiary py-2 max-h-32 leading-relaxed disabled:opacity-50"
              style={{ height: 'auto', minHeight: '24px' }}
            />

            <button
              onClick={onSend}
              disabled={!inputValue.trim() || isProcessing}
              className={cn(
                'p-2 rounded-xl transition-colors active:scale-[0.98] shrink-0',
                inputValue.trim() && !isProcessing
                  ? 'bg-accent hover:bg-accent-hover text-white'
                  : 'bg-bg-tertiary text-text-tertiary cursor-not-allowed'
              )}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>

          {/* 工具栏 */}
          <div className="flex items-center gap-1 px-2 pb-2">
            {/* 模型选择下拉 */}
            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowModelMenu((v) => !v);
                  setShowConnectorMenu(false);
                  setShowAttachMenu(false);
                }}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors',
                  showModelMenu ? 'text-accent bg-accent/10' : 'text-text-tertiary hover:text-accent hover:bg-bg-hover'
                )}
                title={routerEnabled ? '当前：自动路由' : `当前：${currentModelLabel}`}
              >
                <Cpu className="w-4 h-4 shrink-0" />
                <span className="text-xs font-medium max-w-[140px] truncate">
                  {routerEnabled ? '自动路由' : currentModelLabel}
                </span>
                <ChevronDown className="w-3 h-3 shrink-0" />
              </button>
              {showModelMenu && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-full left-0 mb-2 w-56 rounded-xl border border-border bg-bg-primary shadow-xl py-1 z-30 max-h-64 overflow-y-auto"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setRouterEnabled(true);
                      setDefaultModelId(null);
                      setShowModelMenu(false);
                    }}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors',
                      routerEnabled ? 'bg-accent/10' : 'hover:bg-bg-hover'
                    )}
                  >
                    <Zap className="w-4 h-4 shrink-0 text-accent" />
                    <div className="min-w-0">
                      <div className={cn('text-sm', routerEnabled ? 'text-accent font-medium' : 'text-text-secondary')}>自动路由</div>
                      <div className="text-xs text-text-tertiary">智能匹配最佳模型</div>
                    </div>
                    {routerEnabled && <Check className="w-4 h-4 text-accent shrink-0 ml-auto" />}
                  </button>
                  <div className="h-px bg-border mx-2 my-1" />
                  {modelOptions.length === 0 && (
                    <p className="px-3 py-2 text-xs text-text-tertiary">暂无可用模型，请在渠道设置中添加</p>
                  )}
                  {(() => {
                    const groups = new Map<string, ModelOption[]>();
                    for (const m of modelOptions) {
                      if (!groups.has(m.channelId)) groups.set(m.channelId, []);
                      groups.get(m.channelId)!.push(m);
                    }
                    return Array.from(groups.entries()).map(([channelId, models]) => (
                      <div key={channelId}>
                        <p className="px-3 pt-1.5 pb-0.5 text-xs font-semibold text-text-tertiary truncate">
                          {models[0].channelName}
                        </p>
                        {models.map((m) => {
                          const isSelected = !routerEnabled && currentModelKey === m.key;
                          return (
                            <button
                              key={m.key}
                              type="button"
                              onClick={() => {
                                setRouterEnabled(false);
                                setDefaultModelId(m.key);
                                setShowModelMenu(false);
                              }}
                              className={cn(
                                'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors',
                                isSelected ? 'bg-accent/10' : 'hover:bg-bg-hover'
                              )}
                            >
                              <Cpu className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
                              <span className={cn('text-sm truncate', isSelected ? 'text-accent font-medium' : 'text-text-secondary')}>
                                {m.displayName}
                              </span>
                              {isSelected && <Check className="w-3.5 h-3.5 text-accent shrink-0 ml-auto" />}
                            </button>
                          );
                        })}
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>

            {/* 模式切换下拉 */}
            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowModeMenu((v) => !v);
                  setShowConnectorMenu(false);
                  setShowAttachMenu(false);
                }}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors',
                  showModeMenu ? 'text-accent bg-accent/10' : 'text-text-tertiary hover:text-accent hover:bg-bg-hover'
                )}
                title={`当前模式：${modeConfig.label} — ${modeConfig.description}`}
              >
                <span className="text-sm leading-none">{modeConfig.icon}</span>
                <span className="text-xs font-medium">{modeConfig.label}</span>
                <ChevronDown className="w-3 h-3 shrink-0" />
              </button>
              {showModeMenu && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-full left-0 mb-2 w-48 rounded-xl border border-border bg-bg-primary shadow-xl py-1 z-30"
                >
                  {MODE_CONFIGS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        onModeChange(m.id);
                        setShowModeMenu(false);
                      }}
                      className={cn(
                        'w-full flex items-start gap-2 px-3 py-2 text-left transition-colors',
                        activeMode === m.id ? 'bg-accent/10' : 'hover:bg-bg-hover'
                      )}
                    >
                      <span className="text-base leading-none mt-0.5">{m.icon}</span>
                      <div className="min-w-0">
                        <div className={cn('text-sm', activeMode === m.id ? 'text-accent font-medium' : 'text-text-secondary')}>
                          {m.label}
                        </div>
                        <div className="text-xs text-text-tertiary leading-snug">{m.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 连接器（MCP）引用菜单 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowConnectorMenu((v) => !v);
                  setShowAttachMenu(false);
                }}
                className={cn(
                  'p-1.5 rounded-lg transition-colors',
                  showConnectorMenu ? 'bg-accent/10 text-accent' : 'text-text-tertiary hover:text-accent hover:bg-bg-hover'
                )}
                title="引用连接器 / Agent / 工作流"
              >
                <Plug className="w-4.5 h-4.5" />
              </button>
              {showConnectorMenu && (
                <div className="absolute bottom-full left-0 mb-2 w-64 rounded-xl border border-border bg-bg-primary shadow-lg py-1 z-30 max-h-80 overflow-y-auto">
                  <p className="px-3 pt-1.5 pb-1 text-xs font-semibold text-text-tertiary">连接器（MCP）</p>
                  {mcps.length === 0 && <p className="px-3 py-1.5 text-xs text-text-tertiary">暂无已配置连接器</p>}
                  {mcps.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onInsertRef(`@mcp:${s.name}`)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      <Plug className="w-3.5 h-3.5 shrink-0 text-accent" />
                      <span className="truncate">{s.name}</span>
                    </button>
                  ))}
                  <p className="px-3 pt-2 pb-1 text-xs font-semibold text-text-tertiary">Agent（专家）</p>
                  {agents.length === 0 && <p className="px-3 py-1.5 text-xs text-text-tertiary">暂无 Agent</p>}
                  {agents.slice(0, 12).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onInsertRef(`@agent:${a.name}`)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      <Cpu className="w-3.5 h-3.5 shrink-0 text-accent" />
                      <span className="truncate">{a.name}</span>
                    </button>
                  ))}
                  <p className="px-3 pt-2 pb-1 text-xs font-semibold text-text-tertiary">工作流（技能）</p>
                  {workflows.length === 0 && <p className="px-3 py-1.5 text-xs text-text-tertiary">暂无工作流</p>}
                  {workflows.slice(0, 12).map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => onInsertRef(`@workflow:${w.name}`)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      <Zap className="w-3.5 h-3.5 shrink-0 text-accent" />
                      <span className="truncate">{w.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 允许完全访问 */}
            <button
              type="button"
              onClick={() => setAllowFullAccess(!allowFullAccess)}
              className={cn(
                'p-1.5 rounded-lg transition-colors shrink-0',
                allowFullAccess
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'text-text-tertiary hover:text-emerald-600 hover:bg-bg-hover'
              )}
              title={
                allowFullAccess
                  ? '允许完全访问：自动执行，跳过操作确认'
                  : '已启用操作确认：执行前需你批准'
              }
            >
              <ShieldCheck className="w-4.5 h-4.5" />
            </button>

            <span className="ml-auto text-[11px] text-text-tertiary pr-1">
              `/help` 查看命令
            </span>
          </div>
        </div>
      </div>

      {/* ===== 引用对话中的文件 Overlay ===== */}
      {showRefPicker && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-primary border border-border rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-text-primary">引用对话中的文件</h2>
              <button
                onClick={() => setShowRefPicker(false)}
                className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-text-tertiary mb-3">
              勾选要加入当前对话上下文的历史附件，确认后会出现在输入框上方。
            </p>
            <div className="space-y-2">
              {conversationAttachments.map((a) => {
                const checked = refSelection.includes(a.id);
                return (
                  <label
                    key={a.id}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors',
                      checked ? 'border-accent bg-accent/5' : 'border-border hover:bg-bg-hover'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setRefSelection(
                          e.target.checked
                            ? [...refSelection, a.id]
                            : refSelection.filter((id) => id !== a.id)
                        )
                      }
                      className="accent-accent"
                    />
                    {a.kind === 'image' ? (
                      <ImageIcon className="w-4 h-4 shrink-0 text-accent" />
                    ) : (
                      <FileText className="w-4 h-4 shrink-0 text-accent" />
                    )}
                    <span className="truncate text-sm text-text-secondary">{a.name}</span>
                    <span className="ml-auto text-xs text-text-tertiary shrink-0">
                      {(a.size / 1024).toFixed(0)}KB
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowRefPicker(false)}
                className="px-4 py-2 text-sm rounded-lg border border-border text-text-secondary hover:bg-bg-hover transition-colors"
              >
                取消
              </button>
              <button
                onClick={onConfirmRefAttachments}
                disabled={refSelection.length === 0}
                className={cn(
                  'px-4 py-2 text-sm rounded-lg transition-colors',
                  refSelection.length > 0
                    ? 'bg-accent hover:bg-accent-hover text-white'
                    : 'bg-bg-tertiary text-text-tertiary cursor-not-allowed'
                )}
              >
                确认引用（{refSelection.length}）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
