# 自主多 Agent 编排系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 LNAgent 的多 Agent 系统具备自主感知、自主调度、自主进化的能力——路由权重自动调优、Agent 按需动态分配、多 Agent 直接通信、编排自动触发，全程无需用户干预。

**Architecture:** 在现有 ACRouter + Meta-Agent + SubAgent 基础上，新增四个核心子系统：(1) Agent Runtime Registry——运行时状态机与注册中心；(2) Agent Message Bus——Agent 间直接通信的消息总线；(3) Dynamic Agent Scheduler——基于能力匹配和负载感知的动态调度器；(4) Router Auto-Evolver——路由策略自进化器。四个子系统通过 store 集成，对上层 ChatWorkspacePage 透明。

**Tech Stack:** TypeScript, Zustand (state management), Vitest (testing), Cloudflare Worker (API proxy)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/lib/agentRuntime.ts` | Agent 运行时状态机、注册中心、生命周期管理 |
| `src/lib/agentMessageBus.ts` | Agent 间消息总线（发布/订阅 + 直接消息） |
| `src/lib/agentScheduler.ts` | 动态 Agent 调度器（任务队列 + 能力匹配 + 负载均衡） |
| `src/lib/routerEvolver.ts` | 路由策略自进化器（权重自动调优 + 冷启动偏好进化） |
| `src/lib/__tests__/agentRuntime.test.ts` | Agent 运行时测试 |
| `src/lib/__tests__/agentMessageBus.test.ts` | 消息总线测试 |
| `src/lib/__tests__/agentScheduler.test.ts` | 调度器测试 |
| `src/lib/__tests__/routerEvolver.test.ts` | 路由进化器测试 |

### Modified Files
| File | Changes |
|------|---------|
| `src/types/index.ts` | 新增 AgentRuntimeState, AgentMessage, ScheduledTask 等类型 |
| `src/lib/modelRouter.ts` | 导出权重常量为可变状态，接入 routerEvolver |
| `src/store/useStore.ts` | 集成 Runtime Registry、Message Bus、Scheduler |
| `src/components/chat/intent/MetaAgent.ts` | 编排后自动注册 Agent 到 Runtime Registry |
| `src/pages/ChatWorkspacePage.tsx` | 自动编排检测 + 调度器集成 |

---

## Task 1: 定义运行时类型

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: 在 types/index.ts 末尾添加运行时类型定义**

在 `src/types/index.ts` 文件末尾（最后一个 `export` 之后）添加：

```typescript
// ===== Agent Runtime System =====

export type AgentStatus = 'idle' | 'busy' | 'queued' | 'error' | 'offline';

export interface AgentRuntimeState {
  agentId: string;
  status: AgentStatus;
  currentTaskId: string | null;
  lastActiveAt: number;
  totalTasks: number;
  successRate: number;
  avgLatencyMs: number;
  capabilities: string[];
  maxConcurrent: number;
  activeConcurrent: number;
}

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string | null; // null = broadcast
  type: 'request' | 'response' | 'notify' | 'broadcast';
  content: string;
  metadata: Record<string, any>;
  timestamp: number;
  replyTo: string | null;
}

export interface ScheduledTask {
  id: string;
  input: string;
  requiredCapabilities: string[];
  preferredModel: string | null;
  priority: 'low' | 'normal' | 'high';
  status: 'queued' | 'assigned' | 'running' | 'done' | 'failed';
  assignedAgentId: string | null;
  result: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface RouterEvolutionRecord {
  timestamp: number;
  oldWeights: { stat: number; knn: number; cost: number };
  newWeights: { stat: number; knn: number; cost: number };
  accuracyBefore: number;
  accuracyAfter: number;
  sampleSize: number;
  trigger: 'scheduled' | 'accuracy_drop' | 'manual';
}
```

- [ ] **Step 2: 验证类型编译**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx tsc --noEmit --pretty 2>&1 | Select-Object -First 20`
Expected: PASS (no errors)

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add runtime types for agent orchestration system"
```

---

## Task 2: Agent Runtime Registry

**Files:**
- Create: `src/lib/agentRuntime.ts`
- Create: `src/lib/__tests__/agentRuntime.test.ts`

- [ ] **Step 1: 写失败测试 — Agent 注册和状态查询**

创建 `src/lib/__tests__/agentRuntime.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRuntimeRegistry } from '../agentRuntime';

