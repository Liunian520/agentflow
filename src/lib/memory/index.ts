/**
 * MemoryManager — 统一记忆架构入口
 *
 * 协调四层记忆（L0/L1/L2/L3）+ 三个横切机制（Auto Extraction / Auto Dream / Dynamic Recall）
 * 提供生命周期钩子（onSessionStart / onTurnComplete / onLLMCall / onSessionEnd）
 */

import type {
  ChatMessage,
  DreamLog,
  HandoffSummary,
} from '../../types';
import { useStore } from '../../store/useStore';
import {
  createSessionMemory,
  quickUpdateFromMessages,
  formatSessionMemoryForInjection,
} from './sessionMemory';
import {
  trimFactualMemoryCapacity,
} from './factualMemory';
import { dynamicRecallAll, dynamicRecallAllWithLLM } from './dynamicRecall';
import { compactConversation, shouldCompactMessages } from './contextCompactor';
import { extractFactsWithLLM } from './autoExtraction';
import { runAutoDream, canRunDream } from './autoDream';

class MemoryManager {
  private static instance: MemoryManager | null = null;

  static getInstance(): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
    }
    return MemoryManager.instance;
  }

  // ===== 生命周期钩子 =====

  /** 会话开始：创建 Session Memory */
  onSessionStart(sessionId: string): void {
    const store = useStore.getState();
    const existing = store.sessionMemories[sessionId];

    if (!existing) {
      const newMemory = createSessionMemory(sessionId);
      store.setSessionMemory(sessionId, newMemory);

      // 审计
      store.addMemoryAudit({
        layer: 'L0',
        action: 'create',
        targetId: sessionId,
        targetType: 'SessionMemory',
        source: 'auto',
      });
    }
  }

  /** 每轮对话完成：触发 Auto Extraction + Session Memory 更新 */
  async onTurnComplete(sessionId: string, messages: ChatMessage[]): Promise<void> {
    const store = useStore.getState();
    const sessionMemory = store.sessionMemories[sessionId];

    if (sessionMemory) {
      // 快路径更新 Session Memory
      const updated = quickUpdateFromMessages(sessionMemory, messages);
      store.setSessionMemory(sessionId, updated);
    }

    // L1 容量管理：如果超出上限，自动修剪
    if (store.factualMemory.length > 0) {
      const trimmed = trimFactualMemoryCapacity(store.factualMemory);
      if (trimmed.length !== store.factualMemory.length) {
        store.setFactualMemory(trimmed);
        store.addMemoryAudit({
          layer: 'L1',
          action: 'prune',
          targetId: 'capacity_trim',
          targetType: 'FactualMemory',
          after: `trimmed from ${store.factualMemory.length} to ${trimmed.length}`,
          source: 'auto',
        });
      }
    }

    // Auto Extraction: fire-and-forget 从当轮对话中提取事实到 L1
    // 使用 LLM 提取（降级到关键词规则）
    extractFactsWithLLM(messages, sessionId).catch(() => {
      // 提取失败不影响主流程（fire-and-forget）
    });
  }

  /**
   * LLM 调用前：注入 Dynamic Recall + 检查上下文压缩
   *
   * 返回：
   * - recalledContext: 动态召回的上下文（注入到 user message）
   * - compactedMessages: 压缩后的消息列表（如果触发了压缩）
   * - sessionMemoryContext: Session Memory 上下文（注入到 system message 最前）
   */
  async onLLMCall(
    sessionId: string,
    query: string,
    messages: ChatMessage[],
    maxTokens: number = 8000
  ): Promise<{
    recalledContext: string;
    compactedMessages?: ChatMessage[];
    sessionMemoryContext: string;
    handoffSummary?: HandoffSummary;
  }> {
    const store = useStore.getState();

    // 1. Dynamic Recall — 从 L1/L2-A 按需召回（LLM 挑选版）
    // 尝试 LLM 挑选，失败时自动降级为关键词版
    const { recalledContext, factualResult } = await dynamicRecallAllWithLLM(
      query,
      store.factualMemory,
      store.experienceBank
    ).catch(() =>
      // 降级兜底：LLM 失败时使用关键词版
      dynamicRecallAll(query, store.factualMemory, store.experienceBank)
    );

    // 标记被召回的 L1 记忆为已访问
    for (const m of factualResult.selected) {
      store.incrementFactualAccess(m.id);
    }

    // 2. Session Memory 上下文
    const sessionMemory = store.sessionMemories[sessionId];
    const sessionMemoryContext = sessionMemory
      ? formatSessionMemoryForInjection(sessionMemory)
      : '';

    // 3. 上下文压缩检查
    let compactedMessages: ChatMessage[] | undefined;
    let handoffSummary: HandoffSummary | undefined;

    if (shouldCompactMessages(messages, maxTokens)) {
      const result = compactConversation(
        messages,
        maxTokens,
        sessionMemory,
        sessionId
      );
      compactedMessages = result.compactedMessages;
      handoffSummary = result.handoffSummary;

      // 记录 Handoff Summary
      store.addHandoffSummary(handoffSummary);

      // 审计
      store.addMemoryAudit({
        layer: 'L0',
        action: 'update',
        targetId: sessionId,
        targetType: 'SessionMemory',
        after: `compact: method=${result.method}, compacted=${handoffSummary.compactedMessageCount}, preserved=${handoffSummary.preservedMessageCount}`,
        source: 'auto',
      });
    }

    return {
      recalledContext,
      compactedMessages,
      sessionMemoryContext,
      handoffSummary,
    };
  }

  /** 会话结束：清理 Session Memory */
  onSessionEnd(sessionId: string): void {
    const store = useStore.getState();
    store.clearSessionMemory(sessionId);

    // 审计
    store.addMemoryAudit({
      layer: 'L0',
      action: 'delete',
      targetId: sessionId,
      targetType: 'SessionMemory',
      source: 'auto',
    });
  }

  // ===== 手动触发 =====

  /** 手动触发 Auto Dream */
  async runDream(): Promise<DreamLog> {
    const gateCheck = canRunDream();
    if (!gateCheck.allowed) {
      // 返回一个记录门控拒绝的日志
      const rejectLog: DreamLog = {
        id: `dream-${Date.now()}`,
        timestamp: new Date().toISOString(),
        phase: 'orientation',
        summary: `Dream 被门控拒绝: ${gateCheck.reason}`,
        changes: { factualMerged: 0, factualPruned: 0, tracesConsolidated: 0, reflectionsMerged: 0 },
        duration: 0,
      };
      useStore.getState().addDreamLog(rejectLog);
      return rejectLog;
    }

    return runAutoDream();
  }

  // ===== 统计 =====

  /** 获取记忆架构各层的统计信息 */
  getMemoryStats(): {
    L0: { sessions: number; totalTokens: number };
    L1: { entries: number; totalSize: number; byType: Record<string, number> };
    L2A: { traces: number; successes: number; failures: number };
    L2B: { reflections: number };
    L2C: { version: number };
    L3: { records: number };
  } {
    const store = useStore.getState();

    // L0 统计
    const sessionKeys = Object.keys(store.sessionMemories);
    const l0Tokens = sessionKeys.reduce((sum, key) => {
      const mem = store.sessionMemories[key];
      // 重新估算 token
      let t = 0;
      for (const content of Object.values(mem.sections)) {
        // 简单估算
        t += Math.ceil(content.length / 4);
      }
      return sum + t;
    }, 0);

    // L1 统计
    const l1ByType: Record<string, number> = {};
    for (const m of store.factualMemory) {
      l1ByType[m.type] = (l1ByType[m.type] || 0) + 1;
    }
    const l1Size = store.factualMemory.reduce(
      (sum, m) => sum + JSON.stringify(m).length, 0
    );

    // L2-A 统计
    const l2aSuccesses = store.experienceBank.filter(t => t.outcome === 'success').length;
    const l2aFailures = store.experienceBank.filter(t => t.outcome === 'failure').length;

    return {
      L0: { sessions: sessionKeys.length, totalTokens: l0Tokens },
      L1: { entries: store.factualMemory.length, totalSize: l1Size, byType: l1ByType },
      L2A: { traces: store.experienceBank.length, successes: l2aSuccesses, failures: l2aFailures },
      L2B: { reflections: store.experientialReflections.length },
      L2C: { version: store.metaSkill.version },
      L3: { records: store.routerMemory.length },
    };
  }
}

// 导出单例获取函数
export const getMemoryManager = () => MemoryManager.getInstance();
export { MemoryManager };
