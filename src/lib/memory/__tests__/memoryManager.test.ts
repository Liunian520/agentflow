import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMemoryManager } from '../index';

// Mock store and memoryApi to avoid backend dependencies
vi.mock('../../store/useStore', () => ({
  useStore: {
    getState: () => ({
      sessionMemories: {},
      factualMemory: [],
      experienceBank: [],
      experientialReflections: [],
      routerMemory: [],
      metaSkill: { version: 1, principles: [], heuristics: [], failurePatterns: [] },
      setSessionMemory: vi.fn(),
      clearSessionMemory: vi.fn(),
      setFactualMemory: vi.fn(),
      incrementFactualAccess: vi.fn(),
      addMemoryAudit: vi.fn(),
      addHandoffSummary: vi.fn(),
      addDreamLog: vi.fn(),
      addTrace: vi.fn(),
      addRouterRecord: vi.fn(),
      updateMetaSkill: vi.fn(),
    }),
  },
}));

vi.mock('../../api/memoryApi', () => ({
  memoryApi: {
    getFactualMemories: vi.fn().mockResolvedValue([]),
    getTraces: vi.fn().mockResolvedValue([]),
    getReflections: vi.fn().mockResolvedValue([]),
    getRouterRecords: vi.fn().mockResolvedValue([]),
    accessFactualMemory: vi.fn().mockResolvedValue(undefined),
    addFactualMemory: vi.fn().mockResolvedValue(undefined),
    addTrace: vi.fn().mockResolvedValue(undefined),
    addReflection: vi.fn().mockResolvedValue(undefined),
    addRouterRecord: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock dynamicRecall to avoid LLM calls
vi.mock('../dynamicRecall', () => ({
  dynamicRecallAll: vi.fn().mockResolvedValue({
    recalledContext: '',
    factualResult: { selected: [] },
  }),
  dynamicRecallAllWithLLM: vi.fn().mockResolvedValue({
    recalledContext: '',
    factualResult: { selected: [] },
  }),
}));

// Mock contextCompactor
vi.mock('../contextCompactor', () => ({
  shouldCompactMessages: vi.fn().mockReturnValue(false),
  compactConversation: vi.fn(),
}));

// Mock autoExtraction
vi.mock('../autoExtraction', () => ({
  extractFactsWithLLM: vi.fn().mockResolvedValue([]),
}));

// Mock autoDream
vi.mock('../autoDream', () => ({
  runAutoDream: vi.fn(),
  canRunDream: vi.fn().mockReturnValue({ allowed: false, reason: 'test' }),
}));

// Mock sessionMemory
vi.mock('../sessionMemory', () => ({
  createSessionMemory: vi.fn().mockReturnValue({
    sessionId: 'test',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    messageCount: 0,
    estimatedTokens: 0,
    summary: '',
    keyFacts: [],
    userPreferences: [],
    activeTopics: [],
  }),
  quickUpdateFromMessages: vi.fn().mockReturnValue({
    sessionId: 'test',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    messageCount: 1,
    estimatedTokens: 10,
    summary: '',
    keyFacts: [],
    userPreferences: [],
    activeTopics: [],
  }),
  formatSessionMemoryForInjection: vi.fn().mockReturnValue(''),
}));

// Mock factualMemory
vi.mock('../factualMemory', () => ({
  trimFactualMemoryCapacity: vi.fn().mockReturnValue([]),
}));

import type { ChatMessage } from '../../../types';

describe('MemoryManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getInstance', () => {
    it('应返回单例实例', () => {
      const m1 = getMemoryManager();
      const m2 = getMemoryManager();
      expect(m1).toBe(m2);
    });
  });

  describe('onSessionStart', () => {
    it('应能正常调用而不抛错', () => {
      const manager = getMemoryManager();
      expect(() => manager.onSessionStart('test-session')).not.toThrow();
    });
  });

  describe('onSessionEnd', () => {
    it('应能正常调用而不抛错', () => {
      const manager = getMemoryManager();
      expect(() => manager.onSessionEnd('test-session')).not.toThrow();
    });
  });

  describe('onTurnComplete', () => {
    it('应能处理消息并完成而不抛错', async () => {
      const manager = getMemoryManager();
      const messages: ChatMessage[] = [
        { id: '1', role: 'user', content: '你好', timestamp: new Date().toISOString(), messageType: 'text' },
        { id: '2', role: 'assistant', content: '你好！有什么可以帮你的？', timestamp: new Date().toISOString(), messageType: 'text' },
      ];
      await expect(manager.onTurnComplete('test-session', messages)).resolves.not.toThrow();
    });
  });

  describe('onLLMCall', () => {
    it('应返回 recalledContext 和 sessionMemoryContext', async () => {
      const manager = getMemoryManager();
      const messages: ChatMessage[] = [
        { id: '1', role: 'user', content: '你好', timestamp: new Date().toISOString(), messageType: 'text' },
      ];
      const result = await manager.onLLMCall('test-session', '你好', messages);
      expect(result).toHaveProperty('recalledContext');
      expect(result).toHaveProperty('sessionMemoryContext');
      expect(typeof result.recalledContext).toBe('string');
      expect(typeof result.sessionMemoryContext).toBe('string');
    });
  });

  describe('getMemoryStats', () => {
    it('应返回各层记忆统计', async () => {
      const manager = getMemoryManager();
      const stats = await manager.getMemoryStats();
      expect(stats).toHaveProperty('L0');
      expect(stats).toHaveProperty('L1');
      expect(stats).toHaveProperty('L2A');
      expect(stats).toHaveProperty('L2B');
      expect(stats).toHaveProperty('L2C');
      expect(stats).toHaveProperty('L3');
      expect(stats.L0).toHaveProperty('sessions');
      expect(stats.L1).toHaveProperty('entries');
      expect(stats.L2A).toHaveProperty('traces');
      expect(stats.L2B).toHaveProperty('reflections');
      expect(stats.L2C).toHaveProperty('version');
      expect(stats.L3).toHaveProperty('records');
    });
  });
});
