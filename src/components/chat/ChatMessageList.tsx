import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, FileText, Lightbulb, Search, Brain, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';
import type {
  ChatMessage, AgentMode, ParsedIntent,
  TaskStep, ThinkingStep, ApprovalRequest,
  OrchestrationPlan,
} from '../../types';
import type { FileNode, FileChange } from './ProjectDirPanel';
import { getModeConfig } from './ModeSelector';
import { MarkdownRenderer } from './MarkdownRenderer';
import { AgentCard } from './cards/AgentCard';
import { WorkflowPreview } from './cards/WorkflowPreview';
import { Clarification } from './cards/Clarification';
import { ApprovalPrompt } from './ApprovalPrompt';
import { ThinkingIndicator } from './ThinkingIndicator';
import { TaskTracker } from './TaskTracker';
import { MultiAgentTracker } from './MultiAgentTracker';
import { ProjectDirPanel } from './ProjectDirPanel';

interface ChatMessageListProps {
  activeMessages: ChatMessage[];
  activeMode: AgentMode;
  isProcessing: boolean;
  thinkingSteps: ThinkingStep[];
  streamingReasoning?: string;
  activeTaskSteps: TaskStep[];
  multiAgentSteps?: TaskStep[];
  pendingApproval: {
    request: ApprovalRequest;
    intent: ParsedIntent;
    metaPlan?: OrchestrationPlan;
  } | null;
  onApprove: () => void;
  onReject: () => void;
  onSuggestionClick: (s: string) => void;
  onWorkflowRefine: (id: string) => void;
  // Project dir
  projectName: string | null;
  fileTree: FileNode[];
  selectedFiles: Set<string>;
  dirBusy: boolean;
  dirError: string | null;
  pendingChanges: FileChange[];
  onSelectDir: () => void;
  onToggleFile: (path: string) => void;
  onApplyChange: (c: FileChange) => void;
  onSkipChange: (c: FileChange) => void;
  onClearChanges: () => void;
}

const quickSuggestions = [
  '帮我创建一个文案写手Agent',
  '设计一个内容审核工作流',
  '查看已有的Agent列表',
  '帮我创建一个数据分析助手，用DeepSeek模型',
];

// 首次引导：3个能力体验卡片，点击即体验完整能力链（工具/记忆/Agent）
const onboardingCards = [
  {
    icon: Search,
    iconBg: 'from-sky-400 to-blue-500',
    title: '实时信息查询',
    desc: '自动调用搜索工具获取最新资讯',
    prompt: '最近 OpenAI 发布了什么新模型？',
    badge: '工具调用',
  },
  {
    icon: Brain,
    iconBg: 'from-violet-500 to-purple-500',
    title: '记忆能力体验',
    desc: '记住你的偏好，下次自动召回',
    prompt: '我喜欢用 TypeScript，代码风格偏好函数式，请记住这个偏好',
    badge: '长期记忆',
  },
  {
    icon: Zap,
    iconBg: 'from-amber-400 to-orange-500',
    title: '一键创建 Agent',
    desc: '自然语言生成可用 Agent',
    prompt: '帮我创建一个文案写手 Agent',
    badge: 'Agent 编排',
  },
];

