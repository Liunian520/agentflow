import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryMemoryService } from '../memory/memoryService';
import type { MemoryItem } from '../memory/memoryService';

describe('InMemoryMemoryService', () => {
  let service: InMemoryMemoryService;

  beforeEach(() => {
    service = new InMemoryMemoryService();
  });

  describe('save', () => {
    it('should save a new memory item', async () => {
      const item = await service.save('test_key', 'test_value');
      expect(item).toBeDefined();
      expect(item.key).toBe('test_key');
      expect(item.value).toBe('test_value');
      expect(item.id).toBeDefined();
      expect(item.createdAt).toBeDefined();
      expect(item.updatedAt).toBeDefined();
      expect(item.tags).toEqual([]);
      expect(item.metadata).toEqual({});
    });

    it('should save with metadata and tags', async () => {
      const item = await service.save('test_key', 'test_value', { source: 'test' }, ['tag1', 'tag2']);
      expect(item.metadata.source).toBe('test');
      expect(item.tags).toEqual(['tag1', 'tag2']);
    });

    it('should update existing item when saving same key', async () => {
      const item1 = await service.save('test_key', 'value1');
      const item2 = await service.save('test_key', 'value2');

      expect(item1.id).toBe(item2.id);
      expect(item2.value).toBe('value2');
      expect(item2.updatedAt >= item1.updatedAt).toBe(true);
      expect(service.size()).toBe(1);
    });

    it('should merge metadata and tags on update', async () => {
      await service.save('key', 'v1', { a: 1 }, ['tag1']);
      const updated = await service.save('key', 'v2', { b: 2 }, ['tag2']);

      expect(updated.metadata).toEqual({ a: 1, b: 2 });
      expect(updated.tags).toContain('tag1');
      expect(updated.tags).toContain('tag2');
    });
  });

  describe('get', () => {
    it('should return null for non-existent key', async () => {
      const result = await service.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should return the item for existing key', async () => {
      const saved = await service.save('mykey', { foo: 'bar' });
      const result = await service.get('mykey');

      expect(result).not.toBeNull();
      expect(result!.id).toBe(saved.id);
      expect(result!.value).toEqual({ foo: 'bar' });
    });
  });

  describe('update', () => {
    it('should return null for non-existent key', async () => {
      const result = await service.update('nonexistent', { value: 'test' });
      expect(result).toBeNull();
    });

    it('should update value', async () => {
      await service.save('key', 'old_value');
      const updated = await service.update('key', { value: 'new_value' });

      expect(updated).not.toBeNull();
      expect(updated!.value).toBe('new_value');
    });

    it('should update metadata', async () => {
      await service.save('key', 'v', { a: 1 });
      const updated = await service.update('key', { metadata: { b: 2 } });

      expect(updated!.metadata).toEqual({ a: 1, b: 2 });
    });

    it('should update tags (merge)', async () => {
      await service.save('key', 'v', {}, ['t1']);
      const updated = await service.update('key', { tags: ['t2'] });

      expect(updated!.tags).toContain('t1');
      expect(updated!.tags).toContain('t2');
    });
  });

  describe('delete', () => {
    it('should return false for non-existent key', async () => {
      const result = await service.delete('nonexistent');
      expect(result).toBe(false);
    });

    it('should delete existing item', async () => {
      await service.save('key', 'value');
      expect(service.size()).toBe(1);

      const result = await service.delete('key');
      expect(result).toBe(true);
      expect(service.size()).toBe(0);

      const getResult = await service.get('key');
      expect(getResult).toBeNull();
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await service.save('user_profile', { name: 'Alice', age: 30 }, {}, ['user', 'profile']);
      await service.save('user_preferences', { theme: 'dark', language: 'zh' }, {}, ['user', 'preferences']);
      await service.save('project_config', { name: 'AgentFlow', version: '1.0' }, {}, ['project', 'config']);
      await service.save('api_keys', { openai: 'sk-xxx' }, {}, ['api', 'keys']);
    });

    it('should search by query keywords', async () => {
      const results = await service.search('user profile');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].key).toContain('user');
    });

    it('should respect limit parameter', async () => {
      const results = await service.search('user', { limit: 1 });
      expect(results.length).toBe(1);
    });

    it('should filter by tags', async () => {
      const results = await service.search('', { tags: ['project'] });
      expect(results.length).toBe(1);
      expect(results[0].tags).toContain('project');
    });

    it('should return empty array for no matches', async () => {
      const results = await service.search('xyz_nonexistent_123');
      expect(results.length).toBe(0);
    });

    it('should search in value content', async () => {
      const results = await service.search('AgentFlow');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].key).toBe('project_config');
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await service.save('a_key1', 'v1', {}, ['cat1']);
      await service.save('a_key2', 'v2', {}, ['cat1']);
      await service.save('b_key1', 'v3', {}, ['cat2']);
    });

    it('should list all items', async () => {
      const results = await service.list();
      expect(results.length).toBe(3);
    });

    it('should filter by key prefix', async () => {
      const results = await service.list({ keyPrefix: 'a_' });
      expect(results.length).toBe(2);
      expect(results.every((r) => r.key.startsWith('a_'))).toBe(true);
    });

    it('should filter by tags', async () => {
      const results = await service.list({ tags: ['cat1'] });
      expect(results.length).toBe(2);
      expect(results.every((r) => r.tags.includes('cat1'))).toBe(true);
    });

    it('should respect limit and offset', async () => {
      const page1 = await service.list({ limit: 2, offset: 0 });
      const page2 = await service.list({ limit: 2, offset: 2 });
      expect(page1.length).toBe(2);
      expect(page2.length).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all items', async () => {
      await service.save('k1', 'v1');
      await service.save('k2', 'v2');
      expect(service.size()).toBe(2);

      service.clear();
      expect(service.size()).toBe(0);
    });
  });
});

