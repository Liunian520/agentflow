import type { MCPTool } from '../types';

export interface SearchableTool {
  name: string;
  description: string;
  keywords?: string[];
  serverId?: string;
  serverName?: string;
}

export interface ToolSearchResult {
  tool: SearchableTool;
  score: number;
  matchedTerms: string[];
}

function tokenize(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const words = lower.split(/[\s_./\\\-]+/).filter((w) => w.length > 0);
  const tokens: string[] = [];
  for (const word of words) {
    tokens.push(word);
    if (word.length > 3) {
      for (let i = 3; i <= word.length; i++) {
        tokens.push(word.slice(0, i));
      }
    }
  }
  return [...new Set(tokens)];
}

function extractKeywordsFromSchema(schema: any): string[] {
  const keywords: string[] = [];
  if (!schema || typeof schema !== 'object') return keywords;

  if (schema.properties && typeof schema.properties === 'object') {
    for (const key of Object.keys(schema.properties)) {
      keywords.push(key);
      const prop = (schema.properties as Record<string, any>)[key];
      if (prop && typeof prop === 'object' && prop.description) {
        keywords.push(...String(prop.description).split(/\s+/).filter((w) => w.length > 2));
      }
    }
  }

  return keywords;
}

export class ToolSearchEngine {
  private tools: SearchableTool[] = [];
  private index: Map<string, Array<{ toolIdx: number; weight: number }>> = new Map();

  constructor(tools: SearchableTool[] = []) {
    this.setTools(tools);
  }

  setTools(tools: SearchableTool[]): void {
    this.tools = tools;
    this.buildIndex();
  }

  addTool(tool: SearchableTool): void {
    this.tools.push(tool);
    this.buildIndex();
  }

  addMCPTools(serverId: string, serverName: string, tools: MCPTool[]): void {
    const searchableTools: SearchableTool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      keywords: extractKeywordsFromSchema(t.inputSchema),
      serverId,
      serverName,
    }));
    this.tools = [...this.tools, ...searchableTools];
    this.buildIndex();
  }

  private buildIndex(): void {
    this.index = new Map();

    for (let i = 0; i < this.tools.length; i++) {
      const tool = this.tools[i];
      const nameTokens = tokenize(tool.name);
      const descTokens = tokenize(tool.description);
      const keywordTokens = tool.keywords ? tool.keywords.flatMap((k) => tokenize(k)) : [];

      const allTokens = new Set<string>();
      for (const t of nameTokens) allTokens.add(t);
      for (const t of descTokens) allTokens.add(t);
      for (const t of keywordTokens) allTokens.add(t);

      for (const token of allTokens) {
        let weight = 1;
        if (nameTokens.includes(token)) weight += 3;
        if (keywordTokens.includes(token)) weight += 2;
        if (descTokens.includes(token)) weight += 1;

        if (!this.index.has(token)) {
          this.index.set(token, []);
        }
        this.index.get(token)!.push({ toolIdx: i, weight });
      }
    }
  }

  search(query: string, topK: number = 10): ToolSearchResult[] {
    if (!query || !query.trim()) {
      return this.tools.map((tool, idx) => ({
        tool,
        score: 0,
        matchedTerms: [],
      }));
    }

    const queryTokens = tokenize(query.toLowerCase());
    if (queryTokens.length === 0) {
      return this.tools.map((tool) => ({
        tool,
        score: 0,
        matchedTerms: [],
      }));
    }

    const scores = new Map<number, number>();
    const matchedTermsMap = new Map<number, string[]>();

    for (const qToken of queryTokens) {
      const entries = this.index.get(qToken);
      if (!entries) continue;

      for (const entry of entries) {
        const currentScore = scores.get(entry.toolIdx) || 0;
        scores.set(entry.toolIdx, currentScore + entry.weight);

        if (!matchedTermsMap.has(entry.toolIdx)) {
          matchedTermsMap.set(entry.toolIdx, []);
        }
        matchedTermsMap.get(entry.toolIdx)!.push(qToken);
      }
    }

    const results: ToolSearchResult[] = [];
    for (const [toolIdx, score] of scores.entries()) {
      const tool = this.tools[toolIdx];
      const exactNameMatch = tool.name.toLowerCase() === query.toLowerCase() ? 10 : 0;
      const nameStartsWith = tool.name.toLowerCase().startsWith(query.toLowerCase()) ? 5 : 0;
      const finalScore = score + exactNameMatch + nameStartsWith;

      results.push({
        tool,
        score: finalScore,
        matchedTerms: [...new Set(matchedTermsMap.get(toolIdx) || [])],
      });
    }

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK);
  }

  getAllTools(): SearchableTool[] {
    return [...this.tools];
  }
}