export function ChatMessageList({
  activeMessages,
  activeMode,
  isProcessing,
  thinkingSteps,
  streamingReasoning,
  activeTaskSteps,
  multiAgentSteps,
  pendingApproval,
  onApprove,
  onReject,
  onSuggestionClick,
  onWorkflowRefine,
  projectName,
  fileTree,
  selectedFiles,
  dirBusy,
  dirError,
  pendingChanges,
  onSelectDir,
  onToggleFile,
  onApplyChange,
  onSkipChange,
  onClearChanges,
}: ChatMessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const modeConfig = getModeConfig(activeMode);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages, activeTaskSteps, thinkingSteps]);

  const renderMessageContent = (msg: ChatMessage) => {
    if (
      pendingApproval &&
      msg.id === activeMessages[activeMessages.length - 1]?.id &&
      msg.role === 'assistant'
    ) {
      return <ApprovalPrompt request={pendingApproval.request} onApprove={onApprove} onReject={onReject} />;
    }

    if (msg.messageType === 'agent_card' && msg.metadata?.agent) {
      return (
        <div className="space-y-2">
          <MarkdownRenderer content={msg.content} />
          <AgentCard agent={msg.metadata.agent} />
        </div>
      );
    }

    if (msg.messageType === 'workflow_preview' && msg.metadata?.workflow) {
      return (
        <div className="space-y-2">
          <MarkdownRenderer content={msg.content} />
          <WorkflowPreview workflow={msg.metadata.workflow} onRefine={onWorkflowRefine} />
        </div>
      );
    }

    if (msg.messageType === 'clarification' && msg.metadata?.clarification) {
      return (
        <div className="space-y-2">
          <Clarification
            message={msg.metadata.clarification}
            suggestions={msg.metadata.suggestions || quickSuggestions}
            onSelect={onSuggestionClick}
          />
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {msg.metadata?.reasoning && <ReasoningBlock reasoning={msg.metadata.reasoning} />}
        {(msg.metadata?.thinkingSteps?.length > 0 || msg.metadata?.taskSteps?.length > 0) && (
          <ExecutionSummary
            thinkingSteps={msg.metadata.thinkingSteps || []}
            taskSteps={msg.metadata.taskSteps || []}
          />
        )}
        <MarkdownRenderer content={msg.content} />
        {msg.metadata?.savedMemories?.length > 0 && (
          <MemorySavedHint memories={msg.metadata.savedMemories} />
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 md:px-8 md:py-6">
      <ProjectDirPanel
        projectName={projectName}
        fileTree={fileTree}
        selected={selectedFiles}
        dirBusy={dirBusy}
        dirError={dirError}
        changes={pendingChanges}
        onSelectDir={onSelectDir}
        onToggleFile={onToggleFile}
        onApplyChange={onApplyChange}
        onSkipChange={onSkipChange}
        onClearChanges={onClearChanges}
      />

      <div className="max-w-3xl mx-auto space-y-4">
        {/* 首次欢迎区 */}
        {activeMessages.length <= 1 && !isProcessing && !pendingApproval && (
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center mx-auto mb-4 shadow-lg">
              <Lightbulb className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-text-primary mb-2">对话式编程工作台</h2>
            <p className="text-sm text-text-secondary mb-2 max-w-md mx-auto">
              用自然语言创建 Agent、编排工作流、管理配置。
            </p>
            <div className="inline-flex items-center gap-1 px-3 py-1 bg-violet-50 text-violet-600 rounded-full text-xs font-medium mb-6">
              当前模式: {modeConfig.icon} {modeConfig.label} — {modeConfig.description}
            </div>

            {/* 能力体验卡片：点击即体验完整能力链 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl mx-auto mb-6">
              {onboardingCards.map((card, idx) => {
                const Icon = card.icon;
                return (
                  <button
                    key={idx}
                    onClick={() => onSuggestionClick(card.prompt)}
                    className="group relative text-left p-4 bg-white border border-border rounded-xl hover:border-accent hover:shadow-md transition-all active:scale-[0.98] overflow-hidden"
                  >
                    <div className="absolute top-2 right-2 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 bg-slate-100 rounded">
                      {card.badge}
                    </div>
                    <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${card.iconBg} flex items-center justify-center mb-3 shadow-sm`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="text-sm font-semibold text-text-primary mb-1">{card.title}</h3>
                    <p className="text-xs text-text-secondary mb-2 line-clamp-2">{card.desc}</p>
                    <p className="text-xs text-accent group-hover:underline truncate">→ {card.prompt}</p>
                  </button>
                );
              })}
            </div>

            {/* 更多建议 */}
            <details className="max-w-3xl mx-auto text-left">
              <summary className="text-xs text-text-secondary cursor-pointer hover:text-accent select-none">
                更多示例…
              </summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                {quickSuggestions.map((suggestion, idx) => (
                  <button
                    key={idx}
                    onClick={() => onSuggestionClick(suggestion)}
                    className="flex items-center gap-2 px-3 py-2 text-xs text-text-secondary bg-white border border-border hover:border-accent hover:bg-accent-bg rounded-lg transition-all active:scale-[0.98]"
                  >
                    <Lightbulb className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                    <span className="truncate">{suggestion}</span>
                  </button>
                ))}
              </div>
            </details>
          </div>
        )}

        {/* 消息列表 */}
        {activeMessages.map((msg) => (
          <div
            key={msg.id}
            className={cn('flex gap-3', msg.role === 'user' ? 'flex-row-reverse' : '')}
          >
            <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center">
              {msg.role === 'user' ? (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-pink-500 flex items-center justify-center text-white text-xs font-medium">
                  U
                </div>
              ) : (
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center text-white',
                    activeMode === 'plan'
                      ? 'bg-gradient-to-br from-amber-400 to-orange-500'
                      : activeMode === 'code'
                        ? 'bg-gradient-to-br from-violet-500 to-pink-500'
                        : activeMode === 'debug'
                          ? 'bg-gradient-to-br from-red-400 to-rose-500'
                          : 'bg-gradient-to-br from-blue-400 to-indigo-500'
                  )}
                >
                  <span className="text-sm">{modeConfig.icon}</span>
                </div>
              )}
            </div>

            <div
              className={cn(
                'max-w-[80%] md:max-w-2xl',
                msg.role === 'user'
                  ? 'bg-accent text-white rounded-2xl rounded-tr-sm px-4 py-3'
                  : 'bg-white border border-border rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm'
              )}
            >
              {/* 消息附件 */}
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {msg.attachments.map((a) => (
                    <span
                      key={a.id}
                      className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs max-w-[180px]',
                        msg.role === 'user'
                          ? 'bg-white/15'
                          : 'bg-bg-secondary border border-border text-text-secondary'
                      )}
                      title={`${a.name} · ${(a.size / 1024).toFixed(0)}KB`}
                    >
                      {a.kind === 'image' ? (
                        <ImageIcon className="w-3 h-3 shrink-0" />
                      ) : (
                        <FileText className="w-3 h-3 shrink-0" />
                      )}
                      <span className="truncate">{a.name}</span>
                    </span>
                  ))}
                </div>
              )}
              {msg.role === 'user' ? (
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              ) : (
                renderMessageContent(msg)
              )}
            </div>
          </div>
        ))}

        {/* 流式推理过程展示 */}
        {isProcessing && streamingReasoning && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full flex-shrink-0" />
            <div className="max-w-[80%] md:max-w-2xl">
              <ReasoningBlock reasoning={streamingReasoning} streaming />
            </div>
          </div>
        )}

        {/* 思考过程展示 */}
        {(thinkingSteps.length > 0 || isProcessing) && (
          <ThinkingIndicator steps={thinkingSteps} isThinking={isProcessing} />
        )}

        {/* 任务进度展示 */}
        {activeTaskSteps.length > 0 && <TaskTracker steps={activeTaskSteps} />}

        {/* 多Agent协作执行追踪 */}
        {multiAgentSteps && multiAgentSteps.length > 0 && (
          <MultiAgentTracker steps={multiAgentSteps} />
        )}

        {/* 操作确认卡片 */}
        {pendingApproval && (
          <ApprovalPrompt
            request={pendingApproval.request}
            onApprove={onApprove}
            onReject={onReject}
          />
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

function MemorySavedHint({ memories }: { memories: Array<{ content: string; type: string }> }) {
  const [expanded, setExpanded] = useState(false);
  const preview = memories[0]?.content || '';
  const hasMore = memories.length > 1;

  return (
    <div className="mt-1 rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-2">
      <button
        onClick={() => hasMore && setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 text-left"
      >
        <Brain className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
        <span className="text-xs text-violet-700 font-medium">
          🧠 已记住{memories.length > 1 ? ` ${memories.length} 条` : ''}：{preview}
          {preview.length >= 120 && '…'}
        </span>
        {hasMore && (
          <span className="ml-auto text-[10px] text-violet-400">
            {expanded ? '收起' : `+${memories.length - 1}`}
          </span>
        )}
      </button>
      {expanded && hasMore && (
        <div className="mt-1.5 pl-5 space-y-1">
          {memories.slice(1).map((m, i) => (
            <p key={i} className="text-[11px] text-violet-600/80">
              · {m.content}{m.content.length >= 120 && '…'}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function ExecutionSummary({
  thinkingSteps,
  taskSteps,
}: {
  thinkingSteps: ThinkingStep[];
  taskSteps: TaskStep[];
}) {
  const [expanded, setExpanded] = useState(false);
  const completedCount = taskSteps.filter((s) => s.status === 'completed').length;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100/50 transition-colors"
      >
        <span className={cn('transition-transform', expanded ? 'rotate-90' : '')}>▶</span>
        <span>执行过程</span>
        {thinkingSteps.length > 0 && (
          <span className="text-slate-400">· {thinkingSteps.length} 步思考</span>
        )}
        {taskSteps.length > 0 && (
          <span className="text-slate-400">
            · {completedCount}/{taskSteps.length} 完成
          </span>
        )}
        <span className="ml-auto text-slate-400">{expanded ? '收起' : '展开'}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {thinkingSteps.length > 0 && (
            <ThinkingIndicator steps={thinkingSteps} isThinking={false} />
          )}
          {taskSteps.length > 0 && <TaskTracker steps={taskSteps} className="!bg-white/60" />}
        </div>
      )}
    </div>
  );
}

function ReasoningBlock({ reasoning, streaming }: { reasoning: string; streaming?: boolean }) {
  const [collapsed, setCollapsed] = useState(!streaming);

  return (
    <div className="mb-2 rounded-lg border border-violet-200 bg-violet-50/50 overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100/50 transition-colors"
      >
        <span className={cn('transition-transform', collapsed ? '' : 'rotate-90')}>▶</span>
        <span>{streaming ? '💭 思考中...' : '💭 思考过程'}</span>
        <span className="ml-auto text-violet-400">{collapsed ? '展开' : '收起'}</span>
      </button>
      {!collapsed && (
        <div className="px-3 pb-2 text-xs text-violet-900/70 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
          {reasoning}
          {streaming && <span className="inline-block w-1.5 h-3 ml-0.5 bg-violet-400 animate-pulse" />}
        </div>
      )}
    </div>
  );
}
