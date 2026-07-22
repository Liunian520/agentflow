/**
 * Auto Dream — 跨会话记忆整合（tengu_onyx_plover）
 *
 * 参考：Claude Code Auto Dream 四阶段：
 *   Orientation(扫描全量) → Gather Signal(grep 窄搜索冲突/重复/过期/相对日期)
 *   → Consolidation(合并/去重/绝对日期/traces→Reflections) → Prune(修剪索引≤200条)
 *
 * 三重门控：时间≥24h + 会话≥5 + PID锁（防止并发）
 * 手动入口：`/dream` 斜杠命令
 *
 * 降级兜底：LLM 失败时仅执行规则化操作（去重/修剪/日期转换）
 */

import type {
  FactualMemory,
  ExperientialReflection,
  ExecutionTrace,
  DreamLog,
} from '../../types';
import { useStore } from '../../store/useStore';
import { routedChatLLM } from '../../api/llmApi';
import { extractTaskFeatures } from '../modelRouter';
import {
  computeJaccardSimilarity,
  trimFactualMemoryCapacity,
} from './factualMemory';
import { L1_MAX_ENTRIES, L2A_MAX_TRACES, L2B_MAX_REFLECTIONS, DREAM_MIN_INTERVAL_MS, DREAM_MIN_SESSIONS } from './types';

// ===== PID 锁（防止并发 Dream） =====

let dreamPidLock = false;

function acquireDreamLock(): boolean {
  if (dreamPidLock) return false;
  dreamPidLock = true;
  return true;
}

function releaseDreamLock(): void {
  dreamPidLock = false;
}

// ===== 三重门控 =====

/** 三重门控检查：时间间隔 ≥ 24h + 会话数 ≥ 5 + PID 锁 */
export function canRunDream(): { allowed: boolean; reason?: string } {
  const store = useStore.getState();

  // 门控 1：时间间隔 ≥ 24h（检查最后一次 Dream 的时间）
  const lastDream = store.dreamLogs[store.dreamLogs.length - 1];
  if (lastDream) {
    const elapsed = Date.now() - new Date(lastDream.timestamp).getTime();
    if (elapsed < DREAM_MIN_INTERVAL_MS) {
      return {
        allowed: false,
        reason: `距上次 Dream 仅 ${(elapsed / 3600000).toFixed(1)}h，需 ≥ 24h`,
      };
    }
  }

  // 门控 2：累积会话数 ≥ 5（检查 extractionCursors 的数量）
  const sessionCount = Object.keys(store.extractionCursors).length;
  if (sessionCount < DREAM_MIN_SESSIONS) {
    return {
      allowed: false,
      reason: `仅积累 ${sessionCount} 个会话，需 ≥ ${DREAM_MIN_SESSIONS}`,
    };
  }

  // 门控 3：PID 锁（防止并发）
  if (!acquireDreamLock()) {
    return {
      allowed: false,
      reason: 'Dream 正在运行中（PID锁），请稍后再试',
    };
  }

  return { allowed: true };
}

// ===== Phase 1: Orientation（扫描全量） =====

/** Orientation：扫描所有 L1/L2 记忆，统计总量和信号 */
function orientation(): {
  factualCount: number;
  traceCount: number;
  reflectionCount: number;
  factualByType: Record<string, number>;
  signals: string[];
} {
  const store = useStore.getState();

  const factualByType: Record<string, number> = {};
  for (const m of store.factualMemory) {
    factualByType[m.type] = (factualByType[m.type] || 0) + 1;
  }

  // 简单信号检测：容量接近上限
  const signals: string[] = [];
  if (store.factualMemory.length >= L1_MAX_ENTRIES * 0.8) {
    signals.push('L1 容量接近上限');
  }
  if (store.experienceBank.length >= L2A_MAX_TRACES * 0.8) {
    signals.push('L2-A Traces 容量接近上限');
  }

  return {
    factualCount: store.factualMemory.length,
    traceCount: store.experienceBank.length,
    reflectionCount: store.experientialReflections.length,
    factualByType,
    signals,
  };
}