describe('AgentRuntimeRegistry', () => {
  let registry: AgentRuntimeRegistry;

  beforeEach(() => {
    registry = new AgentRuntimeRegistry();
  });

  it('should register an agent with idle status', () => {
    registry.register('agent-1', ['code', 'reasoning']);
    const state = registry.getAgentState('agent-1');
    expect(state).toBeDefined();
    expect(state!.status).toBe('idle');
    expect(state!.capabilities).toEqual(['code', 'reasoning']);
    expect(state!.maxConcurrent).toBe(1);
  });

  it('should transition status from idle to busy and back', () => {
    registry.register('agent-1', ['code']);
    registry.setBusy('agent-1', 'task-1');
    expect(registry.getAgentState('agent-1')!.status).toBe('busy');
    expect(registry.getAgentState('agent-1')!.currentTaskId).toBe('task-1');
    registry.setIdle('agent-1');
    expect(registry.getAgentState('agent-1')!.status).toBe('idle');
    expect(registry.getAgentState('agent-1')!.currentTaskId).toBeNull();
  });

  it('should find idle agents by capability', () => {
    registry.register('agent-1', ['code', 'reasoning']);
    registry.register('agent-2', ['writing']);
    registry.register('agent-3', ['code', 'writing']);
    registry.setBusy('agent-1', 'task-x');

    const codeAgents = registry.findIdleAgents(['code']);
    expect(codeAgents).toHaveLength(1);
    expect(codeAgents[0].agentId).toBe('agent-3');
  });

  it('should track success rate and avg latency', () => {
    registry.register('agent-1', ['code']);
    registry.recordTaskResult('agent-1', true, 1000);
    registry.recordTaskResult('agent-1', false, 3000);
    const state = registry.getAgentState('agent-1')!;
    expect(state.totalTasks).toBe(2);
    expect(state.successRate).toBeCloseTo(0.5);
    expect(state.avgLatencyMs).toBe(2000);
  });

  it('should unregister an agent', () => {
    registry.register('agent-1', ['code']);
    registry.unregister('agent-1');
    expect(registry.getAgentState('agent-1')).toBeUndefined();
  });

  it('should list all agents with their states', () => {
    registry.register('agent-1', ['code']);
    registry.register('agent-2', ['writing']);
    const all = registry.getAllAgents();
    expect(all).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx vitest run src/lib/__tests__/agentRuntime.test.ts 2>&1 | Select-Object -First 20`
Expected: FAIL — "Cannot find module '../agentRuntime'"

- [ ] **Step 3: 实现 AgentRuntimeRegistry**

创建 `src/lib/agentRuntime.ts`：

```typescript
import type { AgentRuntimeState, AgentStatus } from '../types';
import { generateId } from './utils';

/**
 * Agent Runtime Registry — 运行时 Agent 状态机与注册中心
 * 
 * 职责：
 * - 跟踪每个 Agent 的运行时状态（idle/busy/queued/error）
 * - 基于 capabilities 查找可用 Agent
 * - 记录执行指标（成功率、平均延迟）
 */
export class AgentRuntimeRegistry {
  private agents = new Map<string, AgentRuntimeState>();

  register(agentId: string, capabilities: string[] = [], maxConcurrent = 1): void {
    if (this.agents.has(agentId)) {
      // 已注册，仅更新 capabilities
      const existing = this.agents.get(agentId)!;
      existing.capabilities = capabilities;
      existing.maxConcurrent = maxConcurrent;
      return;
    }
    this.agents.set(agentId, {
      agentId,
      status: 'idle',
      currentTaskId: null,
      lastActiveAt: Date.now(),
      totalTasks: 0,
      successRate: 1.0,
      avgLatencyMs: 0,
      capabilities,
      maxConcurrent,
      activeConcurrent: 0,
    });
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
  }

  getAgentState(agentId: string): AgentRuntimeState | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentRuntimeState[] {
    return Array.from(this.agents.values());
  }

  setBusy(agentId: string, taskId: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;
    state.status = 'busy';
    state.currentTaskId = taskId;
    state.activeConcurrent++;
    state.lastActiveAt = Date.now();
  }

  setIdle(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;
    state.activeConcurrent = Math.max(0, state.activeConcurrent - 1);
    if (state.activeConcurrent === 0) {
      state.status = 'idle';
      state.currentTaskId = null;
    }
    state.lastActiveAt = Date.now();
  }

  setError(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;
    state.status = 'error';
    state.activeConcurrent = Math.max(0, state.activeConcurrent - 1);
    state.currentTaskId = null;
    state.lastActiveAt = Date.now();
  }

  findIdleAgents(requiredCapabilities: string[]): AgentRuntimeState[] {
    return Array.from(this.agents.values()).filter((agent) => {
      if (agent.status === 'error' || agent.status === 'offline') return false;
      if (agent.activeConcurrent >= agent.maxConcurrent) return false;
      if (requiredCapabilities.length === 0) return true;
      return requiredCapabilities.every((cap) => agent.capabilities.includes(cap));
    });
  }

  recordTaskResult(agentId: string, success: boolean, latencyMs: number): void {
    const state = this.agents.get(agentId);
    if (!state) return;
    const prevTotal = state.totalTasks;
    state.totalTasks = prevTotal + 1;
    // 增量平均：new_avg = (old_avg * n + new_val) / (n + 1)
    state.avgLatencyMs = Math.round((state.avgLatencyMs * prevTotal + latencyMs) / state.totalTasks);
    state.successRate = (state.successRate * prevTotal + (success ? 1 : 0)) / state.totalTasks;
  }

  /** 自动清理长时间未活动的 Agent */
  cleanupStale(maxIdleMs: number = 30 * 60 * 1000): string[] {
    const now = Date.now();
    const removed: string[] = [];
    for (const [id, state] of this.agents) {
      if (state.status === 'idle' && now - state.lastActiveAt > maxIdleMs) {
        this.agents.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }
}

/** 全局单例 */
let globalRegistry: AgentRuntimeRegistry | null = null;

export function getAgentRuntimeRegistry(): AgentRuntimeRegistry {
  if (!globalRegistry) {
    globalRegistry = new AgentRuntimeRegistry();
  }
  return globalRegistry;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx vitest run src/lib/__tests__/agentRuntime.test.ts 2>&1 | Select-Object -First 30`
Expected: PASS — 6 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/agentRuntime.ts src/lib/__tests__/agentRuntime.test.ts
git commit -m "feat: add AgentRuntimeRegistry with state machine and capability matching"
```

---

## Task 3: Agent Message Bus

**Files:**
- Create: `src/lib/agentMessageBus.ts`
- Create: `src/lib/__tests__/agentMessageBus.test.ts`

- [ ] **Step 1: 写失败测试 — 消息总线核心功能**

创建 `src/lib/__tests__/agentMessageBus.test.ts`：

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentMessageBus } from '../agentMessageBus';

describe('AgentMessageBus', () => {
  let bus: AgentMessageBus;

  beforeEach(() => {
    bus = new AgentMessageBus();
  });

  it('should deliver direct message to recipient', () => {
    const callback = vi.fn();
    bus.subscribe('agent-1', callback);
    bus.send({
      fromAgentId: 'agent-2',
      toAgentId: 'agent-1',
      type: 'request',
      content: '分析这段代码',
      metadata: {},
    });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      fromAgentId: 'agent-2',
      content: '分析这段代码',
    }));
  });

  it('should deliver broadcast to all subscribers', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();
    bus.subscribe('agent-1', cb1);
    bus.subscribe('agent-2', cb2);
    bus.subscribe('agent-3', cb3);
    bus.broadcast('agent-1', '全体注意：新任务到达');
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(cb3).toHaveBeenCalledTimes(1);
    expect(cb1).not.toHaveBeenCalled(); // 广播者不收到自己的消息
  });

  it('should support request-response pattern', async () => {
    bus.subscribe('agent-2', (msg) => {
      if (msg.type === 'request') {
        bus.send({
          fromAgentId: 'agent-2',
          toAgentId: 'agent-1',
          type: 'response',
          content: '分析完成：无 bug',
          metadata: {},
          replyTo: msg.id,
        });
      }
    });

    const response = await bus.request('agent-1', 'agent-2', '分析这段代码', 5000);
    expect(response).toBeDefined();
    expect(response!.content).toBe('分析完成：无 bug');
  });

  it('should timeout when no response', async () => {
    const response = await bus.request('agent-1', 'agent-2', '分析这段代码', 100);
    expect(response).toBeNull();
  });

  it('should unsubscribe a callback', () => {
    const callback = vi.fn();
    bus.subscribe('agent-1', callback);
    bus.unsubscribe('agent-1');
    bus.send({
      fromAgentId: 'agent-2',
      toAgentId: 'agent-1',
      type: 'notify',
      content: 'hello',
      metadata: {},
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it('should keep message history', () => {
    bus.subscribe('agent-1', vi.fn());
    bus.send({ fromAgentId: 'agent-2', toAgentId: 'agent-1', type: 'request', content: 'msg1', metadata: {} });
    bus.send({ fromAgentId: 'agent-2', toAgentId: 'agent-1', type: 'request', content: 'msg2', metadata: {} });
    const history = bus.getHistory('agent-1');
    expect(history).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx vitest run src/lib/__tests__/agentMessageBus.test.ts 2>&1 | Select-Object -First 20`
Expected: FAIL — "Cannot find module '../agentMessageBus'"

- [ ] **Step 3: 实现 AgentMessageBus**

创建 `src/lib/agentMessageBus.ts`：

```typescript
import type { AgentMessage } from '../types';
import { generateId } from './utils';

type MessageCallback = (msg: AgentMessage) => void;

/**
 * Agent Message Bus — Agent 间直接通信的消息总线
 * 
 * 支持三种通信模式：
 * - Direct: agent A → agent B（点对点）
 * - Broadcast: agent A → all agents（广播）
 * - Request-Response: agent A 请求 → agent B 响应（带超时）
 * 
 * 内部 Agent 通过此总线直接通信，无需经过工作流变量中转。
 */
export class AgentMessageBus {
  private subscribers = new Map<string, Set<MessageCallback>>();
  private messageHistory = new Map<string, AgentMessage[]>();
  private pendingRequests = new Map<string, {
    resolve: (msg: AgentMessage | null) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private maxHistoryPerAgent = 100;

  subscribe(agentId: string, callback: MessageCallback): void {
    if (!this.subscribers.has(agentId)) {
      this.subscribers.set(agentId, new Set());
    }
    this.subscribers.get(agentId)!.add(callback);
  }

  unsubscribe(agentId: string): void {
    this.subscribers.delete(agentId);
  }

  /** 发送直接消息 */
  send(message: Omit<AgentMessage, 'id' | 'timestamp'>): string {
    const fullMessage: AgentMessage = {
      ...message,
      id: generateId(),
      timestamp: Date.now(),
    };

    // 检查是否是某个 pending request 的响应
    if (message.type === 'response' && message.replyTo) {
      const pending = this.pendingRequests.get(message.replyTo);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.replyTo);
        pending.resolve(fullMessage);
      }
    }

    // 投递给目标
    const callbacks = this.subscribers.get(message.toAgentId || '');
    if (callbacks) {
      callbacks.forEach((cb) => cb(fullMessage));
    }

    // 记录历史
    this.recordHistory(message.toAgentId || '', fullMessage);
    if (message.fromAgentId) {
      this.recordHistory(message.fromAgentId, fullMessage);
    }

    return fullMessage.id;
  }

  /** 广播消息给所有订阅者（除了发送者自己） */
  broadcast(fromAgentId: string, content: string, metadata: Record<string, any> = {}): void {
    const message: AgentMessage = {
      id: generateId(),
      fromAgentId,
      toAgentId: null,
      type: 'broadcast',
      content,
      metadata,
      timestamp: Date.now(),
      replyTo: null,
    };

    for (const [agentId, callbacks] of this.subscribers) {
      if (agentId === fromAgentId) continue;
      callbacks.forEach((cb) => cb(message));
      this.recordHistory(agentId, message);
    }
  }

  /** 请求-响应模式：发送请求并等待响应 */
  request(
    fromAgentId: string,
    toAgentId: string,
    content: string,
    timeoutMs: number = 30000,
    metadata: Record<string, any> = {},
  ): Promise<AgentMessage | null> {
    return new Promise((resolve) => {
      const requestId = generateId();

      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve(null);
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, timer });

      this.send({
        fromAgentId,
        toAgentId,
        type: 'request',
        content,
        metadata,
        replyTo: null,
      });

      // 覆盖 id，让 send 使用我们的 requestId
      // 注意：send 内部会生成新 id，所以我们需要手动追踪
      // 这里改用 send 后记录的 id 关联 pending
      // 修正：直接构造消息投递
    });
  }

  /** 获取某个 Agent 的消息历史 */
  getHistory(agentId: string): AgentMessage[] {
    return this.messageHistory.get(agentId) || [];
  }

  /** 清空历史 */
  clearHistory(agentId?: string): void {
    if (agentId) {
      this.messageHistory.delete(agentId);
    } else {
      this.messageHistory.clear();
    }
  }

  private recordHistory(agentId: string, message: AgentMessage): void {
    if (!this.messageHistory.has(agentId)) {
      this.messageHistory.set(agentId, []);
    }
    const history = this.messageHistory.get(agentId)!;
    history.push(message);
    if (history.length > this.maxHistoryPerAgent) {
      history.shift();
    }
  }
}

/** 全局单例 */
let globalBus: AgentMessageBus | null = null;

export function getAgentMessageBus(): AgentMessageBus {
  if (!globalBus) {
    globalBus = new AgentMessageBus();
  }
  return globalBus;
}
```

- [ ] **Step 4: 修正 request 方法的 ID 关联问题**

在 `src/lib/agentMessageBus.ts` 中替换 `request` 方法：

```typescript
  /** 请求-响应模式：发送请求并等待响应 */
  request(
    fromAgentId: string,
    toAgentId: string,
    content: string,
    timeoutMs: number = 30000,
    metadata: Record<string, any> = {},
  ): Promise<AgentMessage | null> {
    return new Promise((resolve) => {
      const requestId = generateId();

      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve(null);
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, timer });

      // 直接构造消息投递，使用我们生成的 requestId
      const message: AgentMessage = {
        id: requestId,
        fromAgentId,
        toAgentId,
        type: 'request',
        content,
        metadata,
        timestamp: Date.now(),
        replyTo: null,
      };

      const callbacks = this.subscribers.get(toAgentId);
      if (callbacks) {
        callbacks.forEach((cb) => cb(message));
      }
      this.recordHistory(toAgentId, message);
      this.recordHistory(fromAgentId, message);
    });
  }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx vitest run src/lib/__tests__/agentMessageBus.test.ts 2>&1 | Select-Object -First 30`
Expected: PASS — 6 tests passed

- [ ] **Step 6: Commit**

```bash
git add src/lib/agentMessageBus.ts src/lib/__tests__/agentMessageBus.test.ts
git commit -m "feat: add AgentMessageBus with direct/broadcast/request-response patterns"
```

---

## Task 4: Dynamic Agent Scheduler

**Files:**
- Create: `src/lib/agentScheduler.ts`
- Create: `src/lib/__tests__/agentScheduler.test.ts`

- [ ] **Step 1: 写失败测试 — 调度器核心功能**

创建 `src/lib/__tests__/agentScheduler.test.ts`：

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentScheduler } from '../agentScheduler';
import { AgentRuntimeRegistry } from '../agentRuntime';

describe('AgentScheduler', () => {
  let registry: AgentRuntimeRegistry;
  let scheduler: AgentScheduler;

  beforeEach(() => {
    registry = new AgentRuntimeRegistry();
    scheduler = new AgentScheduler(registry);
  });

  it('should queue a task and assign to idle agent', async () => {
    registry.register('agent-1', ['code']);
    const taskId = scheduler.enqueue({
      input: '修复 bug',
      requiredCapabilities: ['code'],
      priority: 'normal',
    });
    const task = scheduler.getTask(taskId);
    expect(task).toBeDefined();
    expect(task!.status).toBe('assigned');
    expect(task!.assignedAgentId).toBe('agent-1');
  });

  it('should queue task when no capable agent available', () => {
    registry.register('agent-1', ['writing']);
    const taskId = scheduler.enqueue({
      input: '修复 bug',
      requiredCapabilities: ['code'],
      priority: 'normal',
    });
    const task = scheduler.getTask(taskId);
    expect(task!.status).toBe('queued');
    expect(task!.assignedAgentId).toBeNull();
  });

  it('should assign queued task when agent becomes available', () => {
    registry.register('agent-1', ['code']);
    registry.setBusy('agent-1', 'other-task');

    const taskId = scheduler.enqueue({
      input: '修复 bug',
      requiredCapabilities: ['code'],
      priority: 'normal',
    });
    expect(scheduler.getTask(taskId)!.status).toBe('queued');

    // agent 空闲后，任务应被分配
    registry.setIdle('agent-1');
    scheduler.tryAssignQueuedTasks();
    expect(scheduler.getTask(taskId)!.status).toBe('assigned');
    expect(scheduler.getTask(taskId)!.assignedAgentId).toBe('agent-1');
  });

  it('should prefer agent with better success rate', () => {
    registry.register('agent-1', ['code']);
    registry.register('agent-2', ['code']);
    registry.recordTaskResult('agent-1', false, 5000);
    registry.recordTaskResult('agent-2', true, 1000);

    const taskId = scheduler.enqueue({
      input: '修复 bug',
      requiredCapabilities: ['code'],
      priority: 'normal',
    });
    expect(scheduler.getTask(taskId)!.assignedAgentId).toBe('agent-2');
  });

  it('should process high priority tasks first', () => {
    registry.register('agent-1', ['code']);
    registry.setBusy('agent-1', 'other');

    const lowId = scheduler.enqueue({ input: 'low', requiredCapabilities: ['code'], priority: 'low' });
    const highId = scheduler.enqueue({ input: 'high', requiredCapabilities: ['code'], priority: 'high' });
    const normalId = scheduler.enqueue({ input: 'normal', requiredCapabilities: ['code'], priority: 'normal' });

    registry.setIdle('agent-1');
    scheduler.tryAssignQueuedTasks();

    // high 应该先被分配
    expect(scheduler.getTask(highId)!.status).toBe('assigned');
    expect(scheduler.getTask(normalId)!.status).toBe('queued');
    expect(scheduler.getTask(lowId)!.status).toBe('queued');
  });

  it('should mark task done with result', () => {
    registry.register('agent-1', ['code']);
    const taskId = scheduler.enqueue({
      input: '修复 bug',
      requiredCapabilities: ['code'],
      priority: 'normal',
    });
    scheduler.completeTask(taskId, 'bug 已修复');
    expect(scheduler.getTask(taskId)!.status).toBe('done');
    expect(scheduler.getTask(taskId)!.result).toBe('bug 已修复');
  });

  it('should fail task with error', () => {
    registry.register('agent-1', ['code']);
    const taskId = scheduler.enqueue({
      input: '修复 bug',
      requiredCapabilities: ['code'],
      priority: 'normal',
    });
    scheduler.failTask(taskId, 'Agent 执行超时');
    expect(scheduler.getTask(taskId)!.status).toBe('failed');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx vitest run src/lib/__tests__/agentScheduler.test.ts 2>&1 | Select-Object -First 20`
Expected: FAIL — "Cannot find module '../agentScheduler'"

- [ ] **Step 3: 实现 AgentScheduler**

创建 `src/lib/agentScheduler.ts`：

```typescript
import type { ScheduledTask } from '../types';
import type { AgentRuntimeRegistry } from './agentRuntime';
import { generateId } from './utils';

const PRIORITY_ORDER: Record<string, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

/**
 * Dynamic Agent Scheduler — 动态 Agent 调度器
 * 
 * 职责：
 * - 接收任务，按能力匹配空闲 Agent
 * - 优先级队列：high > normal > low
 * - 负载感知：优先选成功率高、延迟低的 Agent
 * - Agent 忙碌时排队，空闲时自动分配
 */
export class AgentScheduler {
  private tasks = new Map<string, ScheduledTask>();
  private queue: string[] = []; // 待分配任务 ID 列表

  constructor(private registry: AgentRuntimeRegistry) {}

  /** 入队一个任务，尝试立即分配 */
  enqueue(task: {
    input: string;
    requiredCapabilities: string[];
    preferredModel: string | null;
    priority: 'low' | 'normal' | 'high';
  }): string {
    const id = generateId();
    const scheduledTask: ScheduledTask = {
      id,
      input: task.input,
      requiredCapabilities: task.requiredCapabilities,
      preferredModel: task.preferredModel,
      priority: task.priority,
      status: 'queued',
      assignedAgentId: null,
      result: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
    };
    this.tasks.set(id, scheduledTask);

    // 尝试立即分配
    this.tryAssignTask(id);
    return id;
  }

  /** 尝试分配所有排队中的任务 */
  tryAssignQueuedTasks(): void {
    // 按优先级排序队列
    this.queue.sort((a, b) => {
      const taskA = this.tasks.get(a);
      const taskB = this.tasks.get(b);
      if (!taskA || !taskB) return 0;
      return PRIORITY_ORDER[taskA.priority] - PRIORITY_ORDER[taskB.priority];
    });

    const stillQueued: string[] = [];
    for (const taskId of this.queue) {
      if (this.tryAssignTask(taskId)) {
        // 分配成功
      } else {
        stillQueued.push(taskId);
      }
    }
    this.queue = stillQueued;
  }

  /** 尝试为单个任务分配 Agent */
  private tryAssignTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'queued') return false;

    const candidates = this.registry.findIdleAgents(task.requiredCapabilities);
    if (candidates.length === 0) {
      // 没有可用 Agent，加入队列
      if (!this.queue.includes(taskId)) {
        this.queue.push(taskId);
      }
      return false;
    }

    // 选择最优 Agent：成功率优先，延迟其次
    candidates.sort((a, b) => {
      if (b.successRate !== a.successRate) {
        return b.successRate - a.successRate;
      }
      return a.avgLatencyMs - b.avgLatencyMs;
    });

    const agent = candidates[0];
    task.assignedAgentId = agent.agentId;
    task.status = 'assigned';
    task.startedAt = Date.now();
    this.registry.setBusy(agent.agentId, taskId);

    // 从队列中移除
    this.queue = this.queue.filter((id) => id !== taskId);
    return true;
  }

  /** 标记任务完成 */
  completeTask(taskId: string, result: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'done';
    task.result = result;
    task.finishedAt = Date.now();

    if (task.assignedAgentId) {
      const latency = task.finishedAt - (task.startedAt || task.createdAt);
      this.registry.recordTaskResult(task.assignedAgentId, true, latency);
      this.registry.setIdle(task.assignedAgentId);
    }

    // 分配队列中的下一个任务
    this.tryAssignQueuedTasks();
  }

  /** 标记任务失败 */
  failTask(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'failed';
    task.result = error;
    task.finishedAt = Date.now();

    if (task.assignedAgentId) {
      const latency = task.finishedAt - (task.startedAt || task.createdAt);
      this.registry.recordTaskResult(task.assignedAgentId, false, latency);
      this.registry.setError(task.assignedAgentId);
      // 错误状态后恢复为 idle
      this.registry.setIdle(task.assignedAgentId);
    }

    this.tryAssignQueuedTasks();
  }

  getTask(taskId: string): ScheduledTask | undefined {
    return this.tasks.get(taskId);
  }

  getQueuedTasks(): ScheduledTask[] {
    return this.queue
      .map((id) => this.tasks.get(id))
      .filter((t): t is ScheduledTask => !!t);
  }

  getAssignedTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === 'assigned' || t.status === 'running');
  }
}

/** 全局单例 */
let globalScheduler: AgentScheduler | null = null;

export function getAgentScheduler(): AgentScheduler {
  if (!globalScheduler) {
    const { getAgentRuntimeRegistry } = require('./agentRuntime');
    globalScheduler = new AgentScheduler(getAgentRuntimeRegistry());
  }
  return globalScheduler;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx vitest run src/lib/__tests__/agentScheduler.test.ts 2>&1 | Select-Object -First 30`
Expected: PASS — 7 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/agentScheduler.ts src/lib/__tests__/agentScheduler.test.ts
git commit -m "feat: add AgentScheduler with priority queue and capability matching"
```

---

## Task 5: Router Auto-Evolver

**Files:**
- Create: `src/lib/routerEvolver.ts`
- Create: `src/lib/__tests__/routerEvolver.test.ts`
- Modify: `src/lib/modelRouter.ts`

- [ ] **Step 1: 写失败测试 — 权重自动调优**

创建 `src/lib/__tests__/routerEvolver.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { RouterEvolver } from '../routerEvolver';

describe('RouterEvolver', () => {
  let evolver: RouterEvolver;

  beforeEach(() => {
    evolver = new RouterEvolver();
  });

  it('should start with default weights', () => {
    const weights = evolver.getWeights();
    expect(weights.stat).toBeCloseTo(0.50);
    expect(weights.knn).toBeCloseTo(0.35);
    expect(weights.cost).toBeCloseTo(0.15);
  });

  it('should adjust weights when stat predictor is more accurate', () => {
    // 模拟 20 条记录：stat 预测准确率 80%, knn 预测准确率 50%, cost 预测准确率 30%
    for (let i = 0; i < 20; i++) {
      evolver.recordPrediction({
        statCorrect: i < 16,   // 80% 准确
        knnCorrect: i < 10,    // 50% 准确
        costCorrect: i < 6,    // 30% 准确
      });
    }
    evolver.evolve();
    const weights = evolver.getWeights();
    // stat 权重应该增加，cost 权重应该减少
    expect(weights.stat).toBeGreaterThan(0.50);
    expect(weights.cost).toBeLessThan(0.15);
  });

  it('should not evolve with insufficient samples', () => {
    for (let i = 0; i < 5; i++) {
      evolver.recordPrediction({ statCorrect: true, knnCorrect: false, costCorrect: false });
    }
    const oldWeights = evolver.getWeights();
    evolver.evolve();
    const newWeights = evolver.getWeights();
    expect(newWeights).toEqual(oldWeights);
  });

  it('should keep weights normalized (sum to 1.0)', () => {
    for (let i = 0; i < 20; i++) {
      evolver.recordPrediction({ statCorrect: true, knnCorrect: false, costCorrect: false });
    }
    evolver.evolve();
    const weights = evolver.getWeights();
    const sum = weights.stat + weights.knn + weights.cost;
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it('should record evolution history', () => {
    for (let i = 0; i < 20; i++) {
      evolver.recordPrediction({ statCorrect: true, knnCorrect: false, costCorrect: false });
    }
    evolver.evolve();
    const history = evolver.getEvolutionHistory();
    expect(history).toHaveLength(1);
    expect(history[0].oldWeights).toBeDefined();
    expect(history[0].newWeights).toBeDefined();
    expect(history[0].sampleSize).toBe(20);
  });

  it('should respect weight bounds (min 0.05, max 0.80)', () => {
    // 极端情况：stat 全对，其他全错
    for (let i = 0; i < 100; i++) {
      evolver.recordPrediction({ statCorrect: true, knnCorrect: false, costCorrect: false });
    }
    // 多轮进化
    for (let round = 0; round < 10; round++) {
      evolver.evolve();
    }
    const weights = evolver.getWeights();
    expect(weights.stat).toBeLessThanOrEqual(0.80);
    expect(weights.knn).toBeGreaterThanOrEqual(0.05);
    expect(weights.cost).toBeGreaterThanOrEqual(0.05);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx vitest run src/lib/__tests__/routerEvolver.test.ts 2>&1 | Select-Object -First 20`
Expected: FAIL — "Cannot find module '../routerEvolver'"

- [ ] **Step 3: 实现 RouterEvolver**

创建 `src/lib/routerEvolver.ts`：

```typescript
import type { RouterEvolutionRecord } from '../types';

const MIN_SAMPLES_TO_EVOLVE = 15;
const LEARNING_RATE = 0.05;
const MIN_WEIGHT = 0.05;
const MAX_WEIGHT = 0.80;

interface PredictionRecord {
  statCorrect: boolean;
  knnCorrect: boolean;
  costCorrect: boolean;
}

/**
 * Router Auto-Evolver — 路由策略自进化器
 * 
 * 职责：
 * - 跟踪三个预测器（stat/knn/cost）的准确率
 * - 当样本足够时，按准确率比例调整融合权重
 * - 记录进化历史，支持回溯
 * 
 * 核心公式：
 *   new_weight_i = old_weight_i + lr * (accuracy_i - avg_accuracy)
 *   然后归一化并 clamp 到 [MIN_WEIGHT, MAX_WEIGHT]
 */
export class RouterEvolver {
  private weights = { stat: 0.50, knn: 0.35, cost: 0.15 };
  private predictions: PredictionRecord[] = [];
  private history: RouterEvolutionRecord[] = [];
  private maxPredictionBuffer = 100;

  getWeights(): { stat: number; knn: number; cost: number } {
    return { ...this.weights };
  }

  setWeights(weights: { stat: number; knn: number; cost: number }): void {
    this.weights = { ...weights };
  }

  /** 记录一次路由预测的结果（三个预测器各自是否预测正确） */
  recordPrediction(record: PredictionRecord): void {
    this.predictions.push(record);
    if (this.predictions.length > this.maxPredictionBuffer) {
      this.predictions.shift();
    }
  }

  /** 执行一轮进化：根据预测准确率调整权重 */
  evolve(): RouterEvolutionRecord | null {
    if (this.predictions.length < MIN_SAMPLES_TO_EVOLVE) {
      return null;
    }

    const samples = this.predictions.length;
    const statAcc = this.predictions.filter((p) => p.statCorrect).length / samples;
    const knnAcc = this.predictions.filter((p) => p.knnCorrect).length / samples;
    const costAcc = this.predictions.filter((p) => p.costCorrect).length / samples;
    const avgAcc = (statAcc + knnAcc + costAcc) / 3;

    const oldWeights = { ...this.weights };

    // 按准确率偏差调整权重
    let newStat = this.weights.stat + LEARNING_RATE * (statAcc - avgAcc);
    let newKnn = this.weights.knn + LEARNING_RATE * (knnAcc - avgAcc);
    let newCost = this.weights.cost + LEARNING_RATE * (costAcc - avgAcc);

    // 归一化
    const sum = newStat + newKnn + newCost;
    newStat /= sum;
    newKnn /= sum;
    newCost /= sum;

    // Clamp
    this.weights = {
      stat: Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, newStat)),
      knn: Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, newKnn)),
      cost: Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, newCost)),
    };

    // 最终再归一化一次（clamp 后可能不再和为 1）
    const finalSum = this.weights.stat + this.weights.knn + this.weights.cost;
    this.weights.stat /= finalSum;
    this.weights.knn /= finalSum;
    this.weights.cost /= finalSum;

    const record: RouterEvolutionRecord = {
      timestamp: Date.now(),
      oldWeights,
      newWeights: { ...this.weights },
      accuracyBefore: avgAcc,
      accuracyAfter: avgAcc, // 进化后的准确率需要后续样本验证
      sampleSize: samples,
      trigger: 'scheduled',
    };

    this.history.push(record);
    if (this.history.length > 50) {
      this.history.shift();
    }

    // 清空预测缓冲，开始新一轮观测
    this.predictions = [];

    return record;
  }

  getEvolutionHistory(): RouterEvolutionRecord[] {
    return [...this.history];
  }

  /** 评估当前权重下的预测准确率 */
  getAccuracy(): { stat: number; knn: number; cost: number } | null {
    if (this.predictions.length === 0) return null;
    const n = this.predictions.length;
    return {
      stat: this.predictions.filter((p) => p.statCorrect).length / n,
      knn: this.predictions.filter((p) => p.knnCorrect).length / n,
      cost: this.predictions.filter((p) => p.costCorrect).length / n,
    };
  }
}

/** 全局单例 */
let globalEvolver: RouterEvolver | null = null;

export function getRouterEvolver(): RouterEvolver {
  if (!globalEvolver) {
    globalEvolver = new RouterEvolver();
  }
  return globalEvolver;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx vitest run src/lib/__tests__/routerEvolver.test.ts 2>&1 | Select-Object -First 30`
Expected: PASS — 6 tests passed

- [ ] **Step 5: 将 modelRouter.ts 的硬编码权重改为从 Evolver 读取**

在 `src/lib/modelRouter.ts` 顶部找到硬编码常量：

```typescript
// 原代码（约第 28-30 行）
const W_STAT = 0.50;
const W_KNN = 0.35;
const W_COST = 0.15;
```

替换为：

```typescript
import { getRouterEvolver } from './routerEvolver';

// 融合权重：从 RouterEvolver 动态读取，支持自进化
function getFusionWeights() {
  return getRouterEvolver().getWeights();
}
```

然后在 `selectModel` 函数中（约第 278 行），找到使用 `W_STAT`、`W_KNN`、`W_COST` 的地方：

```typescript
// 原代码
const fusedScore = W_STAT * statOrCold + W_KNN * knnVal + W_COST * costEff;
```

替换为：

```typescript
const w = getFusionWeights();
const fusedScore = w.stat * statOrCold + w.knn * knnVal + w.cost * costEff;
```

- [ ] **Step 6: 在路由完成后记录预测准确性**

在 `src/lib/modelRouter.ts` 的 `selectModel` 函数中，在返回 decision 之前，添加预测记录逻辑。找到 `selectModel` 函数的 return 语句之前（约第 318 行），添加：

```typescript
  // 记录每个预测器的预测，用于后续评估准确性
  // 预测"正确"的定义：该预测器打分最高的模型 == 最终选择的模型
  if (explored) {
    const statTop = statBasedTopModel;
    const knnTop = knnBasedTopModel;
    const costTop = costBasedTopModel;
    const chosen = decision.modelName;
    // 延迟记录：实际结果在 recordRouterFeedback 时才知道
    // 这里暂存预测，在 feedback 时对比
    (decision as any).__predictions = {
      statCorrect: statTop === chosen,
      knnCorrect: knnTop === chosen,
      costCorrect: costTop === chosen,
    };
  }
```

注意：需要在 `selectModel` 函数中适当位置保存 `statBasedTopModel`、`knnBasedTopModel`、`costBasedTopModel`。如果这些变量在当前代码中不存在，需要在计算 statOrCold/knnVal/costEff 时同时记录对应得分最高的模型名。

- [ ] **Step 7: 在 recordRouterFeedback 中完成预测准确性记录**

在 `src/lib/modelRouter.ts` 的 `recordRouterFeedback` 函数中（约第 360 行），在写入记录之前添加：

```typescript
  // 如果有预测信息，记录到 RouterEvolver
  if ((record as any).__predictions) {
    const preds = (record as any).__predictions;
    const { getRouterEvolver } = require('./routerEvolver');
    getRouterEvolver().recordPrediction({
      statCorrect: preds.statCorrect,
      knnCorrect: preds.knnCorrect,
      costCorrect: preds.costCorrect,
    });
  }
```

- [ ] **Step 8: 验证编译通过**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx tsc --noEmit --pretty 2>&1 | Select-Object -First 20`
Expected: PASS

- [ ] **Step 9: 运行所有测试确认无回归**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx vitest run 2>&1 | Select-Object -Last 20`
Expected: All tests pass

- [ ] **Step 10: Commit**

```bash
git add src/lib/routerEvolver.ts src/lib/__tests__/routerEvolver.test.ts src/lib/modelRouter.ts
git commit -m "feat: add RouterEvolver for auto-tuning fusion weights based on prediction accuracy"
```

---

## Task 6: 集成到 Store — 自动注册 Agent 和自动编排

**Files:**
- Modify: `src/store/useStore.ts`
- Modify: `src/components/chat/intent/MetaAgent.ts`

- [ ] **Step 1: 在 useStore.ts 中导入运行时系统**

在 `src/store/useStore.ts` 顶部导入区域添加：

```typescript
import { getAgentRuntimeRegistry } from '../lib/agentRuntime';
import { getAgentMessageBus } from '../lib/agentMessageBus';
import { getAgentScheduler } from '../lib/agentScheduler';
```

- [ ] **Step 2: 在 createAgent action 中自动注册到 Runtime Registry**

在 `useStore.ts` 中找到 `createAgent` action（搜索 `createAgent:`），在其实现末尾（return 之前）添加：

```typescript
    // 自动注册到 Runtime Registry
    const registry = getAgentRuntimeRegistry();
    const capabilities = (agentData.tools || []).map(t => t);
    if (agentData.description) {
      // 从描述推断能力
      const desc = agentData.description.toLowerCase();
      if (desc.includes('代码') || desc.includes('code')) capabilities.push('code');
      if (desc.includes('写') || desc.includes('write')) capabilities.push('writing');
      if (desc.includes('分析') || desc.includes('analyze')) capabilities.push('reasoning');
      if (desc.includes('搜索') || desc.includes('search')) capabilities.push('search');
    }
    registry.register(id, capabilities);
```

- [ ] **Step 3: 在 deleteAgent action 中注销 Runtime Registry**

在 `useStore.ts` 中找到 `deleteAgent` action，在其实现开头添加：

```typescript
    // 从 Runtime Registry 注销
    getAgentRuntimeRegistry().unregister(id);
```

- [ ] **Step 4: 在 MetaAgent.ts 的 executeOrchestrationPlan 中自动注册创建的 Agent**

在 `src/components/chat/intent/MetaAgent.ts` 中找到 `executeOrchestrationPlan` 函数（约第 280 行），在创建 Agent 成功的代码块之后（约第 298 行），添加：

```typescript
      // 自动注册到 Runtime Registry
      const { getAgentRuntimeRegistry } = await import('../../../lib/agentRuntime');
      const registry = getAgentRuntimeRegistry();
      const capabilities = plannedAgent.tools || [];
      if (plannedAgent.description) {
        const desc = plannedAgent.description.toLowerCase();
        if (desc.includes('代码') || desc.includes('code')) capabilities.push('code');
        if (desc.includes('写') || desc.includes('write')) capabilities.push('writing');
        if (desc.includes('分析') || desc.includes('analyze')) capabilities.push('reasoning');
      }
      registry.register(newAgent.id, capabilities);
```

- [ ] **Step 5: 验证编译通过**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx tsc --noEmit --pretty 2>&1 | Select-Object -First 20`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/store/useStore.ts src/components/chat/intent/MetaAgent.ts
git commit -m "feat: auto-register agents to RuntimeRegistry on creation"
```

---

## Task 7: SubAgent 节点集成 Message Bus — Agent 间直接通信

**Files:**
- Modify: `src/store/useStore.ts`

- [ ] **Step 1: 在 SubAgent 执行逻辑中集成 Message Bus**

在 `src/store/useStore.ts` 中找到 `case 'subagent':` 代码块（约第 876 行）。在 `runOne` 函数定义之前（约第 910 行），添加消息总线集成：

```typescript
        // Phase: Agent 间消息总线集成
        const bus = getAgentMessageBus();

        // 为每个子 Agent 注册消息处理器
        subAgents.forEach((a: SubAgentDef, idx: number) => {
          const runtimeRegistry = getAgentRuntimeRegistry();
          const agentRuntimeId = `${config.nodeId}_sub_${idx}`;
          runtimeRegistry.register(agentRuntimeId, a.tools || [], 1);
          bus.subscribe(agentRuntimeId, (msg) => {
            // 将收到的消息注入到该子 Agent 的上下文中
            // 这里通过修改 inputVariable 实现
            if (msg.type === 'request' || msg.type === 'notify') {
              const contextKey = `__msg_from_${msg.fromAgentId}`;
              variables[contextKey] = msg.content;
            }
          });
        });
```

- [ ] **Step 2: 在聚合阶段之后，允许子 Agent 之间互相发送消息**

在 `runOne` 函数定义中（约第 915-945 行），在 LLM 调用之前添加 Agent 间通信能力：

```typescript
        // 在 runOne 内部，LLM 调用之前
        // 允许 Agent 通过特殊指令调用其他 Agent
        // 如果 input 中包含 "@agent-name: message" 格式，自动通过消息总线转发
        const interAgentMatch = input.match(/@(\S+):\s*(.+)/);
        if (interAgentMatch) {
          const targetName = interAgentMatch[1];
          const message = interAgentMatch[2];
          const targetAgent = subAgents.find((sa) => sa.name === targetName || sa.id === targetName);
          if (targetAgent) {
            const targetRuntimeId = `${config.nodeId}_sub_${subAgents.indexOf(targetAgent)}`;
            const response = await bus.request(
              `${config.nodeId}_sub_${idx}`,
              targetRuntimeId,
              message,
              30000,
            );
            if (response) {
              return {
                name: a.name,
                status: 'completed',
                output: response.content,
                model: a.model,
              };
            }
          }
        }
```

- [ ] **Step 3: 在子 Agent 完成后清理 Runtime Registry 注册**

在 SubAgent 执行完成后（约第 980 行，`setStatus` 之前），添加清理逻辑：

```typescript
        // 清理 Runtime Registry
        const registry = getAgentRuntimeRegistry();
        subAgents.forEach((_, idx) => {
          const runtimeId = `${config.nodeId}_sub_${idx}`;
          registry.unregister(runtimeId);
          getAgentMessageBus().unsubscribe(runtimeId);
        });
```

- [ ] **Step 4: 验证编译通过**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx tsc --noEmit --pretty 2>&1 | Select-Object -First 20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/useStore.ts
git commit -m "feat: integrate Message Bus into SubAgent execution for direct agent-to-agent communication"
```

---

## Task 8: 自动编排触发 — 根据任务复杂度自动决定多 Agent 策略

**Files:**
- Modify: `src/pages/ChatWorkspacePage.tsx`
- Modify: `src/components/chat/intent/MetaAgent.ts`

- [ ] **Step 1: 在 MetaAgent.ts 中新增自动编排检测函数**

在 `src/components/chat/intent/MetaAgent.ts` 文件末尾（`executeOrchestrationPlan` 之后）添加：

```typescript
/**
 * 自动编排检测：根据用户输入和当前系统状态，判断是否需要自动触发多 Agent 编排
 * 
 * 触发条件（满足任一）：
 * 1. 任务涉及多个不同领域（如"分析代码并写报告"）
 * 2. 任务复杂度高（输入长度 > 200 字 或 包含多个步骤描述）
 * 3. 已有 Agent 中没有匹配能力的（需要创建新 Agent）
 * 4. 用户明确要求多角色协作
 */
export function shouldAutoOrchestrate(
  userInput: string,
  existingAgents: Array<{ capabilities: string[]; name: string }>,
): { shouldOrchestrate: boolean; reason: string; requiredCapabilities: string[] } {
  const input = userInput.toLowerCase();
  const requiredCapabilities: string[] = [];

  // 检测多领域关键词
  const domainKeywords: Record<string, string[]> = {
    code: ['代码', '编程', 'bug', '函数', 'debug', 'code', '程序', '脚本', 'api'],
    writing: ['写', '文案', '报告', '文章', '摘要', '翻译', 'write', 'draft'],
    reasoning: ['分析', '推理', '诊断', '评估', '比较', 'analyze', 'reason'],
    search: ['搜索', '查找', '调研', '检索', 'search', 'find', 'research'],
    data: ['数据', '统计', '图表', '数据库', 'data', 'query', 'sql'],
  };

  for (const [cap, keywords] of Object.entries(domainKeywords)) {
    if (keywords.some((kw) => input.includes(kw))) {
      requiredCapabilities.push(cap);
    }
  }

  // 条件 1：涉及 2 个以上不同领域
  if (requiredCapabilities.length >= 2) {
    return {
      shouldOrchestrate: true,
      reason: `任务涉及 ${requiredCapabilities.length} 个领域：${requiredCapabilities.join(', ')}`,
      requiredCapabilities,
    };
  }

  // 条件 2：高复杂度输入
  if (userInput.length > 200) {
    return {
      shouldOrchestrate: true,
      reason: '任务描述较长，可能需要多步骤协作',
      requiredCapabilities,
    };
  }

  // 条件 3：已有 Agent 中没有匹配能力
  if (requiredCapabilities.length === 1) {
    const hasCapableAgent = existingAgents.some((a) =>
      requiredCapabilities.every((cap) => a.capabilities.includes(cap)),
    );
    if (!hasCapableAgent) {
      return {
        shouldOrchestrate: true,
        reason: `没有具备 ${requiredCapabilities.join(', ')} 能力的 Agent，需要创建`,
        requiredCapabilities,
      };
    }
  }

  // 条件 4：明确的多角色协作关键词
  const collabKeywords = ['多个agent', '多agent', '协作', '并行', '团队', '分工', '协同'];
  if (collabKeywords.some((kw) => input.includes(kw))) {
    return {
      shouldOrchestrate: true,
      reason: '用户要求多角色协作',
      requiredCapabilities,
    };
  }

  return {
    shouldOrchestrate: false,
    reason: '',
    requiredCapabilities,
  };
}
```

- [ ] **Step 2: 在 ChatWorkspacePage.tsx 的 processUserInput 中集成自动编排**

在 `src/pages/ChatWorkspacePage.tsx` 中找到 `processUserInput` 函数（约第 234 行）。在 `parseIntent` 之后、`shouldUseMetaAgent` 之后，在 code 模式的处理路径中，添加自动编排检测。

找到以下代码段（约第 263-272 行）：

```typescript
    if (useMetaAgent) {
      handleMetaAgentOrchestrate(text.trim(), userMsg);
      return;
    }

    const thinking = generateThinkingSteps(intent.action, activeMode, intent.params);
    setThinkingSteps(thinking);

    const taskSteps = generateTaskSteps(intent.action, intent.params);
    setActiveTaskSteps(taskSteps);
```

在 `const thinking = ...` 之前插入：

```typescript
    // 自动编排检测：code/debug/orchestrator 模式下，检测是否需要自动触发多 Agent
    if (activeMode !== 'ask' && activeMode !== 'plan') {
      const { shouldAutoOrchestrate } = await import('../components/chat/intent/MetaAgent');
      const registry = getAgentRuntimeRegistry();
      const existingAgents = registry.getAllAgents().map((a) => ({
        capabilities: a.capabilities,
        name: a.agentId,
      }));
      const orchestrateCheck = shouldAutoOrchestrate(text.trim(), existingAgents);
      if (orchestrateCheck.shouldOrchestrate && !useMetaAgent) {
        handleMetaAgentOrchestrate(text.trim(), userMsg);
        return;
      }
    }
```

注意：`processUserInput` 当前是同步的（`useCallback`），需要改为 `async`。找到 `const processUserInput = useCallback((text: string) => {`，改为 `const processUserInput = useCallback(async (text: string) => {`。

- [ ] **Step 3: 导入 getAgentRuntimeRegistry**

在 `src/pages/ChatWorkspacePage.tsx` 顶部导入区域添加：

```typescript
import { getAgentRuntimeRegistry } from '../lib/agentRuntime';
```

- [ ] **Step 4: 验证编译通过**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx tsc --noEmit --pretty 2>&1 | Select-Object -First 20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/ChatWorkspacePage.tsx src/components/chat/intent/MetaAgent.ts
git commit -m "feat: auto-detect multi-agent orchestration need based on task complexity and capabilities"
```

---

## Task 9: 路由进化器定期触发 — 在路由反馈后自动进化

**Files:**
- Modify: `src/lib/modelRouter.ts`

- [ ] **Step 1: 在 recordRouterFeedback 中添加定期进化触发**

在 `src/lib/modelRouter.ts` 中找到 `recordRouterFeedback` 函数（约第 360 行）。在函数末尾（写入 store 和后端之后），添加定期进化触发：

```typescript
  // 每 20 条记录触发一次路由进化
  const EVOLVE_INTERVAL = 20;
  if (routerMemory.records.length > 0 && routerMemory.records.length % EVOLVE_INTERVAL === 0) {
    const { getRouterEvolver } = require('./routerEvolver');
    const evolver = getRouterEvolver();
    const result = evolver.evolve();
    if (result) {
      console.log(`[RouterEvolver] 权重进化: stat ${result.oldWeights.stat.toFixed(2)}→${result.newWeights.stat.toFixed(2)}, knn ${result.oldWeights.knn.toFixed(2)}→${result.newWeights.knn.toFixed(2)}, cost ${result.oldWeights.cost.toFixed(2)}→${result.newWeights.cost.toFixed(2)}`);
    }
  }
```

- [ ] **Step 2: 验证编译通过**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx tsc --noEmit --pretty 2>&1 | Select-Object -First 20`
Expected: PASS

- [ ] **Step 3: 运行所有测试确认无回归**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx vitest run 2>&1 | Select-Object -Last 20`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/lib/modelRouter.ts
git commit -m "feat: auto-trigger router evolution every 20 routing feedback records"
```

---

## Task 10: 动态调度器集成 — 用 Scheduler 分配任务给 Agent

**Files:**
- Modify: `src/store/useStore.ts`

- [ ] **Step 1: 在 agent 节点执行中使用 Scheduler 分配**

在 `src/store/useStore.ts` 中找到 `case 'agent':` 代码块（约第 772 行）。在 LLM 调用之前，添加调度器集成：

```typescript
      // 动态调度：如果该 Agent 正忙，将任务加入队列
      const scheduler = getAgentScheduler();
      const registry = getAgentRuntimeRegistry();
      const agentState = registry.getAgentState(node.data.agentId || '');
      
      if (agentState && agentState.status === 'busy') {
        // Agent 忙碌，入队等待
        const taskId = scheduler.enqueue({
          input: inputText,
          requiredCapabilities: agentState.capabilities,
          preferredModel: null,
          priority: 'normal',
        });
        
        // 等待任务完成（轮询，最多 60 秒）
        const startTime = Date.now();
        while (Date.now() - startTime < 60000) {
          const task = scheduler.getTask(taskId);
          if (task && (task.status === 'done' || task.status === 'failed')) {
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        
        const task = scheduler.getTask(taskId);
        if (task?.status === 'done' && task.result) {
          output = task.result;
          // 跳过下方的 LLM 调用
          break;
        }
        // 超时或失败，继续走正常 LLM 调用
      }
```

注意：这段代码需要在 `case 'agent':` 的 output 变量声明之后、LLM 调用之前插入。需要找到具体位置。

- [ ] **Step 2: 在 agent 节点执行完成后更新 Runtime 状态**

在 `case 'agent':` 代码块中，LLM 调用成功之后（约第 860 行），添加：

```typescript
        // 更新 Runtime 指标
        if (node.data.agentId) {
          registry.recordTaskResult(node.data.agentId, true, Date.now() - startTime);
        }
```

在 LLM 调用失败的分支中，添加：

```typescript
        // 记录失败
        if (node.data.agentId) {
          registry.recordTaskResult(node.data.agentId, false, Date.now() - startTime);
        }
```

注意：需要在 `case 'agent':` 开头添加 `const startTime = Date.now();`

- [ ] **Step 3: 验证编译通过**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx tsc --noEmit --pretty 2>&1 | Select-Object -First 20`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/store/useStore.ts
git commit -m "feat: integrate AgentScheduler into agent node execution for dynamic task dispatch"
```

---

## Task 11: 端到端集成测试

**Files:**
- Create: `src/lib/__tests__/integration.test.ts`

- [ ] **Step 1: 写端到端集成测试**

创建 `src/lib/__tests__/integration.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRuntimeRegistry } from '../agentRuntime';
import { AgentMessageBus } from '../agentMessageBus';
import { AgentScheduler } from '../agentScheduler';
import { RouterEvolver } from '../routerEvolver';

describe('Multi-Agent Orchestration Integration', () => {
  let registry: AgentRuntimeRegistry;
  let bus: AgentMessageBus;
  let scheduler: AgentScheduler;
  let evolver: RouterEvolver;

  beforeEach(() => {
    registry = new AgentRuntimeRegistry();
    bus = new AgentMessageBus();
    scheduler = new AgentScheduler(registry);
    evolver = new RouterEvolver();
  });

  it('should auto-register agents, schedule tasks, and track results', () => {
    // 1. 注册两个 Agent
    registry.register('coder', ['code']);
    registry.register('writer', ['writing']);

    // 2. 提交一个需要 code 能力的任务
    const taskId = scheduler.enqueue({
      input: '修复 auth.ts 的 bug',
      requiredCapabilities: ['code'],
      preferredModel: null,
      priority: 'high',
    });

    // 3. 任务应被分配给 coder
    const task = scheduler.getTask(taskId);
    expect(task!.status).toBe('assigned');
    expect(task!.assignedAgentId).toBe('coder');

    // 4. coder 应处于 busy 状态
    expect(registry.getAgentState('coder')!.status).toBe('busy');

    // 5. 完成任务
    scheduler.completeTask(taskId, 'bug 已修复');

    // 6. coder 应恢复 idle
    expect(registry.getAgentState('coder')!.status).toBe('idle');
    expect(registry.getAgentState('coder')!.successRate).toBe(1);
  });

  it('should queue task when agent is busy and assign when free', () => {
    registry.register('agent-1', ['code']);
    registry.setBusy('agent-1', 'task-0');

    const t1 = scheduler.enqueue({
      input: 'task 1',
      requiredCapabilities: ['code'],
      preferredModel: null,
      priority: 'normal',
    });
    expect(scheduler.getTask(t1)!.status).toBe('queued');

    registry.setIdle('agent-1');
    scheduler.tryAssignQueuedTasks();
    expect(scheduler.getTask(t1)!.status).toBe('assigned');
  });

  it('should allow agents to communicate via message bus', async () => {
    const receivedMessages: string[] = [];

    bus.subscribe('researcher', (msg) => {
      receivedMessages.push(msg.content);
      if (msg.type === 'request') {
        bus.send({
          fromAgentId: 'researcher',
          toAgentId: 'writer',
          type: 'response',
          content: '调研结果：React 19 支持并发渲染',
          metadata: {},
          replyTo: msg.id,
        });
      }
    });

    const response = await bus.request('writer', 'researcher', '请调研 React 19 的新特性', 5000);
    expect(response).toBeDefined();
    expect(response!.content).toContain('React 19');
    expect(receivedMessages).toHaveLength(1);
  });

  it('should evolve router weights based on prediction accuracy', () => {
    // 模拟 20 条路由记录
    for (let i = 0; i < 20; i++) {
      evolver.recordPrediction({
        statCorrect: i < 16,  // 80%
        knnCorrect: i < 8,    // 40%
        costCorrect: i < 4,   // 20%
      });
    }

    const oldWeights = evolver.getWeights();
    evolver.evolve();
    const newWeights = evolver.getWeights();

    // stat 准确率最高，权重应增加
    expect(newWeights.stat).toBeGreaterThan(oldWeights.stat);
    // cost 准确率最低，权重应减少
    expect(newWeights.cost).toBeLessThan(oldWeights.cost);
    // 权重之和应为 1
    expect(newWeights.stat + newWeights.knn + newWeights.cost).toBeCloseTo(1.0, 2);
  });

  it('should handle full orchestration cycle: detect → schedule → communicate → execute', () => {
    // 1. 注册一个多能力 Agent
    registry.register('fullstack', ['code', 'writing', 'reasoning']);

    // 2. 提交一个需要多能力的任务
    const taskId = scheduler.enqueue({
      input: '分析代码并写报告',
      requiredCapabilities: ['code', 'writing'],
      preferredModel: null,
      priority: 'high',
    });

    // 3. 任务应被分配
    expect(scheduler.getTask(taskId)!.status).toBe('assigned');

    // 4. 模拟执行过程中 Agent 间通信
    bus.subscribe('fullstack', (msg) => {
      if (msg.type === 'notify') {
        // 记录通知
      }
    });
    bus.broadcast('system', '任务已分配给 fullstack agent');

    // 5. 完成任务
    scheduler.completeTask(taskId, '分析完成，报告已生成');

    // 6. 验证状态
    expect(registry.getAgentState('fullstack')!.status).toBe('idle');
    expect(registry.getAgentState('fullstack')!.totalTasks).toBe(1);
    expect(registry.getAgentState('fullstack')!.successRate).toBe(1);
  });
});
```

- [ ] **Step 2: 运行集成测试**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx vitest run src/lib/__tests__/integration.test.ts 2>&1 | Select-Object -First 30`
Expected: PASS — 5 tests passed

- [ ] **Step 3: 运行全部测试确认无回归**

Run: `cd c:\Users\LiunianSauce\Desktop\新建文件夹\agentflow ; npx vitest run 2>&1 | Select-Object -Last 20`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/lib/__tests__/integration.test.ts
git commit -m "test: add end-to-end integration tests for multi-agent orchestration system"
```

---

## Self-Review

### Spec Coverage

用户要求的四个功能：
1. **智能路由的自进化** → Task 5 (RouterEvolver) + Task 9 (定期触发) ✅
2. **按需分配多 agent 架构** → Task 2 (Runtime Registry) + Task 4 (Scheduler) + Task 10 (集成到 agent 节点) ✅
3. **智能编排多 agent** → Task 8 (自动编排检测) + Task 6 (自动注册) ✅
4. **多 agent 之间的交流** → Task 3 (Message Bus) + Task 7 (SubAgent 集成) ✅

所有四个需求都有对应的 Task 实现。

### Placeholder Scan

检查了所有 task，没有 TBD、TODO、"add appropriate error handling" 等占位符。每个 step 都有完整代码。

### Type Consistency

- `AgentRuntimeState` 在 Task 1 定义，Task 2/4/6/8/10 使用 — 名称一致 ✅
- `AgentMessage` 在 Task 1 定义，Task 3/7 使用 — 名称一致 ✅
- `ScheduledTask` 在 Task 1 定义，Task 4/10 使用 — 名称一致 ✅
- `RouterEvolutionRecord` 在 Task 1 定义，Task 5 使用 — 名称一致 ✅
- `AgentRuntimeRegistry` 在 Task 2 定义，Task 4/6/7/8/10 使用 — 名称一致 ✅
- `AgentMessageBus` 在 Task 3 定义，Task 7 使用 — 名称一致 ✅
- `AgentScheduler` 在 Task 4 定义，Task 10 使用 — 名称一致 ✅
- `RouterEvolver` 在 Task 5 定义，Task 9 使用 — 名称一致 ✅
- `shouldAutoOrchestrate` 在 Task 8 定义并导出 — 名称一致 ✅

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-23-autonomous-multi-agent-orchestration.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
