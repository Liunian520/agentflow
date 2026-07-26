export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  specialties: string[];
  capabilities: string[];
  systemPrompt: string;
  keywords?: string[];
  priority?: number;
}

export type RouterStrategy = 'intent' | 'keyword' | 'roundRobin';

export type CollaborationMode = 'serial' | 'parallel' | 'router';

export type AggregationMethod = 'first' | 'all' | 'best' | 'vote';

export interface RoutingResult {
  agent: AgentProfile;
  score: number;
  reason: string;
}

export interface SubAgentResult {
  agentId: string;
  agentName: string;
  success: boolean;
  output: string;
  error?: string;
  duration: number;
}

export interface MoARouterOptions {
  defaultStrategy?: RouterStrategy;
  defaultAggregation?: AggregationMethod;
}

export class MoARouter {
  private agents: AgentProfile[] = [];
  private roundRobinIndex = 0;
  private options: Required<MoARouterOptions>;

  constructor(agents: AgentProfile[] = [], options: MoARouterOptions = {}) {
    this.agents = agents;
    this.options = {
      defaultStrategy: options.defaultStrategy || 'intent',
      defaultAggregation: options.defaultAggregation || 'best',
    };
  }

  addAgent(agent: AgentProfile): void {
    this.agents.push(agent);
  }

  removeAgent(agentId: string): boolean {
    const index = this.agents.findIndex(a => a.id === agentId);
    if (index !== -1) {
      this.agents.splice(index, 1);
      return true;
    }
    return false;
  }

  getAgents(): AgentProfile[] {
    return [...this.agents];
  }

  route(query: string, strategy?: RouterStrategy): RoutingResult[] {
    const actualStrategy = strategy || this.options.defaultStrategy;

    switch (actualStrategy) {
      case 'keyword':
        return this.keywordRouting(query);
      case 'roundRobin':
        return this.roundRobin();
      case 'intent':
      default:
        return this.intentRouting(query);
    }
  }