// ===== Phase 2: Gather Signal（grep 窄搜索） =====

/** Gather Signal：检测冲突、重复、过期、相对日期 */
function gatherSignal(
  factualMemories: FactualMemory[],
  traces: ExecutionTrace[]
): {
  duplicates: Array<{ ids: string[]; similarity: number }>;
  conflicts: Array<{ id: string; conflictingId: string; reason: string }>;
  stale: FactualMemory[];
  relativeDates: FactualMemory[];
  oldTraces: ExecutionTrace[];
} {
  const now = Date.now();

  // 1. 重复检测（Jaccard ≥ 0.7）
  const duplicates: Array<{ ids: string[]; similarity: number }> = [];
  const processed = new Set<string>();

  for (let i = 0; i < factualMemories.length; i++) {
    if (processed.has(factualMemories[i].id)) continue;
    const group: string[] = [factualMemories[i].id];

    for (let j = i + 1; j < factualMemories.length; j++) {
      if (processed.has(factualMemories[j].id)) continue;
      const sim = computeJaccardSimilarity(
        factualMemories[i].keywords,
        factualMemories[j].keywords
      );
      if (sim >= 0.7) {
        group.push(factualMemories[j].id);
        processed.add(factualMemories[j].id);
      }
    }

    if (group.length > 1) {
      duplicates.push({
        ids: group,
        similarity: computeJaccardSimilarity(
          factualMemories[i].keywords,
          factualMemories.find(m => m.id === group[1])?.keywords || []
        ),
      });
    }
  }

  // 2. 冲突检测（同类型中内容矛盾）
  const conflicts: Array<{ id: string; conflictingId: string; reason: string }> = [];
  const feedbackMemories = factualMemories.filter(m => m.type === 'feedback');

  for (let i = 0; i < feedbackMemories.length; i++) {
    for (let j = i + 1; j < feedbackMemories.length; j++) {
      // 简单规则：如果两条 feedback 都包含否定词且内容相似，视为冲突
      const negationWords = ['不要', '别', '避免', 'never', 'avoid', '不喜欢'];
      const aHasNeg = negationWords.some(w => feedbackMemories[i].content.includes(w));
      const bHasNeg = negationWords.some(w => feedbackMemories[j].content.includes(w));

      if (aHasNeg && !bHasNeg) {
        const sim = computeJaccardSimilarity(
          feedbackMemories[i].keywords,
          feedbackMemories[j].keywords
        );
        if (sim > 0.3) {
          conflicts.push({
            id: feedbackMemories[i].id,
            conflictingId: feedbackMemories[j].id,
            reason: '偏好冲突：一条否定一条肯定',
          });
        }
      }
    }
  }

  // 3. 过期检测（超过 90 天未访问）
  const stale = factualMemories.filter(m => {
    const lastAccess = m.lastAccessedAt || m.updatedAt;
    const age = (now - new Date(lastAccess).getTime()) / (24 * 3600 * 1000);
    return age > 90;
  });

  // 4. 相对日期检测（包含"昨天"、"上周"等相对日期词）
  const relativeDateWords = ['昨天', '上周', '上周一', 'last week', 'yesterday', 'recently', '最近'];
  const relativeDates = factualMemories.filter(m =>
    relativeDateWords.some(w => m.content.toLowerCase().includes(w.toLowerCase()))
  );

  // 5. 旧 Traces（超过 30 天的）
  const oldTraces = traces.filter(t => {
    const age = (now - new Date(t.timestamp).getTime()) / (24 * 3600 * 1000);
    return age > 30;
  });

  return { duplicates, conflicts, stale, relativeDates, oldTraces };
}

// ===== Phase 3: Consolidation（合并/去重/绝对日期/traces→Reflections） =====

