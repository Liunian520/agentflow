import { useState, useRef, useEffect } from 'react';
import {
  Send,
  Plus,
  Bot,
  MoreHorizontal,
  Settings,
  MessageSquare,
  Sparkles,
  Paperclip,
  Mic,
  X,
  Trash2,
  Edit3,
  Copy,
  Check,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn, generateId } from '../lib/utils';
import type { Agent } from '../types';
import { getAvailableChannelFromStore, getChannelForModel, routedChatLLMStream } from '../api/llmApi';
import { extractTaskFeatures } from '../lib/modelRouter';

type DrawerType = 'settings' | 'create' | 'manage' | 'more' | null;

const avatarOptions = ['🤖', '💻', '✍️', '📊', '🎨', '🧠', '🚀', '⚡', '🔬', '📚'];

export function AgentsPage() {
  const { agents, messages, addMessage, createAgent, updateAgent, deleteAgent, getAvailableModels, channels, mcps } = useStore();
  const availableModels = getAvailableModels();
  // Phase 6：Agent 工具从已配置的 MCP 服务器中勾选
  const mcpToolOptions = mcps.flatMap((m) => (m.enabled ? m.tools : [])).map((t) => t.name);
  const mcpToolSet = new Set(mcpToolOptions);
  const [inputValue, setInputValue] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<string | undefined>(agents[0]?.id);
  const [showMobileAgents, setShowMobileAgents] = useState(false);
  const [drawer, setDrawer] = useState<DrawerType>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editForm, setEditForm] = useState<Partial<Agent>>({});
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    avatar: '🤖',
    model: 'GPT-4o',
    systemPrompt: '',
    tools: [] as string[],
    temperature: 0.7,
  });
  const [toast, setToast] = useState<string | null>(null);
  const [agentSearch, setAgentSearch] = useState('');
  const filteredAgents = (() => {
    const q = agentSearch.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) => a.name.toLowerCase().includes(q) || (a.description?.toLowerCase().includes(q) ?? false),
    );
  })();

  const currentAgent = agents.find((a) => a.id === selectedAgent);
  const threadMessages = messages.filter((m) => m.agentId === selectedAgent);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threadMessages.length, selectedAgent]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 128) + 'px';
    }
  }, [inputValue]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const streamAbortRef = useRef<AbortController | null>(null);

  const handleSend = async () => {
    if (!inputValue.trim()) return;
    if (inputValue.length > 4000) {
      showToast('消息长度不能超过 4000 字符');
      return;
    }

    const userMessage = {
      id: generateId(),
      role: 'user' as const,
      content: inputValue,
      timestamp: new Date().toISOString(),
      agentId: selectedAgent,
    };
    addMessage(userMessage);
    setInputValue('');

    // 获取当前 Agent 配置
    const agent = agents.find(a => a.id === selectedAgent);
    const targetModel = agent?.model || 'gpt-4o';
    const channelInfo = await getChannelForModel(targetModel) || await getAvailableChannelFromStore();

    if (!channelInfo) {
      // 没有可用 LLM 渠道，回退到模拟
      setTimeout(() => {
        const aiMessage = {
          id: generateId(),
          role: 'assistant' as const,
          content: `⚠️ 未配置 LLM 渠道，无法调用 AI。请在「渠道设置」中添加 API Key。\n\n当前为模拟回复：\n好的，我来帮您处理这个问题。基于您的描述，我建议先明确目标，再设计具体流程。`,
          timestamp: new Date().toISOString(),
          agentId: selectedAgent,
        };
        addMessage(aiMessage);
      }, 500);
      return;
    }

    // 创建流式占位消息
    const streamMsgId = generateId();
    const streamMsg = {
      id: streamMsgId,
      role: 'assistant' as const,
      content: '',
      timestamp: new Date().toISOString(),
      agentId: selectedAgent,
    };
    addMessage(streamMsg);

    // 组装 LLM 请求消息
    const agentSystemPrompt = agent?.systemPrompt || '你是一个专业的 AI 助手。';
    const recentMessages = useStore.getState().messages
      .filter(m => m.agentId === selectedAgent && m.id !== userMessage.id && m.id !== streamMsgId)
      .slice(-8)
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const llmMessages = [
      { role: 'system' as const, content: agentSystemPrompt },
      ...recentMessages,
      { role: 'user' as const, content: inputValue },
    ];

    // 发起 SSE 流式调用（ACRouter 路由：自动选最优模型 + 反馈回写）
    const abortController = routedChatLLMStream(
      {
        messages: llmMessages,
        temperature: agent?.temperature ?? 0.7,
        maxTokens: agent?.maxTokens ?? 2048,
      },
      extractTaskFeatures(inputValue, { intent: 'agent_chat' }),
      {
        onDelta: (data) => {
          // 实时更新流式消息内容
          const fullContent = data.fullContent || '';
          useStore.getState().updateMessage(streamMsgId, { content: fullContent });
        },
        onDone: (data) => {
          // 确保最终内容完整
          const finalContent = data.content || '';
          if (finalContent) {
            useStore.getState().updateMessage(streamMsgId, { content: finalContent });
          }
          streamAbortRef.current = null;
        },
        onError: (data) => {
          useStore.getState().updateMessage(streamMsgId, {
            content: `❌ AI 回复失败: ${data.message}\n\n请检查渠道设置。`,
          });
          streamAbortRef.current = null;
        },
      }
    );

    streamAbortRef.current = abortController;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAgentSelect = (agentId: string) => {
    setSelectedAgent(agentId);
    setShowMobileAgents(false);
  };

  const handleOpenSettings = () => {
    if (!currentAgent) return;
    setEditForm({ ...currentAgent });
    setDrawer('settings');
  };

  const handleOpenCreate = () => {
    setCreateForm({
      name: '',
      description: '',
      avatar: '🤖',
      model: 'GPT-4o',
      systemPrompt: '',
      tools: [],
      temperature: 0.7,
    });
    setDrawer('create');
  };

  const handleSaveSettings = () => {
    if (!currentAgent) return;
    if (!editForm.name || !editForm.name.trim()) {
      showToast('请输入 Agent 名称');
      return;
    }
    updateAgent(currentAgent.id, {
      name: editForm.name.trim(),
      description: editForm.description || '',
      avatar: editForm.avatar || '🤖',
      model: editForm.model || 'GPT-4o',
      systemPrompt: editForm.systemPrompt || '',
      tools: editForm.tools || [],
      temperature: editForm.temperature ?? 0.7,
      maxTokens: editForm.maxTokens,
    });
    setDrawer(null);
    showToast('Agent 设置已保存');
  };

  const handleCreateAgent = () => {
    if (!createForm.name.trim()) {
      showToast('请输入 Agent 名称');
      return;
    }
    createAgent({
      name: createForm.name.trim(),
      description: createForm.description || '新的 AI 助手',
      avatar: createForm.avatar,
      model: createForm.model,
      systemPrompt: createForm.systemPrompt || '你是一个专业的 AI 助手。',
      tools: createForm.tools,
      temperature: createForm.temperature,
    });
    setDrawer(null);
    showToast('Agent 创建成功');
  };

  const handleDeleteAgent = (agentId: string) => {
    if (agents.length <= 1) {
      showToast('至少需要保留一个 Agent');
      return;
    }
    deleteAgent(agentId);
    if (selectedAgent === agentId) {
      const next = agents.find((a) => a.id !== agentId);
      setSelectedAgent(next?.id);
    }
    setDrawer(null);
    showToast('Agent 已删除');
  };

  const handleDuplicateAgent = (agent: Agent) => {
    createAgent({
      name: `${agent.name} (副本)`,
      description: agent.description,
      avatar: agent.avatar,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      tools: agent.tools,
      temperature: agent.temperature,
    });
    showToast('Agent 已复制');
  };

  const handleCopyAgentId = (agent: Agent) => {
    navigator.clipboard?.writeText(agent.id);
    setCopiedId(agent.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleAttachFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      showToast(`已选择文件: ${file.name}`);
    }
    e.target.value = '';
  };

  const handleMicClick = () => {
    showToast('语音输入功能开发中...');
  };

  const toggleTool = (tool: string, isCreate: boolean) => {
    if (isCreate) {
      setCreateForm((prev) => ({
        ...prev,
        tools: prev.tools.includes(tool)
          ? prev.tools.filter((t) => t !== tool)
          : [...prev.tools, tool],
      }));
    } else {
      setEditForm((prev) => ({
        ...prev,
        tools: (prev.tools || []).includes(tool)
          ? (prev.tools || []).filter((t) => t !== tool)
          : [...(prev.tools || []), tool],
      }));
    }
  };

  const renderAgentForm = (form: Partial<Agent>, setForm: (updates: Partial<Agent>) => void, isCreate: boolean) => (
    <div className="p-4 space-y-4 overflow-y-auto flex-1">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">头像</label>
        <div className="flex flex-wrap gap-2">
          {avatarOptions.map((avatar) => (
            <button
              key={avatar}
              onClick={() => setForm({ avatar })}
              className={cn(
                'w-10 h-10 rounded-full flex items-center justify-center text-xl transition-all active:scale-95',
                form.avatar === avatar
                  ? 'bg-accent-bg ring-2 ring-accent'
                  : 'bg-bg-secondary hover:bg-bg-hover'
              )}
            >
              {avatar}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">名称</label>
        <input
          type="text"
          value={form.name || ''}
          onChange={(e) => setForm({ name: e.target.value })}
          placeholder="给 Agent 起个名字"
          className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">描述</label>
        <textarea
          value={form.description || ''}
          onChange={(e) => setForm({ description: e.target.value })}
          placeholder="简要描述 Agent 的用途"
          rows={2}
          className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">模型</label>
        {availableModels.length > 0 ? (
          <select
            value={form.model || ''}
            onChange={(e) => setForm({ model: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
          >
            {availableModels.map((item) => (
              <option key={item.channelId + item.model.name} value={item.model.displayName}>
                {item.model.displayName} ({item.channelName})
              </option>
            ))}
          </select>
        ) : (
          <div className="px-3 py-2 text-sm border border-amber-200 bg-amber-50 text-amber-700 rounded-md">
            尚未配置任何渠道，请先到「渠道设置」添加 AI 提供商
          </div>
        )}
        {channels.length === 0 && (
          <a href="/settings" className="text-xs text-accent hover:underline mt-1 inline-block">
            前往渠道设置 →
          </a>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">系统提示词</label>
        <textarea
          value={form.systemPrompt || ''}
          onChange={(e) => setForm({ systemPrompt: e.target.value })}
          placeholder="定义 Agent 的角色、能力和行为约束..."
          rows={5}
          className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none font-mono"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm font-medium text-text-primary">温度</label>
          <span className="text-xs text-text-tertiary">{form.temperature ?? 0.7}</span>
        </div>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={form.temperature ?? 0.7}
          onChange={(e) => setForm({ temperature: parseFloat(e.target.value) })}
          className="w-full accent-accent"
        />
        <div className="flex justify-between text-xs text-text-tertiary mt-1">
          <span>精确</span>
          <span>创意</span>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">工具能力（MCP）</label>
        {mcpToolOptions.length === 0 ? (
          <div className="px-3 py-3 text-sm border border-dashed border-border bg-bg-secondary rounded-md text-text-tertiary">
            尚未配置任何 MCP 工具服务器。请前往
            <a href="/settings" className="text-accent hover:underline mx-1">系统设置 → MCP 服务器</a>
            添加后在此勾选。
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {mcpToolOptions.map((tool) => {
                const selected = (form.tools || []).includes(tool);
                return (
                  <button
                    key={tool}
                    onClick={() => toggleTool(tool, isCreate)}
                    className={cn(
                      'px-2.5 py-1 text-xs rounded-full transition-all active:scale-95',
                      selected
                        ? 'bg-accent text-white'
                        : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover'
                    )}
                  >
                    {tool}
                  </button>
                );
              })}
            </div>
            {/* 保留并展示旧版自由字符串工具，可一键移除 */}
            {(form.tools || []).filter((t) => !mcpToolSet.has(t)).length > 0 && (
              <div className="mt-2 pt-2 border-t border-border">
                <div className="text-[11px] text-text-tertiary mb-1.5">未匹配 MCP 的旧工具：</div>
                <div className="flex flex-wrap gap-1.5">
                  {(form.tools || [])
                    .filter((t) => !mcpToolSet.has(t))
                    .map((tool) => (
                      <button
                        key={tool}
                        onClick={() => toggleTool(tool, isCreate)}
                        className="px-2 py-0.5 text-[11px] rounded-full bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
                        title="点击移除"
                      >
                        {tool} ×
                      </button>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex overflow-hidden relative">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Desktop Sidebar */}
      <div className="hidden md:flex md:w-72 bg-white border-r border-border flex-col">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-text-primary">我的 Agent</h2>
            <button
              onClick={handleOpenCreate}
              className="p-1.5 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors active:scale-[0.98]"
              title="新建 Agent"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="relative">
            <input
              type="text"
              placeholder="搜索 Agent..."
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-bg-secondary"
            />
            <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredAgents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => setSelectedAgent(agent.id)}
              className={cn(
                'w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors active:scale-[0.98]',
                selectedAgent === agent.id
                  ? 'bg-accent-bg'
                  : 'hover:bg-bg-secondary'
              )}
            >
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center text-xl flex-shrink-0">
                {agent.avatar}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-text-primary text-sm mb-0.5">
                  {agent.name}
                </div>
                <div className="text-xs text-text-tertiary line-clamp-2">
                  {agent.description}
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-border">
          <button
            onClick={() => setDrawer('manage')}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-md transition-colors active:scale-[0.98]"
          >
            <Settings className="w-4 h-4" />
            管理 Agent
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col bg-bg-secondary md:pb-0 pb-[calc(60px+env(safe-area-inset-bottom))]">
        {currentAgent ? (
          <>
            <div className="h-14 bg-white border-b border-border flex items-center justify-between px-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center text-base md:text-lg">
                  {currentAgent.avatar}
                </div>
                <div>
                  <div className="font-medium text-text-primary text-sm">
                    {currentAgent.name}
                  </div>
                  <div className="text-xs text-emerald-600 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    在线 · {currentAgent.model}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleOpenSettings}
                  className="p-2 text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors active:scale-[0.98] min-w-[44px] min-h-[44px] flex items-center justify-center md:min-w-0 md:min-h-0"
                  title="Agent 设置"
                >
                  <Settings className="w-4 h-4 md:w-4 md:h-4" />
                </button>
                <button
                  onClick={() => setDrawer('more')}
                  className="p-2 text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors active:scale-[0.98] min-w-[44px] min-h-[44px] flex items-center justify-center md:min-w-0 md:min-h-0"
                  title="更多操作"
                >
                  <MoreHorizontal className="w-4 h-4 md:w-4 md:h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 md:px-6 md:py-4">
              <div className="max-w-3xl mx-auto space-y-3 md:space-y-4">
                <div className="text-center py-6 md:py-8">
                  <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center mx-auto mb-3 md:mb-4 text-2xl md:text-3xl">
                    {currentAgent.avatar}
                  </div>
                  <h2 className="text-lg md:text-xl font-semibold text-text-primary mb-1">
                    {currentAgent.name}
                  </h2>
                  <p className="text-sm text-text-secondary mb-3 md:mb-4 px-4">{currentAgent.description}</p>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-accent-bg text-accent text-xs font-medium rounded-full">
                    <Sparkles className="w-3.5 h-3.5" />
                    {currentAgent.model}
                  </div>
                </div>

                {threadMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      'flex gap-2 md:gap-3',
                      msg.role === 'user' ? 'flex-row-reverse' : ''
                    )}
                  >
                    <div className="w-7 h-7 md:w-8 md:h-8 rounded-full flex-shrink-0 flex items-center justify-center">
                      {msg.role === 'user' ? (
                        <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-gradient-to-br from-accent to-pink-500 flex items-center justify-center text-white text-xs font-medium">
                          U
                        </div>
                      ) : (
                        <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center text-sm md:text-base">
                          {currentAgent.avatar}
                        </div>
                      )}
                    </div>
                    <div
                      className={cn(
                        'max-w-[75%] md:max-w-xl px-3 py-2 md:px-4 md:py-3 rounded-2xl',
                        msg.role === 'user'
                          ? 'bg-accent text-white rounded-tr-sm'
                          : 'bg-white border border-border rounded-tl-sm'
                      )}
                    >
                      <p
                        className={cn(
                          'text-sm whitespace-pre-wrap leading-relaxed',
                          msg.role === 'user'
                            ? 'text-white'
                            : 'text-text-primary'
                        )}
                      >
                        {msg.content}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="border-t border-border bg-white p-3 md:p-4 pb-[calc(12px+env(safe-area-inset-bottom))] md:pb-4">
              <div className="max-w-3xl mx-auto">
                <div className="flex items-end gap-2 md:gap-3 bg-bg-secondary rounded-2xl border border-border p-2 md:p-2 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent transition-all">
                  <button
                    onClick={handleAttachFile}
                    className="p-2 text-text-tertiary hover:text-text-primary transition-colors active:scale-[0.98] min-w-[44px] min-h-[44px] flex items-center justify-center md:min-w-0 md:min-h-0"
                    title="添加附件"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  <textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="输入消息..."
                    rows={1}
                    className="flex-1 bg-transparent resize-none outline-none text-sm text-text-primary placeholder:text-text-tertiary py-2 md:py-2 max-h-32 leading-relaxed"
                    style={{ height: 'auto', minHeight: '24px' }}
                  />
                  <button
                    onClick={handleMicClick}
                    className="p-2 text-text-tertiary hover:text-text-primary transition-colors active:scale-[0.98] min-w-[44px] min-h-[44px] flex items-center justify-center md:min-w-0 md:min-h-0"
                    title="语音输入"
                  >
                    <Mic className="w-5 h-5" />
                  </button>
                  <button
                    onClick={handleSend}
                    disabled={!inputValue.trim()}
                    className={cn(
                      'p-2 rounded-xl transition-colors active:scale-[0.98] min-w-[44px] min-h-[44px] flex items-center justify-center md:min-w-0 md:min-h-0',
                      inputValue.trim()
                        ? 'bg-accent hover:bg-accent-hover text-white'
                        : 'bg-bg-tertiary text-text-tertiary cursor-not-allowed'
                    )}
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-xs text-text-tertiary text-center mt-2">
                  Agent 可能会产生错误的信息，请仔细核实
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center px-4">
              <div className="w-16 h-16 rounded-full bg-bg-tertiary flex items-center justify-center mx-auto mb-4">
                <Bot className="w-8 h-8 text-text-tertiary" />
              </div>
              <h3 className="text-lg font-medium text-text-primary mb-1">选择一个 Agent</h3>
              <p className="text-sm text-text-secondary md:hidden">从底部Tab选择一个 Agent 开始对话</p>
              <p className="text-sm text-text-secondary hidden md:block">从左侧列表选择一个 Agent 开始对话</p>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Bottom Tab Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-border z-40" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center justify-around h-[60px]">
          {agents.slice(0, 4).map((agent) => (
            <button
              key={agent.id}
              onClick={() => handleAgentSelect(agent.id)}
              className={cn(
                'flex flex-col items-center justify-center flex-1 h-full transition-colors active:scale-[0.98]',
                selectedAgent === agent.id
                  ? 'text-accent'
                  : 'text-text-tertiary'
              )}
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center text-sm mb-1">
                {agent.avatar}
              </div>
              <span className="text-[10px] line-clamp-1 max-w-[60px]">{agent.name}</span>
            </button>
          ))}
          <button
            onClick={() => setShowMobileAgents(true)}
            className="flex flex-col items-center justify-center flex-1 h-full text-text-tertiary active:scale-[0.98]"
          >
            <div className="w-7 h-7 rounded-full bg-bg-tertiary flex items-center justify-center mb-1">
              <MoreHorizontal className="w-4 h-4" />
            </div>
            <span className="text-[10px]">更多</span>
          </button>
        </div>
      </div>

      {/* Mobile Agents Sheet */}
      {showMobileAgents && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50 transition-opacity"
            onClick={() => setShowMobileAgents(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[70vh] flex flex-col" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-text-primary">我的 Agent</h2>
                <button
                  onClick={() => setShowMobileAgents(false)}
                  className="p-2 text-text-tertiary hover:text-text-primary active:scale-[0.98]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <button
                onClick={() => {
                  setShowMobileAgents(false);
                  handleOpenCreate();
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 mb-3 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors active:scale-[0.98]"
              >
                <Plus className="w-4 h-4" />
                新建 Agent
              </button>
              <div className="relative">
                <input
                  type="text"
                  placeholder="搜索 Agent..."
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-bg-secondary"
                />
                <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredAgents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => handleAgentSelect(agent.id)}
                  className={cn(
                    'w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors active:scale-[0.98]',
                    selectedAgent === agent.id
                      ? 'bg-accent-bg'
                      : 'hover:bg-bg-secondary'
                  )}
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center text-xl flex-shrink-0">
                    {agent.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-text-primary text-sm mb-0.5">
                      {agent.name}
                    </div>
                    <div className="text-xs text-text-tertiary line-clamp-2">
                      {agent.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="p-3 border-t border-border">
              <button
                onClick={() => {
                  setShowMobileAgents(false);
                  setDrawer('manage');
                }}
                className="w-full flex items-center gap-2 px-3 py-3 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-md transition-colors active:scale-[0.98]"
              >
                <Settings className="w-4 h-4" />
                管理 Agent
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Drawer */}
      {drawer === 'settings' && currentAgent && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(null)} />
          <div className="relative w-full sm:w-96 bg-white h-full flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-accent" />
                <h3 className="font-semibold text-text-primary">编辑 Agent</h3>
              </div>
              <button
                onClick={() => setDrawer(null)}
                className="p-1.5 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderAgentForm(editForm, (updates) => setEditForm((prev) => ({ ...prev, ...updates })), false)}
            <div className="p-4 border-t border-border flex gap-2 flex-shrink-0">
              <button
                onClick={() => handleDeleteAgent(currentAgent.id)}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm text-red-500 hover:bg-red-50 rounded-md transition-colors active:scale-[0.98]"
              >
                <Trash2 className="w-4 h-4" />
                删除
              </button>
              <button
                onClick={handleSaveSettings}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors active:scale-[0.98]"
              >
                <Check className="w-4 h-4" />
                保存设置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Drawer */}
      {drawer === 'create' && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(null)} />
          <div className="relative w-full sm:w-96 bg-white h-full flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-accent" />
                <h3 className="font-semibold text-text-primary">新建 Agent</h3>
              </div>
              <button
                onClick={() => setDrawer(null)}
                className="p-1.5 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderAgentForm(createForm, (updates) => setCreateForm((prev) => ({ ...prev, ...updates })), true)}
            <div className="p-4 border-t border-border flex-shrink-0">
              <button
                onClick={handleCreateAgent}
                disabled={!createForm.name.trim()}
                className={cn(
                  'w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium rounded-md transition-colors active:scale-[0.98]',
                  createForm.name.trim()
                    ? 'text-white bg-accent hover:bg-accent-hover'
                    : 'bg-bg-tertiary text-text-tertiary cursor-not-allowed'
                )}
              >
                <Plus className="w-4 h-4" />
                创建 Agent
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Drawer */}
      {drawer === 'manage' && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(null)} />
          <div className="relative w-full sm:w-96 bg-white h-full flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-accent" />
                <h3 className="font-semibold text-text-primary">管理 Agent</h3>
              </div>
              <button
                onClick={() => setDrawer(null)}
                className="p-1.5 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              <button
                onClick={() => {
                  setDrawer(null);
                  handleOpenCreate();
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 mb-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors active:scale-[0.98]"
              >
                <Plus className="w-4 h-4" />
                新建 Agent
              </button>
              {filteredAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-bg-secondary/50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center text-xl flex-shrink-0">
                    {agent.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-text-primary text-sm truncate">{agent.name}</div>
                    <div className="text-xs text-text-tertiary truncate">{agent.model}</div>
                  </div>
                  <button
                    onClick={() => handleCopyAgentId(agent)}
                    className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors"
                    title="复制 ID"
                  >
                    {copiedId === agent.id ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDuplicateAgent(agent)}
                    className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors"
                    title="复制 Agent"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      setSelectedAgent(agent.id);
                      setDrawer(null);
                      handleOpenSettings();
                    }}
                    className="p-1.5 text-text-tertiary hover:text-accent hover:bg-bg-hover rounded-md transition-colors"
                    title="编辑"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteAgent(agent.id)}
                    className="p-1.5 text-text-tertiary hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* More Actions Menu */}
      {drawer === 'more' && currentAgent && (
        <div className="fixed inset-0 z-[60]" onClick={() => setDrawer(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute right-4 top-16 bg-white rounded-lg shadow-xl border border-border py-1 min-w-[200px]">
            <button
              onClick={() => {
                setDrawer(null);
                handleOpenSettings();
              }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-text-primary hover:bg-bg-secondary transition-colors"
            >
              <Edit3 className="w-4 h-4" />
              编辑 Agent
            </button>
            <button
              onClick={() => {
                setDrawer(null);
                handleDuplicateAgent(currentAgent);
              }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-text-primary hover:bg-bg-secondary transition-colors"
            >
              <Copy className="w-4 h-4" />
              复制 Agent
            </button>
            <button
              onClick={() => {
                setDrawer(null);
                handleCopyAgentId(currentAgent);
              }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-text-primary hover:bg-bg-secondary transition-colors"
            >
              {copiedId === currentAgent.id ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              {copiedId === currentAgent.id ? '已复制 ID' : '复制 Agent ID'}
            </button>
            <div className="border-t border-border my-1" />
            <button
              onClick={() => {
                setDrawer(null);
                handleDeleteAgent(currentAgent.id);
              }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              删除 Agent
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}
