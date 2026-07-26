import { Sparkles, Plus, Clock, MessageSquare, Trash2, Cpu, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ChatSession, AgentMode, Channel } from '../../types';
import { getModeConfig } from './ModeSelector';
import { BUILD_VERSION, shortVersion } from '../../lib/version';

interface ChatHeaderProps {
  activeSession?: ChatSession;
  sessions: ChatSession[];
  activeSessionId: string;
  activeMode: AgentMode;
  lastUsedModel: { provider: string; model: string; displayName?: string } | null;
  routerEnabled: boolean;
  defaultModelId: string | null;
  channels: Channel[];
  showSessionMenu: boolean;
  setShowSessionMenu: React.Dispatch<React.SetStateAction<boolean>>;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onSwitchSession: (id: string) => void;
}

export function ChatHeader({
  activeSession,
  sessions,
  activeSessionId,
  activeMode,
  lastUsedModel,
  routerEnabled,
  defaultModelId,
  channels,
  showSessionMenu,
  setShowSessionMenu,
  onNewSession,
  onDeleteSession,
  onSwitchSession,
}: ChatHeaderProps) {
  const modeConfig = getModeConfig(activeMode);

  return (
    <div className="h-14 bg-white border-b border-border flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <Sparkles className="w-5 h-5 text-accent" />
        <span className="font-semibold text-text-primary">
          {activeSession?.title || '对话工作台'}
        </span>
        <span
          className={cn(
            'px-2 py-0.5 text-xs font-medium rounded-full',
            activeMode === 'plan'
              ? 'bg-amber-50 text-amber-600'
              : activeMode === 'code'
                ? 'bg-violet-50 text-violet-600'
                : activeMode === 'debug'
                  ? 'bg-red-50 text-red-600'
                  : activeMode === 'ask'
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-blue-50 text-blue-600'
          )}
        >
          {modeConfig.icon} {modeConfig.label}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* 历史会话下拉 */}
        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowSessionMenu(!showSessionMenu);
            }}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg transition-colors',
              showSessionMenu
                ? 'bg-accent/10 text-accent'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary'
            )}
            title="历史提问"
          >
            <Clock className="w-4 h-4" />
            <span className="hidden sm:inline">历史提问</span>
            <span className="text-xs text-text-tertiary">({sessions.length})</span>
          </button>
          {showSessionMenu && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute top-full right-0 mt-2 w-72 rounded-xl border border-border bg-bg-primary shadow-xl py-2 z-40 max-h-[70vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between px-3 pb-2 border-b border-border">
                <span className="text-sm font-semibold text-text-primary">
                  历史提问 ({sessions.length})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onNewSession();
                    setShowSessionMenu(false);
                  }}
                  className="p-1 text-text-tertiary hover:text-accent rounded-md transition-colors"
                  title="新建对话"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="py-1">
                {sessions.slice(0, 50).map((session) => (
                  <button
                    key={session.id}
                    onClick={() => {
                      onSwitchSession(session.id);
                      setShowSessionMenu(false);
                    }}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors group',
                      activeSessionId === session.id ? 'bg-accent/10' : 'hover:bg-bg-secondary'
                    )}
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div
                        className={cn(
                          'text-sm truncate',
                          activeSessionId === session.id
                            ? 'text-accent font-medium'
                            : 'text-text-secondary'
                        )}
                      >
                        {session.title}
                      </div>
                      <div className="text-xs text-text-tertiary">
                        {session.messages.length} 条 · {session.mode || 'code'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(session.id);
                      }}
                      className="p-1 rounded-md text-text-tertiary hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                      title="删除对话"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </button>
                ))}
                {sessions.length === 0 && (
                  <p className="px-3 py-4 text-sm text-text-tertiary text-center">
                    暂无历史对话
                  </p>
                )}
              </div>
              {sessions.length > 50 && (
                <p className="px-3 pt-2 pb-1 text-xs text-text-tertiary border-t border-border">
                  会话记录较长，仅展示最近 50 条，更早的提问已省略
                </p>
              )}
            </div>
          )}
        </div>

        {/* 模型指示器 */}
        {lastUsedModel ? (
          <span
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-violet-50 text-violet-700 border border-violet-200 cursor-default"
            title={`当前模型: ${lastUsedModel.model} (${lastUsedModel.provider})`}
          >
            <Cpu className="w-3 h-3" />
            {lastUsedModel.displayName || lastUsedModel.model}
          </span>
        ) : routerEnabled ? (
          <span
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default"
            title="ACRouter 智能路由已启用，将根据任务自动选模型"
          >
            <Zap className="w-3 h-3" />
            自动路由
          </span>
        ) : defaultModelId ? (
          <span
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-blue-50 text-blue-700 border border-blue-200 cursor-default"
            title={`固定模型: ${defaultModelId}`}
          >
            <Cpu className="w-3 h-3" />
            {(() => {
              const [chId, modelName] = defaultModelId.split(':');
              const ch = channels.find((c) => c.id === chId);
              const m = ch?.models.find((mm) => mm.name === modelName);
              return m?.displayName || modelName;
            })()}
          </span>
        ) : null}

        <span
          className="hidden sm:flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-bg-secondary text-text-tertiary border border-border"
          title={`构建版本：${BUILD_VERSION}`}
        >
          🧬 {shortVersion(BUILD_VERSION)}
        </span>

        <button
          onClick={onNewSession}
          className="p-2 text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors md:hidden"
          title="新建对话"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
