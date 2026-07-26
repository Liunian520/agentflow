/**
 * Self-Editing Memory — Agent 通过 function calling 自管理 L1 Factual Memory
 *
 * 参考：MemGPT/Letta Memory Blocks（Self-Editing：core_memory_append/replace/search/delete）
 * 参考：Claude Code 权限沙箱（Agent 只能读写 factualMemory，不能操作其他层）
 *
 * 4 个工具定义（OpenAI function calling schema）：
 * - memory_save: 创建新事实记忆
 * - memory_update: 更新已有事实记忆
 * - memory_search: 搜索事实记忆
 * - memory_delete: 删除事实记忆
 */

import type { FactualMemory, FactualMemoryType } from '../../types';
import { useStore } from '../../store/useStore';
import { extractKeywords, computeJaccardSimilarity } from './factualMemory';
import { L1_MAX_ENTRIES } from './types';

// ===== 工具 Schema 定义 =====

/** memory_save: 创建新事实记忆 */
export const MEMORY_SAVE_SCHEMA = {
  name: 'memory_save',
  description: '保存一条新的事实记忆。用于记住用户偏好、项目约定、重要事实等。如果内容与已有记忆重复，会自动合并。',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['user', 'feedback', 'project', 'reference'],
        description: '事实类型：user=用户偏好/身份, feedback=反馈/纠正, project=项目约定, reference=参考链接',
      },
      content: {
        type: 'string',
        description: '事实内容描述（≤200字）',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '简短关键词标签，便于后续检索（如 ["typescript", "函数式"]）',
      },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: '检索关键词（通常与 tags 一致即可）',
      },
      importance: {
        type: 'number',
        description: '重要程度 0-1（默认 0.7）',
      },
    },
    required: ['type', 'content'],
  },
};

/** memory_update: 更新已有事实记忆 */
export const MEMORY_UPDATE_SCHEMA = {
  name: 'memory_update',
  description: '更新一条已有的事实记忆。通过 ID 或内容搜索定位要更新的记忆条目。',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: '要更新的记忆 ID（如果已知）',
      },
      query: {
        type: 'string',
        description: '通过内容搜索定位要更新的记忆（当不知道 ID 时使用）',
      },
      content: {
        type: 'string',
        description: '新的内容描述',
      },
      importance: {
        type: 'number',
        description: '新的重要程度 0-1',
      },
    },
    required: ['content'],
  },
};

/** memory_search: 搜索事实记忆 */
export const MEMORY_SEARCH_SCHEMA = {
  name: 'memory_search',
  description: '搜索事实记忆。返回与查询最相关的记忆条目。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索查询内容',
      },
      type: {
        type: 'string',
        enum: ['user', 'feedback', 'project', 'reference'],
        description: '限定搜索类型（可选）',
      },
      limit: {
        type: 'number',
        description: '返回结果数上限（默认5）',
      },
    },
    required: ['query'],
  },
};

/** memory_delete: 删除事实记忆 */
export const MEMORY_DELETE_SCHEMA = {
  name: 'memory_delete',
  description: '删除一条事实记忆。通过 ID 定位要删除的记忆。',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: '要删除的记忆 ID',
      },
      query: {
        type: 'string',
        description: '通过内容搜索定位要删除的记忆（当不知道 ID 时使用，会删除最匹配的一条）',
      },
    },
    required: ['id'],
  },
};

/** 所有 Self-Editing 工具 schema 的集合 */
export const MEMORY_TOOL_SCHEMAS = [
  MEMORY_SAVE_SCHEMA,
  MEMORY_UPDATE_SCHEMA,
  MEMORY_SEARCH_SCHEMA,
  MEMORY_DELETE_SCHEMA,
];

// ===== 工具执行逻辑 =====