/** Consolidation：执行合并、去重、日期转换、Traces→Reflections */
async function consolidation(
  factualMemories: FactualMemory[],
  _traces: ExecutionTrace[],
  signals: ReturnType<typeof gatherSignal>
): Promise<{
  mergedFactual: FactualMemory[];
  newReflections: ExperientialReflection[];
  factualMerged: number;
  factualPruned: number;
  tracesConsolidated: number;
  reflectionsMerged: number;
}> {
  const store = useStore.getState();
  let factualMerged = 0;
  let factualPruned = 0;
  let tracesConsolidated = 0;
  let reflectionsMerged = 0;

  let memories = [...factualMemories];

  // 1. 合并重复组
  for (const dup of signals.duplicates) {
    const groupMemories = dup.ids
      .map(id => memories.find(m => m.id === id))
      .filter(Boolean) as FactualMemory[];

    if (groupMemories.length < 2) continue;

    // 合并为一条：取最重要的那条 + 补充其他条的内容
    const primary = groupMemories.reduce((best, m) =>
      m.importance > best.importance ? m : best, groupMemories[0]);

    const mergedContent = groupMemories
      .map(m => m.content)
      .filter(c => c !== primary.content)
      .reduce((acc, c) => {
        // 只补充不重复的内容片段
        if (!acc.includes(c.slice(0, 50))) {
          return `${acc}；${c}`;
        }
        return acc;
      }, primary.content)
      .slice(0, 200);

    const mergedKeywords = [...new Set(groupMemories.flatMap(m => m.keywords))];
    const merged: FactualMemory = {
      ...primary,
      content: mergedContent,
      keywords: mergedKeywords,
      importance: Math.max(...groupMemories.map(m => m.importance)),
      updatedAt: new Date().toISOString(),
      source: 'auto_dream',
    };

    // 替换重复组为合并结果
    memories = memories.filter(m => !dup.ids.includes(m.id));
    memories.push(merged);
    factualMerged += groupMemories.length - 1;
  }

  // 2. 解决冲突（保留最新的那条）
  for (const conflict of signals.conflicts) {
    const a = memories.find(m => m.id === conflict.id);
    const b = memories.find(m => m.id === conflict.conflictingId);
    if (!a || !b) continue;

    // 保留更新时间更晚的
    const toRemove = new Date(a.updatedAt) > new Date(b.updatedAt) ? b : a;
    memories = memories.filter(m => m.id !== toRemove.id);
    factualPruned++;
  }

  // 3. 转换相对日期为绝对日期（规则化降级）
  for (const m of signals.relativeDates) {
    const target = memories.find(fm => fm.id === m.id);
    if (!target) continue;

    // 简单替换：将"昨天"替换为创建日期前一天，"上周"替换为创建日期前7天
    let content = target.content;
    const createdDate = new Date(target.createdAt);

    const relativeMap: Record<string, string> = {
      '昨天': new Date(createdDate.getTime() - 24 * 3600 * 1000).toLocaleDateString('zh-CN'),
      '上周': new Date(createdDate.getTime() - 7 * 24 * 3600 * 1000).toLocaleDateString('zh-CN'),
      'recently': `as of ${createdDate.toLocaleDateString('en-US')}`,
      '最近': `截至${createdDate.toLocaleDateString('zh-CN')}`,
    };

    for (const [rel, abs] of Object.entries(relativeMap)) {
      content = content.replace(rel, abs);
    }

    target.content = content;
    target.updatedAt = new Date().toISOString();
    target.source = 'auto_dream';
  }

  // 4. 旧 Traces → Reflections（LLM 蒸馏）
  if (signals.oldTraces.length > 0) {
    try {
      // LLM 蒸馏：将多条 Traces 总结为一条 Reflection
      const traceSummary = signals.oldTraces
        .slice(0, 20) // 最多处理 20 条
        .map(t => `[${t.outcome}] "${t.userInput.slice(0, 50)}" → ${t.outcome}`)
        .join('\n');

      const taskFeatures = extractTaskFeatures(traceSummary);
      const reflectionResult = await routedChatLLM(
        {
          messages: [
            {
              role: 'system',
              content: '你是经验蒸馏引擎。从多条执行轨迹中提炼出可复用的经验教训，输出 JSON：{ "summary": "一句话总结", "principles": ["原则1", "原则2"], "trigger": "触发场景描述" }',
            },
            {
              role: 'user',
              content: `从以下历史执行轨迹中提炼经验教训：\n${traceSummary}`,
            },
          ],
          temperature: 0.3,
          maxTokens: 500,
        },
        { ...taskFeatures, category: 'dream_consolidation' }
      );

      if (reflectionResult.success && reflectionResult.content) {
        try {
          const jsonMatch = reflectionResult.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const reflection: ExperientialReflection = {
              id: `ref-${Date.now()}`,
              timestamp: new Date().toISOString(),
              trigger: parsed.trigger || 'consolidation from old traces',
              summary: parsed.summary || '',
              principles: parsed.principles || [],
              layer: 'general',
              basedOnTraceIds: signals.oldTraces.map(t => t.id),
              basedOnTraceCount: signals.oldTraces.length,
              consolidatedFromTraces: true,
            };

            // 写入 Store
            if (store.experientialReflections.length < L2B_MAX_REFLECTIONS) {
              store.setExperientialReflections([...store.experientialReflections, reflection]);
              reflectionsMerged++;
            }

            // 从 experienceBank 中移除已蒸馏的旧 traces
            tracesConsolidated = signals.oldTraces.length;
          }
        } catch {
          // JSON 解析失败 → 规则化降级
          const reflection: ExperientialReflection = {
            id: `ref-${Date.now()}`,
            timestamp: new Date().toISOString(),
            trigger: 'consolidation from old traces (fallback)',
            summary: `${signals.oldTraces.length} 条旧轨迹已蒸馏`,
            principles: ['失败模式应引起注意', '成功模式值得复用'],
            layer: 'general',
            basedOnTraceIds: signals.oldTraces.slice(0, 5).map(t => t.id),
            basedOnTraceCount: signals.oldTraces.length,
            consolidatedFromTraces: true,
          };

          if (store.experientialReflections.length < L2B_MAX_REFLECTIONS) {
            store.setExperientialReflections([...store.experientialReflections, reflection]);
            reflectionsMerged++;
          }
          tracesConsolidated = signals.oldTraces.length;
        }
      }
    } catch {
      // LLM 调用失败 → 规则化降级（不做蒸馏，只标记）
      tracesConsolidated = 0;
    }
  }

  // 5. 删除已蒸馏的旧 traces（从 experienceBank 中移除）
  if (tracesConsolidated > 0) {
    const consolidatedIds = signals.oldTraces.map(t => t.id);
    const remainingTraces = store.experienceBank.filter(t => !consolidatedIds.includes(t.id));
    store.setExperienceBank(remainingTraces);
  }

  return {
    mergedFactual: memories,
    newReflections: store.experientialReflections.slice(-3), // 最近新增的
    factualMerged,
    factualPruned,
    tracesConsolidated,
    reflectionsMerged,
  };
}

