import { useState, useEffect, useCallback } from 'react';
import { generateId } from '../lib/utils';
import type { ChatMessage, ChatSession, AgentMode } from '../types';
import { getMemoryManager } from '../lib/memory';
import { fetchSessionMessages, pollTaskUntilDone } from '../api/llmApi';

const CHAT_SESSIONS_KEY = 'agentflow.chatSessions.v1';
const CHAT_ACTIVE_KEY = 'agentflow.chatActiveSession.v1';
const PENDING_TASKS_KEY = 'lnagent.pendingTasks.v1';

const DEFAULT_WELCOME_MSG: ChatMessage = {
  id: 'msg-welcome',
  role: 'assistant',
  content: `你好！我是 LNAgent 对话助手 🤖\n\n支持 **五种工作模式**（顶栏可一键切换）：\n\n- **规划** — 只分析不执行，想清楚再动手\n- **编码** — 执行需确认，安全可靠\n- **调试** — 自动诊断修复问题\n- **编排** — 协调多 Agent 并行执行\n- **问答** — 纯问答，不执行任何操作\n\n💡 你还可以 **上传文件/代码** 作为对话上下文，或 **选择项目目录** 让 AI 直接读写你的文件。\n\n输入 \`/help\` 查看所有斜杠命令，或试试下面的快捷建议 👇`,
  timestamp: new Date().toISOString(),
  messageType: 'text',
};

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(CHAT_SESSIONS_KEY);
    if (raw) return JSON.parse(raw) as ChatSession[];
  } catch {
    /* ignore */
  }
  return [
    {
      id: 'session-default',
      title: '新对话',
      messages: [DEFAULT_WELCOME_MSG],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: 'code',
    },
  ];
}

function loadActiveSessionId(): string {
  return localStorage.getItem(CHAT_ACTIVE_KEY) || 'session-default';
}

function loadPendingTasks(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PENDING_TASKS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string>;
  } catch {
    /* ignore */
  }
  return {};
}

function savePendingTasks(map: Record<string, string>): void {
  try {
    localStorage.setItem(PENDING_TASKS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function useChatSession(activeMode: AgentMode) {
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions);
  const [activeSessionId, setActiveSessionId] = useState<string>(loadActiveSessionId);
  const [pendingTasks, setPendingTasks] = useState<Record<string, string>>(loadPendingTasks);
  const [runningTaskIds, setRunningTaskIds] = useState<Set<string>>(new Set());

  // Persist sessions
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(sessions));
    } catch {
      /* ignore quota errors */
    }
  }, [sessions]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_ACTIVE_KEY, activeSessionId);
    } catch {
      /* ignore */
    }
  }, [activeSessionId]);

  useEffect(() => {
    savePendingTasks(pendingTasks);
  }, [pendingTasks]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeMessages = activeSession?.messages || [];

  // ===== Phase 1: 从服务端 KV 同步会话消息（KV 为 source of truth） =====
  const syncSessionFromServer = useCallback(async (sessionId: string) => {
    const serverMsgs = await fetchSessionMessages(sessionId);
    if (serverMsgs.length === 0) return;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        // 服务端消息数 > 本地 → 用服务端覆盖（断线期间云端落盘了新回复）
        if (serverMsgs.length > s.messages.length) {
          return { ...s, messages: serverMsgs as ChatMessage[], updatedAt: new Date().toISOString() };
        }
        return s;
      })
    );
  }, []);

  // ===== Phase 1: 记录/清除后台任务（用于断线后恢复） =====
  const setPendingTask = useCallback((sessionId: string, taskId: string) => {
    setPendingTasks((prev) => ({ ...prev, [sessionId]: taskId }));
    setRunningTaskIds((prev) => new Set(prev).add(taskId));
  }, []);

  const clearPendingTask = useCallback((sessionId: string) => {
    setPendingTasks((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  // ===== Phase 1: 恢复未完成的后台任务（挂载时调用） =====
  const resumePendingTasks = useCallback(async () => {
    const pending = loadPendingTasks();
    for (const [sessionId, taskId] of Object.entries(pending)) {
      setRunningTaskIds((prev) => new Set(prev).add(taskId));
      // 轮询直到完成
      pollTaskUntilDone(taskId, (status) => {
        if (status.status === 'done' || status.status === 'error') {
          setRunningTaskIds((prev) => {
            const next = new Set(prev);
            next.delete(taskId);
            return next;
          });
          clearPendingTask(sessionId);
          // 任务完成 → 从服务端拉取完整消息
          syncSessionFromServer(sessionId);
        }
      }).catch(() => {
        setRunningTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      });
    }
  }, [clearPendingTask, syncSessionFromServer]);

  // 挂载时：恢复活跃会话的服务端状态 + 恢复未完成任务
  useEffect(() => {
    syncSessionFromServer(activeSessionId);
    resumePendingTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSessionMessages = useCallback(
    (sessionId: string, messages: ChatMessage[]) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const firstUserMsg = messages.find((m) => m.role === 'user' && !m.content.startsWith('✅'));
          const title = firstUserMsg
            ? firstUserMsg.content.slice(0, 20) + (firstUserMsg.content.length > 20 ? '...' : '')
            : s.title;
          return { ...s, messages, title, updatedAt: new Date().toISOString(), mode: activeMode };
        })
      );
      // Phase 10: memory architecture — auto extraction + session memory update
      getMemoryManager().onTurnComplete(sessionId, messages).catch(() => {});
    },
    [activeMode]
  );

  const appendAssistantMessage = useCallback(
    (content: string, messageType: ChatMessage['messageType'] = 'text', metadata?: Record<string, any>) => {
      const msg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
        messageType,
        metadata,
      };
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeSessionId) return s;
          const firstUserMsg = s.messages.find((m) => m.role === 'user' && !m.content.startsWith('✅'));
          const title = firstUserMsg
            ? firstUserMsg.content.slice(0, 20) + (firstUserMsg.content.length > 20 ? '...' : '')
            : s.title;
          return { ...s, messages: [...s.messages, msg], title, updatedAt: new Date().toISOString(), mode: activeMode };
        })
      );
      return msg;
    },
    [activeSessionId, activeMode]
  );

  const handleNewSession = useCallback(() => {
    const newSession: ChatSession = {
      id: `session-${generateId()}`,
      title: '新对话',
      messages: [
        {
          id: `msg-${generateId()}`,
          role: 'assistant',
          content: '开始新的对话！告诉我你想做什么。\n\n输入 `/help` 查看所有命令。',
          timestamp: new Date().toISOString(),
          messageType: 'text',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: activeMode,
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    getMemoryManager().onSessionStart(newSession.id);
  }, [activeMode]);

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      getMemoryManager().onSessionEnd(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      clearPendingTask(sessionId);
      setActiveSessionId((prev) => {
        if (prev !== sessionId) return prev;
        const remaining = sessions.filter((s) => s.id !== sessionId);
        return remaining[0]?.id || 'session-default';
      });
    },
    [sessions, clearPendingTask]
  );

  const switchSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    // 切换会话时从服务端同步（可能该会话在别处有新消息）
    syncSessionFromServer(sessionId);
  }, [syncSessionFromServer]);

  return {
    sessions,
    activeSessionId,
    activeSession,
    activeMessages,
    setSessions,
    setActiveSessionId,
    updateSessionMessages,
    appendAssistantMessage,
    handleNewSession,
    handleDeleteSession,
    switchSession,
    // Phase 1: 持久化会话 / 断线恢复
    syncSessionFromServer,
    setPendingTask,
    clearPendingTask,
    runningTaskIds,
  };
}