describe('Memory Node Executors', () => {
  let memoryService: InMemoryMemoryService;

  beforeEach(() => {
    memoryService = new InMemoryMemoryService();
  });

  function makeNode(id: string, type: string, data: any = {}): any {
    return {
      id,
      type,
      position: { x: 0, y: 0 },
      data: {
        label: type,
        type,
        description: '',
        iconName: 'Box',
        ...data,
      },
    };
  }

  describe('memoryReadNodeExecutor', () => {
    it('should read memory by key', async () => {
      const { memoryReadNodeExecutor } = await import('../workflowExecutors');
      await memoryService.save('greeting', 'Hello World');

      const node = makeNode('mr1', 'memory_read', {
        memoryReadConfig: {
          key: 'greeting',
          outputVariable: 'result',
        },
      });

      const result = await memoryReadNodeExecutor(node, {
        variables: {},
        nodeOutputs: {},
        memoryService,
      });

      expect(result.success).toBe(true);
      expect(result.output?.result).toBe('Hello World');
      expect(result.output?.result_item).toBeDefined();
    });

    it('should return null for non-existent key', async () => {
      const { memoryReadNodeExecutor } = await import('../workflowExecutors');
      const node = makeNode('mr1', 'memory_read', {
        memoryReadConfig: {
          key: 'nonexistent',
          outputVariable: 'result',
        },
      });

      const result = await memoryReadNodeExecutor(node, {
        variables: {},
        nodeOutputs: {},
        memoryService,
      });

      expect(result.success).toBe(true);
      expect(result.output?.result).toBeNull();
    });

    it('should support variable template in key', async () => {
      const { memoryReadNodeExecutor } = await import('../workflowExecutors');
      await memoryService.save('user_alice', 'Alice Profile');

      const node = makeNode('mr1', 'memory_read', {
        memoryReadConfig: {
          key: 'user_{{username}}',
          outputVariable: 'result',
        },
      });

      const result = await memoryReadNodeExecutor(node, {
        variables: { username: 'alice' },
        nodeOutputs: {},
        memoryService,
      });

      expect(result.success).toBe(true);
      expect(result.output?.result).toBe('Alice Profile');
    });

    it('should fail without memory service', async () => {
      const { memoryReadNodeExecutor } = await import('../workflowExecutors');
      const node = makeNode('mr1', 'memory_read', {
        memoryReadConfig: { key: 'test' },
      });

      const result = await memoryReadNodeExecutor(node, {
        variables: {},
        nodeOutputs: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('未配置记忆服务');
    });
  });

  describe('memoryWriteNodeExecutor', () => {
    it('should write memory with key and value', async () => {
      const { memoryWriteNodeExecutor } = await import('../workflowExecutors');
      const node = makeNode('mw1', 'memory_write', {
        memoryWriteConfig: {
          key: 'mykey',
          value: 'myvalue',
          outputVariable: 'result',
        },
      });

      const result = await memoryWriteNodeExecutor(node, {
        variables: {},
        nodeOutputs: {},
        memoryService,
      });

      expect(result.success).toBe(true);
      expect(result.output?.result).toBeDefined();

      const saved = await memoryService.get('mykey');
      expect(saved).not.toBeNull();
      expect(saved!.value).toBe('myvalue');
    });

    it('should support variable template in key and value', async () => {
      const { memoryWriteNodeExecutor } = await import('../workflowExecutors');
      const node = makeNode('mw1', 'memory_write', {
        memoryWriteConfig: {
          key: 'user_{{id}}',
          value: '{{name}}',
          outputVariable: 'result',
        },
      });

      const result = await memoryWriteNodeExecutor(node, {
        variables: { id: '123', name: 'Bob' },
        nodeOutputs: {},
        memoryService,
      });

      expect(result.success).toBe(true);

      const saved = await memoryService.get('user_123');
      expect(saved).not.toBeNull();
      expect(saved!.value).toBe('Bob');
    });

    it('should resolve variable reference for value', async () => {
      const { memoryWriteNodeExecutor } = await import('../workflowExecutors');
      const node = makeNode('mw1', 'memory_write', {
        memoryWriteConfig: {
          key: 'data',
          value: 'myData',
          outputVariable: 'result',
        },
      });

      const result = await memoryWriteNodeExecutor(node, {
        variables: { myData: { foo: 'bar' } },
        nodeOutputs: {},
        memoryService,
      });

      expect(result.success).toBe(true);

      const saved = await memoryService.get('data');
      expect(saved).not.toBeNull();
      expect(saved!.value).toEqual({ foo: 'bar' });
    });

    it('should save with tags and metadata', async () => {
      const { memoryWriteNodeExecutor } = await import('../workflowExecutors');
      const node = makeNode('mw1', 'memory_write', {
        memoryWriteConfig: {
          key: 'tagged',
          value: 'test',
          tags: ['t1', 't2'],
          metadata: { source: 'test' },
          outputVariable: 'result',
        },
      });

      const result = await memoryWriteNodeExecutor(node, {
        variables: {},
        nodeOutputs: {},
        memoryService,
      });

      expect(result.success).toBe(true);

      const saved = await memoryService.get('tagged');
      expect(saved).not.toBeNull();
      expect(saved!.tags).toContain('t1');
      expect(saved!.tags).toContain('t2');
      expect(saved!.metadata.source).toBe('test');
    });
  });

  describe('memorySearchNodeExecutor', () => {
    beforeEach(async () => {
      await memoryService.save('doc_ai', '人工智能和机器学习', {}, ['ai']);
      await memoryService.save('doc_web', 'Web 前端开发', {}, ['web']);
      await memoryService.save('doc_ml', '机器学习入门教程', {}, ['ai', 'ml']);
    });

    it('should search memory by query', async () => {
      const { memorySearchNodeExecutor } = await import('../workflowExecutors');
      const node = makeNode('ms1', 'memory_search', {
        memorySearchConfig: {
          query: '机器学习',
          outputVariable: 'results',
        },
      });

      const result = await memorySearchNodeExecutor(node, {
        variables: {},
        nodeOutputs: {},
        memoryService,
      });

      expect(result.success).toBe(true);
      expect(result.output?.results.length).toBeGreaterThan(0);
      expect(result.output?.results_count).toBeGreaterThan(0);
    });

    it('should respect maxResults', async () => {
      const { memorySearchNodeExecutor } = await import('../workflowExecutors');
      const node = makeNode('ms1', 'memory_search', {
        memorySearchConfig: {
          query: 'doc',
          maxResults: 1,
          outputVariable: 'results',
        },
      });

      const result = await memorySearchNodeExecutor(node, {
        variables: {},
        nodeOutputs: {},
        memoryService,
      });

      expect(result.success).toBe(true);
      expect(result.output?.results.length).toBeLessThanOrEqual(1);
    });

    it('should support variable template in query', async () => {
      const { memorySearchNodeExecutor } = await import('../workflowExecutors');
      const node = makeNode('ms1', 'memory_search', {
        memorySearchConfig: {
          query: '{{keyword}}',
          outputVariable: 'results',
        },
      });

      const result = await memorySearchNodeExecutor(node, {
        variables: { keyword: '前端开发' },
        nodeOutputs: {},
        memoryService,
      });

      expect(result.success).toBe(true);
      expect(result.output?.results.length).toBeGreaterThan(0);
      expect(result.output?.results[0].key).toBe('doc_web');
    });
  });
});
