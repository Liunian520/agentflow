/**
 * MemoryService — 记忆服务接口
 *
 * 提供抽象的记忆存储接口，支持多种实现（内存、数据库、云端等）
 * 用于工作流节点的记忆读写操作
 */

export interface MemoryItem {
  id: string;
  key: string;
  value: any;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  metadata: Record<string, any>;
}

export interface MemorySearchOptions {
  limit?: number;
  tags?: string[];
  sortBy?: 'createdAt' | 'updatedAt' | 'key';
  sortOrder?: 'asc' | 'desc';
}

export interface MemoryListFilter {
  tags?: string[];
  keyPrefix?: string;
  limit?: number;
  offset?: number;
}

export interface MemoryService {
  save(key: string, value: any, metadata?: Record<string, any>, tags?: string[]): Promise<MemoryItem>;
  get(key: string): Promise<MemoryItem | null>;
  search(query: string, options?: MemorySearchOptions): Promise<MemoryItem[]>;
  update(key: string, updates: Partial<{ value: any; metadata: Record<string, any>; tags: string[] }>): Promise<MemoryItem | null>;
  delete(key: string): Promise<boolean>;
  list(filter?: MemoryListFilter): Promise<MemoryItem[]>;
}

function generateId(): string {
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function extractKeywords(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const lowerText = text.toLowerCase();
  const words = lowerText
    .replace(/[^\w\u4e00-\u9fa5\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

  const result = new Set<string>(words);

  const chineseChars = lowerText.match(/[\u4e00-\u9fa5]{2,}/g);
  if (chineseChars) {
    for (const chunk of chineseChars) {
      for (let i = 0; i < chunk.length - 1; i++) {
        result.add(chunk.slice(i, i + 2));
      }
      for (let i = 0; i < chunk.length - 2; i++) {
        result.add(chunk.slice(i, i + 3));
      }
    }
  }

  return [...result];
}

function computeSimilarity(queryKeywords: string[], itemKeywords: string[]): number {
  if (queryKeywords.length === 0 || itemKeywords.length === 0) return 0;
  const querySet = new Set(queryKeywords);
  const itemSet = new Set(itemKeywords);
  const intersection = new Set([...querySet].filter((x) => itemSet.has(x)));
  const union = new Set([...querySet, ...itemSet]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function computeSubstringScore(query: string, item: MemoryItem): number {
  const queryLower = query.toLowerCase();
  const searchTargets = [
    item.key,
    typeof item.value === 'string' ? item.value : '',
    ...item.tags,
    JSON.stringify(item.metadata),
  ];

  let maxScore = 0;
  for (const target of searchTargets) {
    const targetLower = String(target).toLowerCase();
    if (targetLower.includes(queryLower) && queryLower.length > 0) {
      const score = queryLower.length / Math.max(targetLower.length, 1);
      maxScore = Math.max(maxScore, Math.min(score * 2, 1));
    }
  }
  return maxScore;
}

function valueToKeywords(value: any): string[] {
  if (typeof value === 'string') {
    return extractKeywords(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (value && typeof value === 'object') {
    try {
      return extractKeywords(JSON.stringify(value));
    } catch {
      return [];
    }
  }
  return [];
}

export class InMemoryMemoryService implements MemoryService {
  private items: Map<string, MemoryItem> = new Map();
  private keyToId: Map<string, string> = new Map();

  async save(
    key: string,
    value: any,
    metadata: Record<string, any> = {},
    tags: string[] = []
  ): Promise<MemoryItem> {
    const now = new Date().toISOString();
    const existingId = this.keyToId.get(key);

    if (existingId) {
      const existing = this.items.get(existingId)!;
      const updated: MemoryItem = {
        ...existing,
        value,
        metadata: { ...existing.metadata, ...metadata },
        tags: [...new Set([...existing.tags, ...tags])],
        updatedAt: now,
      };
      this.items.set(existingId, updated);
      return updated;
    }

    const id = generateId();
    const item: MemoryItem = {
      id,
      key,
      value,
      createdAt: now,
      updatedAt: now,
      tags: [...tags],
      metadata: { ...metadata },
    };
    this.items.set(id, item);
    this.keyToId.set(key, id);
    return item;
  }

  async get(key: string): Promise<MemoryItem | null> {
    const id = this.keyToId.get(key);
    if (!id) return null;
    return this.items.get(id) || null;
  }

  async search(query: string, options: MemorySearchOptions = {}): Promise<MemoryItem[]> {
    const { limit = 10, tags, sortBy = 'updatedAt', sortOrder = 'desc' } = options;
    const queryKeywords = extractKeywords(query);

    let results = Array.from(this.items.values());

    if (tags && tags.length > 0) {
      results = results.filter((item) => tags.some((t) => item.tags.includes(t)));
    }

    if (query && query.trim().length > 0) {
      const scored = results.map((item) => {
        const itemKeywords = [
          ...extractKeywords(item.key),
          ...valueToKeywords(item.value),
          ...item.tags,
          ...valueToKeywords(item.metadata),
        ];
        const jaccardScore = queryKeywords.length > 0 ? computeSimilarity(queryKeywords, itemKeywords) : 0;
        const substringScore = computeSubstringScore(query, item);
        const score = Math.max(jaccardScore, substringScore);
        return { item, score };
      });
      scored.sort((a, b) => b.score - a.score);
      results = scored.filter((s) => s.score > 0.05).map((s) => s.item);
    } else {
      results = this.sortItems(results, sortBy, sortOrder);
    }

    return results.slice(0, limit);
  }

  async update(
    key: string,
    updates: Partial<{ value: any; metadata: Record<string, any>; tags: string[] }>
  ): Promise<MemoryItem | null> {
    const id = this.keyToId.get(key);
    if (!id) return null;

    const existing = this.items.get(id)!;
    const updated: MemoryItem = {
      ...existing,
      value: updates.value !== undefined ? updates.value : existing.value,
      metadata: updates.metadata ? { ...existing.metadata, ...updates.metadata } : existing.metadata,
      tags: updates.tags ? [...new Set([...existing.tags, ...updates.tags])] : existing.tags,
      updatedAt: new Date().toISOString(),
    };

    this.items.set(id, updated);
    return updated;
  }

  async delete(key: string): Promise<boolean> {
    const id = this.keyToId.get(key);
    if (!id) return false;
    this.items.delete(id);
    this.keyToId.delete(key);
    return true;
  }

  async list(filter: MemoryListFilter = {}): Promise<MemoryItem[]> {
    const { tags, keyPrefix, limit = 100, offset = 0 } = filter;
    let results = Array.from(this.items.values());

    if (tags && tags.length > 0) {
      results = results.filter((item) => tags.some((t) => item.tags.includes(t)));
    }

    if (keyPrefix) {
      results = results.filter((item) => item.key.startsWith(keyPrefix));
    }

    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return results.slice(offset, offset + limit);
  }

  private sortItems(items: MemoryItem[], sortBy: string, sortOrder: string): MemoryItem[] {
    return [...items].sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'key') {
        comparison = a.key.localeCompare(b.key);
      } else if (sortBy === 'createdAt') {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else {
        comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }

  clear(): void {
    this.items.clear();
    this.keyToId.clear();
  }

  size(): number {
    return this.items.size;
  }
}