// ===== Phase 4: Prune（修剪索引 ≤ 上限） =====

/** Prune：修剪超出上限的记忆条目 */
function prune(
  factualMemories: FactualMemory[],
  reflections: ExperientialReflection[]
): {
  factualAfter: FactualMemory[];
  reflectionsAfter: ExperientialReflection[];
  factualPruned: number;
  reflectionsPruned: number;
} {
  let factualPruned = 0;
  let reflectionsPruned = 0;

  // L1 修剪：超出上限时按 importance×recency 删除最低 10%
  let factualAfter = factualMemories;
  if (factualAfter.length > L1_MAX_ENTRIES) {
    const trimmed = trimFactualMemoryCapacity(factualAfter);
    factualPruned = factualAfter.length - trimmed.length;
    factualAfter = trimmed;
  }

  // L2-B 修剪：超出上限时按时间排序删除最旧的
  let reflectionsAfter = reflections;
  if (reflectionsAfter.length > L2B_MAX_REFLECTIONS) {
    reflectionsAfter.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    reflectionsPruned = reflectionsAfter.length - L2B_MAX_REFLECTIONS;
    reflectionsAfter = reflectionsAfter.slice(0, L2B_MAX_REFLECTIONS);
  }

  return { factualAfter, reflectionsAfter, factualPruned, reflectionsPruned };
}