/** 执行 memory_save */
export function executeMemorySave(
  args: { type: FactualMemoryType; content: string; importance?: number }
): { success: boolean; message: string; memory?: FactualMemory } {
  const store = useStore.getState();

  // 容量检查
  if (store.factualMemory.length >= L1_MAX_ENTRIES) {
    return {
      success: false,
      message: `L1 Factual Memory 已达上限(${L1_MAX_ENTRIES}条)，请先删除旧记忆再保存`,
    };
  }

  const keywords = extractKeywords(args.content);

  // 去重检查
  const duplicates = store.factualMemory.filter((m) =>
    computeJaccardSimilarity(keywords, m.keywords) >= 0.7
  );

  if (duplicates.length > 0) {
    // 合并：更新已有记忆
    const existing = duplicates[0];
    const mergedContent = `${existing.content}\n补充: ${args.content}`;
    const mergedKeywords = [...new Set([...existing.keywords, ...keywords])];

    const updated: FactualMemory = {
      ...existing,
      content: mergedContent.slice(0, 200), // 限制长度
      keywords: mergedKeywords,
      importance: Math.max(existing.importance, args.importance || 0.7),
      updatedAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      source: 'user_edit',
    };

    store.setFactualMemory(
      store.factualMemory.map((m) => (m.id === existing.id ? updated : m))
    );
    store.addMemoryAudit({
      layer: 'L1',
      action: 'update',
      targetId: existing.id,
      targetType: 'FactualMemory',
      before: existing.content,
      after: updated.content,
      source: 'self_edit',
    });

    return {
      success: true,
      message: `与已有记忆合并（ID: ${existing.id})`,
      memory: updated,
    };
  }

  // 新建
  const memory: FactualMemory = {
    id: `fm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: args.type,
    content: args.content.slice(0, 200),
    tags: [],
    keywords,
    importance: args.importance || 0.7,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    accessCount: 0,
    lastAccessedAt: new Date().toISOString(),
    source: 'user_edit',
  };

  store.setFactualMemory([...store.factualMemory, memory]);
  store.addMemoryAudit({
    layer: 'L1',
    action: 'create',
    targetId: memory.id,
    targetType: 'FactualMemory',
    after: `type=${memory.type}, content=${memory.content}`,
    source: 'self_edit',
  });

  return {
    success: true,
    message: `已保存新记忆（ID: ${memory.id}, 类型: ${memory.type})`,
    memory,
  };
}

/** 执行 memory_update */
export function executeMemoryUpdate(
  args: { id?: string; query?: string; content?: string; importance?: number }
): { success: boolean; message: string; memory?: FactualMemory } {
  const store = useStore.getState();

  // 定位目标记忆
  let target: FactualMemory | undefined;

  if (args.id) {
    target = store.factualMemory.find((m) => m.id === args.id);
  } else if (args.query) {
    const queryKeywords = extractKeywords(args.query);
    const scored = store.factualMemory.map((m) => ({
      memory: m,
      score: computeJaccardSimilarity(queryKeywords, m.keywords),
    }));
    scored.sort((a, b) => b.score - a.score);
    target = scored[0]?.score > 0.3 ? scored[0].memory : undefined;
  }

  if (!target) {
    return {
      success: false,
      message: '未找到要更新的记忆条目。请提供 ID 或更精确的搜索内容。',
    };
  }

  // 更新字段
  const updated: FactualMemory = {
    ...target,
    content: args.content ? args.content.slice(0, 200) : target.content,
    keywords: args.content ? extractKeywords(args.content) : target.keywords,
    importance: args.importance !== undefined ? args.importance : target.importance,
    updatedAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
  };

  store.setFactualMemory(
    store.factualMemory.map((m) => (m.id === target.id ? updated : m))
  );
  store.addMemoryAudit({
    layer: 'L1',
    action: 'update',
    targetId: target.id,
    targetType: 'FactualMemory',
    before: target.content,
    after: updated.content,
    source: 'self_edit',
  });

  return {
    success: true,
    message: `已更新记忆（ID: ${target.id})`,
    memory: updated,
  };
}

/** 执行 memory_search */
export function executeMemorySearch(
  args: { query: string; type?: FactualMemoryType; limit?: number }
): { success: boolean; message: string; results: FactualMemory[] } {
  const store = useStore.getState();
  const queryKeywords = extractKeywords(args.query);
  const limit = args.limit || 5;

  let candidates = store.factualMemory;

  // 按类型过滤
  if (args.type) {
    candidates = candidates.filter((m) => m.type === args.type);
  }

  // Jaccard 相似度排序
  const scored = candidates.map((m) => ({
    memory: m,
    score: computeJaccardSimilarity(queryKeywords, m.keywords),
  }));
  scored.sort((a, b) => b.score - a.score);

  const results = scored
    .filter((s) => s.score > 0.1)
    .slice(0, limit)
    .map((s) => s.memory);

  // 更新被搜索到的记忆的 accessCount
  for (const m of results) {
    store.incrementFactualAccess(m.id);
  }

  return {
    success: true,
    message: `找到 ${results.length} 条相关记忆`,
    results,
  };
}

/** 执行 memory_delete */
export function executeMemoryDelete(
  args: { id: string; query?: string }
): { success: boolean; message: string } {
  const store = useStore.getState();

  let targetId = args.id;

  // 如果 id 不精确，通过 query 搜索定位
  if (!store.factualMemory.find((m) => m.id === targetId) && args.query) {
    const queryKeywords = extractKeywords(args.query);
    const scored = store.factualMemory.map((m) => ({
      memory: m,
      score: computeJaccardSimilarity(queryKeywords, m.keywords),
    }));
    scored.sort((a, b) => b.score - a.score);
    targetId = scored[0]?.score > 0.5 ? scored[0].memory.id : args.id;
  }

  const target = store.factualMemory.find((m) => m.id === targetId);
  if (!target) {
    return {
      success: false,
      message: `未找到记忆 ID: ${targetId}`,
    };
  }

  store.setFactualMemory(store.factualMemory.filter((m) => m.id !== targetId));
  store.addMemoryAudit({
    layer: 'L1',
    action: 'delete',
    targetId: targetId,
    targetType: 'FactualMemory',
    before: target.content,
    source: 'self_edit',
  });

  return {
    success: true,
    message: `已删除记忆（ID: ${targetId}, 内容: "${target.content.slice(0, 50)}")`,
  };
}

// ===== 工具路由器 =====

/** 根据工具名称路由到对应的执行函数 */
export function executeMemoryTool(
  toolName: string,
  args: Record<string, any>
): { success: boolean; message: string; data?: any } {
  switch (toolName) {
    case 'memory_save': {
      const result = executeMemorySave(args as any);
      return { ...result, data: result.memory };
    }
    case 'memory_update': {
      const result = executeMemoryUpdate(args as any);
      return { ...result, data: result.memory };
    }
    case 'memory_search': {
      const result = executeMemorySearch(args as any);
      return { ...result, message: result.message, data: result.results };
    }
    case 'memory_delete': {
      const result = executeMemoryDelete(args as any);
      return { ...result };
    }
    default:
      return {
        success: false,
        message: `未知的记忆工具: ${toolName}`,
      };
  }
}
