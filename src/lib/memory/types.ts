/**
 * Memory Architecture — 统一类型引用入口
 *
 * 所有记忆架构相关类型均定义在 src/types/index.ts，
 * 本文件仅做 re-export 便于 memory 子模块内部引用。
 */

import type { SessionSectionKey } from '../../types';

export type {
  SessionSectionKey,
  SessionMemory,
  FactualMemoryType,
  FactualMemory,
  ExperientialReflection,
  ExtractionResult,
  RecallResult,
  HandoffSummary,
  DreamLog,
  MemoryAuditEntry,
} from '../../types';

// 从现有类型中引用 L2-A / L3 相关类型（保持兼容）
export type {
  ExecutionTrace,    // L2-A: Traces
  MetaSkill,         // L2-C: Strategies
  RouterRecord,      // L3: Router Memory
  ChatMessage,
} from '../../types';

// ===== 记忆架构常量 =====

/** L0 Session Memory 10 个固定 section 的默认模板 */
export const DEFAULT_SESSION_SECTIONS: Record<SessionSectionKey, string> = {
  current_state: '尚未开始任务',
  task_spec: '',
  files: '',
  workflow: '',
  errors: '',
  learnings: '',
  key_results: '',
  worklog: '',
  pending: '',
  context_summary: '',
};

/** L0 Session Memory 触发 compact 的最低工具调用次数阈值 */
export const L0_COMPACT_TOOL_THRESHOLD = 3;

/** L0 Session Memory 预估 token 上限 */
export const L0_MAX_TOKEN_ESTIMATE = 12000;

/** L1 Factual Memory 最大条数 */
export const L1_MAX_ENTRIES = 200;

/** L1 Factual Memory 最大存储字节数 */
export const L1_MAX_SIZE_BYTES = 25 * 1024;

/** L2-A Traces 最大条数 */
export const L2A_MAX_TRACES = 200;

/** L2-B Reflections 最大条数 */
export const L2B_MAX_REFLECTIONS = 50;

/** Dynamic Recall 最大召回条数 */
export const RECALL_MAX_SELECTED = 5;

/** Dynamic Recall 前筛候选数量 */
export const RECALL_CANDIDATE_POOL = 20;

/** Context Compactor 触发阈值：预估 token 占容量百分比 */
export const COMPACT_TRIGGER_RATIO = 0.85;

/** Context Compactor 保留最近消息的 token 上限 */
export const COMPACT_PRESERVED_TOKENS = 20000;

/** Auto Dream 三重门控：最小间隔时间（ms） */
export const DREAM_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;  // 24h

/** Auto Dream 三重门控：最小会话数 */
export const DREAM_MIN_SESSIONS = 5;