// ===== 完整 Dream 流程 =====

/** 运行完整的 Auto Dream 四阶段流程 */
export async function runAutoDream(): Promise<DreamLog> {
  const startTime = Date.now();
  const store = useStore.getState();

  try {
    // Phase 1: Orientation（扫描全量）
    orientation();

    // Phase 2: Gather Signal
    const signals = gatherSignal(store.factualMemory, store.experienceBank);

    // Phase 3: Consolidation
    const consolidationResult = await consolidation(
      store.factualMemory,
      store.experienceBank,
      signals
    );

    // 写入合并后的 L1
    store.setFactualMemory(consolidationResult.mergedFactual);

    // Phase 4: Prune
    const pruneResult = prune(
      consolidationResult.mergedFactual,
      store.experientialReflections
    );

    // 写入修剪后的 L1 和 L2-B
    store.setFactualMemory(pruneResult.factualAfter);
    if (pruneResult.reflectionsPruned > 0) {
      store.setExperientialReflections(pruneResult.reflectionsAfter);
    }

    // 生成 Dream Log
    const totalFactualPruned = consolidationResult.factualPruned + pruneResult.factualPruned;
    const dreamLog: DreamLog = {
      id: `dream-${Date.now()}`,
      timestamp: new Date().toISOString(),
      phase: 'prune', // 最终阶段
      summary: `Dream 完成: 合并${consolidationResult.factualMerged}条, 蒸馏${consolidationResult.tracesConsolidated}条Traces→Reflections, 修剪${totalFactualPruned}条L1+${pruneResult.reflectionsPruned}条L2-B`,
      changes: {
        factualMerged: consolidationResult.factualMerged,
        factualPruned: totalFactualPruned,
        tracesConsolidated: consolidationResult.tracesConsolidated,
        reflectionsMerged: consolidationResult.reflectionsMerged,
      },
      duration: Date.now() - startTime,
    };

    // 写入 Dream Log
    store.addDreamLog(dreamLog);

    // 审计
    store.addMemoryAudit({
      layer: 'L1',
      action: 'merge',
      targetId: 'auto_dream',
      targetType: 'FactualMemory',
      after: `merged ${consolidationResult.factualMerged}, pruned ${totalFactualPruned}`,
      source: 'dream',
    });

    return dreamLog;
  } finally {
    // 释放 PID 锁
    releaseDreamLock();
  }
}

// ===== `/dream` 斜杠命令入口 =====

/** `/dream` 命令处理：检查门控后运行 Dream */
export async function handleDreamCommand(): Promise<{
  success: boolean;
  message: string;
  log?: DreamLog;
}> {
  const gateCheck = canRunDream();

  if (!gateCheck.allowed) {
    return {
      success: false,
      message: `Dream 无法运行: ${gateCheck.reason}`,
    };
  }

  try {
    const log = await runAutoDream();
    return {
      success: true,
      message: `✅ Dream 完成: ${log.summary}（耗时 ${log.duration / 1000}s）`,
      log,
    };
  } catch (error: any) {
    releaseDreamLock();
    return {
      success: false,
      message: `Dream 执行失败: ${error.message}`,
    };
  }
}