  intentRouting(query: string): RoutingResult[] {
    if (this.agents.length === 0) {
      return [];
    }

    const results: RoutingResult[] = this.agents.map(agent => {
      let score = 0;
      const reasons: string[] = [];

      const queryLower = query.toLowerCase();
      const descriptionLower = agent.description.toLowerCase();
      const specialtiesLower = agent.specialties.map(s => s.toLowerCase());
      const capabilitiesLower = agent.capabilities.map(c => c.toLowerCase());

      for (const specialty of specialtiesLower) {
        if (queryLower.includes(specialty)) {
          score += 20;
          reasons.push(`匹配专长: ${specialty}`);
        }
      }

      for (const capability of capabilitiesLower) {
        if (queryLower.includes(capability)) {
          score += 15;
          reasons.push(`匹配能力: ${capability}`);
        }
      }

      if (agent.keywords) {
        for (const keyword of agent.keywords) {
          if (queryLower.includes(keyword.toLowerCase())) {
            score += 10;
            reasons.push(`匹配关键词: ${keyword}`);
          }
        }
      }

      const descriptionWords = descriptionLower.split(/\s+/).filter(w => w.length > 2);
      for (const word of descriptionWords) {
        if (queryLower.includes(word)) {
          score += 5;
        }
      }

      if (agent.priority) {
        score += agent.priority;
      }

      return {
        agent,
        score,
        reason: reasons.length > 0 ? reasons.join('; ') : '默认选择',
      };
    });

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  keywordRouting(query: string): RoutingResult[] {
    if (this.agents.length === 0) {
      return [];
    }

    const queryLower = query.toLowerCase();
    const results: RoutingResult[] = [];

    for (const agent of this.agents) {
      let score = 0;
      const matchedKeywords: string[] = [];

      if (agent.keywords && agent.keywords.length > 0) {
        for (const keyword of agent.keywords) {
          if (queryLower.includes(keyword.toLowerCase())) {
            score += 10;
            matchedKeywords.push(keyword);
          }
        }
      }

      for (const specialty of agent.specialties) {
        if (queryLower.includes(specialty.toLowerCase())) {
          score += 5;
          matchedKeywords.push(specialty);
        }
      }

      if (score > 0) {
        results.push({
          agent,
          score,
          reason: `匹配关键词: ${matchedKeywords.join(', ')}`,
        });
      }
    }

    if (results.length === 0 && this.agents.length > 0) {
      return [
        {
          agent: this.agents[0],
          score: 0,
          reason: '无匹配关键词，返回第一个 Agent',
        },
      ];
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  roundRobin(): RoutingResult[] {
    if (this.agents.length === 0) {
      return [];
    }

    const agent = this.agents[this.roundRobinIndex % this.agents.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % this.agents.length;

    return [
      {
        agent,
        score: 100,
        reason: `轮询选择 (索引: ${(this.roundRobinIndex - 1 + this.agents.length) % this.agents.length})`,
      },
    ];
  }

  async executeSerial(
    query: string,
    executor: (agent: AgentProfile, input: string) => Promise<string>
  ): Promise<{ results: SubAgentResult[]; finalOutput: string }> {
    const results: SubAgentResult[] = [];
    let currentInput = query;

    for (const agent of this.agents) {
      const startTime = Date.now();
      try {
        const output = await executor(agent, currentInput);
        results.push({
          agentId: agent.id,
          agentName: agent.name,
          success: true,
          output,
          duration: Date.now() - startTime,
        });
        currentInput = output;
      } catch (err: any) {
        results.push({
          agentId: agent.id,
          agentName: agent.name,
          success: false,
          output: '',
          error: err?.message || '执行失败',
          duration: Date.now() - startTime,
        });
        break;
      }
    }

    const lastSuccess = [...results].reverse().find(r => r.success);
    return {
      results,
      finalOutput: lastSuccess?.output || '',
    };
  }

  async executeParallel(
    query: string,
    executor: (agent: AgentProfile, input: string) => Promise<string>,
    aggregationMethod?: AggregationMethod
  ): Promise<{ results: SubAgentResult[]; finalOutput: string }> {
    const promises = this.agents.map(async agent => {
      const startTime = Date.now();
      try {
        const output = await executor(agent, query);
        return {
          agentId: agent.id,
          agentName: agent.name,
          success: true,
          output,
          duration: Date.now() - startTime,
        } as SubAgentResult;
      } catch (err: any) {
        return {
          agentId: agent.id,
          agentName: agent.name,
          success: false,
          output: '',
          error: err?.message || '执行失败',
          duration: Date.now() - startTime,
        } as SubAgentResult;
      }
    });

    const results = await Promise.all(promises);
    const method = aggregationMethod || this.options.defaultAggregation;
    const finalOutput = this.aggregateResults(results, method);

    return { results, finalOutput };
  }

  async executeRouter(
    query: string,
    executor: (agent: AgentProfile, input: string) => Promise<string>,
    strategy?: RouterStrategy
  ): Promise<{ results: SubAgentResult[]; finalOutput: string; routing: RoutingResult[] }> {
    const routingResults = this.route(query, strategy);
    if (routingResults.length === 0) {
      return {
        results: [],
        finalOutput: '',
        routing: [],
      };
    }

    const bestAgent = routingResults[0].agent;
    const startTime = Date.now();

    try {
      const output = await executor(bestAgent, query);
      const result: SubAgentResult = {
        agentId: bestAgent.id,
        agentName: bestAgent.name,
        success: true,
        output,
        duration: Date.now() - startTime,
      };
      return {
        results: [result],
        finalOutput: output,
        routing: routingResults,
      };
    } catch (err: any) {
      const result: SubAgentResult = {
        agentId: bestAgent.id,
        agentName: bestAgent.name,
        success: false,
        output: '',
        error: err?.message || '执行失败',
        duration: Date.now() - startTime,
      };
      return {
        results: [result],
        finalOutput: '',
        routing: routingResults,
      };
    }
  }

  private aggregateResults(results: SubAgentResult[], method: AggregationMethod): string {
    const successResults = results.filter(r => r.success);

    if (successResults.length === 0) {
      return '';
    }

    switch (method) {
      case 'first':
        return successResults[0].output;

      case 'all':
        return successResults
          .map(r => `【${r.agentName}】\n${r.output}`)
          .join('\n\n');

      case 'best':
        const best = successResults.reduce((prev, curr) =>
          curr.duration < prev.duration ? curr : prev
        );
        return best.output;

      case 'vote':
        const outputMap = new Map<string, { count: number; output: string }>();
        for (const r of successResults) {
          const key = r.output.trim();
          const existing = outputMap.get(key);
          if (existing) {
            existing.count++;
          } else {
            outputMap.set(key, { count: 1, output: r.output });
          }
        }
        let maxCount = 0;
        let votedOutput = '';
        for (const { count, output } of outputMap.values()) {
          if (count > maxCount) {
            maxCount = count;
            votedOutput = output;
          }
        }
        return votedOutput || successResults[0].output;

      default:
        return successResults[0].output;
    }
  }

  resetRoundRobin(): void {
    this.roundRobinIndex = 0;
  }
}
