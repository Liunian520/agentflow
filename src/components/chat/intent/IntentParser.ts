/**
 * AgentFlow 意图解析引擎 — 前端预解析层
 * 基于关键词匹配的快速意图识别，将自然语言翻译为结构化操作指令
 */

import type { ParsedIntent, IntentAction } from '../../../types';

interface IntentPattern {
  pattern: RegExp;
  action: IntentAction;
  extractParams: (text: string) => Record<string, any>;
  minConfidence: number;
}

// 模型关键词映射
const modelKeywords: Record<string, string> = {
  'gpt-4o': 'GPT-4o',
  'gpt4o': 'GPT-4o',
  'gpt-4': 'GPT-4o',
  'gpt4': 'GPT-4o',
  'claude': 'Claude 3.5 Sonnet',
  'claude3': 'Claude 3.5 Sonnet',
  'deepseek': 'DeepSeek V3',
  'gemini': 'Gemini 1.5 Pro',
  'doubao': '豆包',
  'qwen': '通义千问',
  'hunyuan': '混元',
  'spark': '星火',
};

// 工具关键词映射
const toolKeywords: Record<string, string> = {
  '搜索': 'web-search',
  '搜索工具': 'web-search',
  '联网': 'web-search',
  'web search': 'web-search',
  '代码': 'code-executor',
  '代码执行': 'code-executor',
  '编程': 'code-executor',
  'github': 'github',
  '语法': 'grammar-check',
  '语法检查': 'grammar-check',
  'seo': 'seo-tool',
  'python': 'python',
  '图表': 'chart-generator',
  '数据库': 'database',
  '分析数据': 'database',
};

// 节点关键词映射
const nodeKeywords: Record<string, { type: string; label: string }> = {
  '开始': { type: 'start', label: '开始' },
  '起点': { type: 'start', label: '开始' },
  '结束': { type: 'end', label: '结束' },
  '终点': { type: 'end', label: '结束' },
  '大模型': { type: 'llm', label: 'LLM 调用' },
  'ai': { type: 'llm', label: 'LLM 调用' },
  'llm': { type: 'llm', label: 'LLM 调用' },
  'agent': { type: 'agent', label: 'Agent' },
  '代码': { type: 'code', label: '代码执行' },
  'http': { type: 'http', label: 'HTTP 请求' },
  '请求': { type: 'http', label: 'HTTP 请求' },
  '接口': { type: 'http', label: 'HTTP 请求' },
  '条件': { type: 'condition', label: '条件判断' },
  '判断': { type: 'condition', label: '条件判断' },
  '分支': { type: 'condition', label: '条件判断' },
  '循环': { type: 'loop', label: '循环' },
  '遍历': { type: 'loop', label: '循环' },
  '变量': { type: 'variable', label: '变量操作' },
  '数据库': { type: 'database', label: '数据库' },
  '主机': { type: 'host', label: '远程主机' },
  'ssh': { type: 'host', label: '远程主机' },
  '远程': { type: 'host', label: '远程主机' },
  '知识': { type: 'knowledge', label: '知识库' },
  '模板': { type: 'template', label: '模板' },
  '人工': { type: 'human-in-loop', label: '人工审核' },
  '审核': { type: 'human-in-loop', label: '人工审核' },
  '子流程': { type: 'subworkflow', label: '子流程' },
};

// 意图匹配模式
const intentPatterns: IntentPattern[] = [
  // 创建 Agent
  {
    pattern: /创建|新建|添加|建.*agent|助手|智能体/i,
    action: 'create_agent',
    minConfidence: 0.8,
    extractParams: (text) => {
      const nameHint = extractAgentName(text);
      const modelHint = extractModel(text);
      const toolHints = extractTools(text);
      const descHint = extractDescription(text);

      return {
        name: nameHint || '新助手',
        description: descHint || `专业的${nameHint || 'AI'}助手`,
        model: modelHint || 'GPT-4o',
        systemPrompt: generateSystemPrompt(nameHint, descHint, toolHints),
        tools: toolHints,
        temperature: 0.7,
        avatar: pickAvatar(nameHint || descHint),
      };
    },
  },

  // 创建工作流
  {
    pattern: /创建|新建|设计|编排.*工作流|流程|pipeline|workflow/i,
    action: 'create_workflow',
    minConfidence: 0.8,
    extractParams: (text) => {
      const nameHint = extractWorkflowName(text);
      const nodeSequence = extractNodeSequence(text);

      return {
        name: nameHint || '新工作流',
        description: `基于对话创建的工作流`,
        nodeSequence,
      };
    },
  },

  // 运行工作流
  {
    pattern: /运行|执行|跑|启动.*工作流|workflow/i,
    action: 'run_workflow',
    minConfidence: 0.75,
    extractParams: (text) => ({
      workflowId: extractWorkflowId(text),
      workflowName: extractRunnableWorkflowName(text),
    }),
  },

  // SSH 命令
  {
    pattern: /ssh|远程|连接.*主机|在.*上执行|运维|命令/i,
    action: 'ssh_command',
    minConfidence: 0.7,
    extractParams: (text) => ({
      command: extractSSHCommand(text),
      hostId: extractHostId(text),
    }),
  },

  // 列出 Agent
  {
    pattern: /列出|查看|有哪些|显示.*agent|助手列表/i,
    action: 'list_agents',
    minConfidence: 0.85,
    extractParams: () => ({}),
  },

  // 列出工作流
  {
    pattern: /列出|查看|有哪些|显示.*工作流|流程列表/i,
    action: 'list_workflows',
    minConfidence: 0.85,
    extractParams: () => ({}),
  },

  // 查询状态
  {
    pattern: /状态|运行情况|进度|怎么样/i,
    action: 'query_status',
    minConfidence: 0.6,
    extractParams: (text) => ({
      target: text.includes('工作流') ? 'workflow' : text.includes('agent') ? 'agent' : 'general',
    }),
  },

  // 修改 Agent
  {
    pattern: /修改|更新|编辑|调整.*agent|助手.*设置/i,
    action: 'update_agent',
    minConfidence: 0.75,
    extractParams: (text) => ({
      agentId: extractAgentId(text),
      updates: extractAgentUpdates(text),
    }),
  },

  // 修改工作流
  {
    pattern: /修改|更新|编辑|调整.*工作流|加.*节点/i,
    action: 'update_workflow',
    minConfidence: 0.75,
    extractParams: (text) => ({
      workflowId: extractWorkflowId(text),
      nodeToAdd: extractNodeToAdd(text),
    }),
  },
];

// 辅助提取函数

function extractAgentName(text: string): string {
  // 从动词后面取名称，避免把「帮我创建」吃进名字
  const match = text.match(/(?:创建|新建|添加|建)\s*(?:一个)?\s*(?:名叫|名为|叫)?\s*(.+?)(?:的)?(?:agent|助手|智能体)/i);
  if (match && match[1].trim()) {
    const name = match[1].trim().replace(/^(?:一个|名叫|名为|叫)/, '').trim();
    if (name && !['帮我', '请', '可以', '能够', '会', '能'].includes(name)) return name;
  }
  // 尝试匹配角色描述
  const roleMatch = text.match(/写文案|翻译|数据分析|客服|编程|运维|设计|营销|写作/i);
  if (roleMatch) {
    const roleMap: Record<string, string> = {
      '写文案': '文案写手',
      '文案': '文案写手',
      '翻译': '翻译助手',
      '数据分析': '数据分析助手',
      '数据': '数据分析助手',
      '客服': '智能客服',
      '编程': '编程助手',
      '运维': '运维助手',
      '设计': '设计助手',
      '营销': '营销助手',
      '写作': '写作助手',
    };
    return roleMap[roleMatch[0]] || roleMatch[0] + '助手';
  }
  return '';
}

function extractModel(text: string): string {
  for (const [keyword, model] of Object.entries(modelKeywords)) {
    if (text.toLowerCase().includes(keyword.toLowerCase())) {
      return model;
    }
  }
  return '';
}

function extractTools(text: string): string[] {
  const tools: string[] = [];
  for (const [keyword, tool] of Object.entries(toolKeywords)) {
    if (text.includes(keyword) && !tools.includes(tool)) {
      tools.push(tool);
    }
  }
  return tools;
}

function extractDescription(text: string): string {
  // 提取"用来xxx"或"帮助xxx"的描述
  const match = text.match(/(?:用来|用于|帮助|可以|能够)(.+?)(?:的|$)/i);
  if (match) return match[1].trim();
  return '';
}

function extractWorkflowName(text: string): string {
  const match = text.match(/(?:创建|新建|设计|编排|建)\s*(?:一个)?\s*(?:名叫|名为|叫)?\s*(.+?)(?:的)?(?:工作流|流程|pipeline)/i);
  if (match && match[1].trim()) {
    return match[1].trim().replace(/^(?:一个|名叫|名为|叫)/, '').trim();
  }

  // 从功能描述推断名称
  const descMatch = text.match(/内容审核|数据分析|翻译|客服|营销|运维|监控/i);
  if (descMatch) {
    const nameMap: Record<string, string> = {
      '内容审核': '内容审核流程',
      '数据分析': '数据处理流程',
      '翻译': '翻译处理流程',
      '客服': '客服响应流程',
      '营销': '营销自动化流程',
      '运维': '运维自动化流程',
      '监控': '监控告警流程',
    };
    return nameMap[descMatch[0]] || descMatch[0] + '流程';
  }
  return '';
}

function extractNodeSequence(text: string): { type: string; label: string }[] {
  const nodes: { type: string; label: string }[] = [];
  // 添加默认开始节点
  nodes.push({ type: 'start', label: '开始' });

  for (const [keyword, nodeInfo] of Object.entries(nodeKeywords)) {
    if (text.includes(keyword) && nodeInfo.type !== 'start' && nodeInfo.type !== 'end') {
      // 防止重复
      if (!nodes.find(n => n.type === nodeInfo.type)) {
        nodes.push(nodeInfo);
      }
    }
  }

  // 如果提到了"→"或"然后"这样的流程连接词
  const arrowPattern = text.match(/(.+?)→(.+?)(?:→|$)/g);
  if (arrowPattern) {
    // 优先使用箭头分隔的流程描述
    const explicitNodes: { type: string; label: string }[] = [];
    for (const segment of arrowPattern) {
      const parts = segment.split('→').map(s => s.trim());
      for (const part of parts) {
        for (const [kw, info] of Object.entries(nodeKeywords)) {
          if (part.includes(kw)) {
            if (!explicitNodes.find(n => n.type === info.type)) {
              explicitNodes.push(info);
            }
          }
        }
      }
    }
    if (explicitNodes.length > 0) {
      nodes.length = 0;
      nodes.push({ type: 'start', label: '开始' });
      nodes.push(...explicitNodes);
    }
  }

  // 添加默认结束节点
  if (!nodes.find(n => n.type === 'end')) {
    nodes.push({ type: 'end', label: '结束' });
  }

  return nodes;
}

function extractSSHCommand(text: string): string {
  const match = text.match(/(?:执行|运行|跑)(?:命令)?[:\s]*(.+?)(?:$|在|上)/i);
  if (match) return match[1].trim();
  const cmdMatch = text.match(/(?:ls|cat|grep|find|python|node|npm|pip|docker|kubectl|curl|wget)\s+.+/i);
  if (cmdMatch) return cmdMatch[0];
  return '';
}

function extractHostId(_text: string): string {
  // MVP阶段返回第一个可用主机ID，后续通过LLM精确匹配
  return '';
}

function extractWorkflowId(_text: string): string {
  return '';
}

function extractRunnableWorkflowName(text: string): string {
  const match = text.match(/(?:运行|执行|启动|跑)\s*(?:一下)?\s*(.+)$/i);
  if (!match) return '';
  let name = match[1].trim().replace(/^(?:一个|这个|那个)/, '').trim();
  name = name.replace(/(?:工作流|流程)$/g, '').trim();
  if (!name || ['工作流', '流程', '一下', '它'].includes(name)) return '';
  return name;
}

function extractAgentId(_text: string): string {
  return '';
}

function extractAgentUpdates(text: string): Record<string, any> {
  const updates: Record<string, any> = {};
  const model = extractModel(text);
  if (model) updates.model = model;
  const tools = extractTools(text);
  if (tools.length) updates.tools = tools;
  return updates;
}

function extractNodeToAdd(text: string): { type: string; label: string } | null {
  for (const [keyword, nodeInfo] of Object.entries(nodeKeywords)) {
    if (text.includes(keyword) && keyword !== '开始' && keyword !== '结束') {
      return nodeInfo;
    }
  }
  return null;
}

function generateSystemPrompt(name: string, desc: string, tools: string[]): string {
  const role = name || desc || 'AI助手';
  const toolDesc = tools.length > 0
    ? `\n\n你可以使用以下工具: ${tools.join(', ')}。请根据用户需求合理调用这些工具。`
    : '';

  return `你是一个${role}。请专业、准确地回答用户的问题，提供有用的建议和解决方案。${toolDesc}`;
}

function pickAvatar(hint: string): string {
  const avatarMap: Record<string, string> = {
    '文案': '✍️',
    '写作': '✍️',
    '翻译': '🌐',
    '数据': '📊',
    '编程': '💻',
    '运维': '🔧',
    '设计': '🎨',
    '客服': '💬',
    '营销': '🚀',
    '监控': '🔍',
  };
  for (const [keyword, avatar] of Object.entries(avatarMap)) {
    if (hint.includes(keyword)) return avatar;
  }
  return '🤖';
}

/**
 * 主入口：解析用户输入的意图
 * @param text 用户输入的自然语言
 * @returns 解析结果，包含 action、params、confidence
 */
export function parseIntent(text: string): ParsedIntent {
  if (!text.trim()) {
    return {
      action: 'unknown',
      params: {},
      confidence: 0,
      originalText: text,
    };
  }

  // 按匹配优先级尝试每个模式
  let bestMatch: ParsedIntent | null = null;
  let bestScore = 0;

  for (const pattern of intentPatterns) {
    if (pattern.pattern.test(text)) {
      const matchScore = calculateMatchScore(text, pattern);
      if (matchScore > bestScore && matchScore >= pattern.minConfidence) {
        bestScore = matchScore;
        bestMatch = {
          action: pattern.action,
          params: pattern.extractParams(text),
          confidence: matchScore,
          originalText: text,
        };
      }
    }
  }

  if (bestMatch && bestMatch.confidence >= 0.7) {
    return bestMatch;
  }

  // 如果低置信度，返回追问提示
  if (bestMatch && bestMatch.confidence >= 0.5) {
    return {
      ...bestMatch,
      confidence: bestMatch.confidence,
      clarification: generateClarification(bestMatch.action, bestMatch.params),
    };
  }

  // 无法识别，归为通用对话
  return {
    action: 'general_chat',
    params: { text },
    confidence: 0.3,
    originalText: text,
    clarification: '我无法确定您想做什么，请更详细地描述您的需求。例如：\n• "帮我创建一个文案写手Agent"\n• "设计一个内容审核工作流"',
  };
}

function calculateMatchScore(text: string, pattern: IntentPattern): number {
  let score = pattern.minConfidence;

  // 额外关键词加分
  const bonusKeywords: Record<IntentAction, string[]> = {
    create_agent: ['agent', '助手', '智能体', '模型', '工具'],
    create_workflow: ['工作流', '流程', '节点', '编排'],
    run_workflow: ['运行', '执行', '启动'],
    ssh_command: ['ssh', '远程', '命令', '运维'],
    list_agents: ['列表', '查看', '有哪些'],
    list_workflows: ['列表', '查看', '有哪些'],
    query_status: ['状态', '进度', '结果'],
    update_agent: ['修改', '更新', '调整'],
    update_workflow: ['修改', '加', '调整'],
    delete_agent: ['删除', '移除'],
    delete_workflow: ['删除', '移除'],
    add_node: ['添加', '加'],
    connect_nodes: ['连接', '连线', '关联'],
    configure_node: ['配置', '设置'],
    general_chat: [],
    unknown: [],
  };

  const bonuses = bonusKeywords[pattern.action] || [];
  for (const kw of bonuses) {
    if (text.includes(kw)) score += 0.05;
  }

  return Math.min(score, 0.95);
}

function generateClarification(action: IntentAction, _params: Record<string, any>): string {
  switch (action) {
    case 'create_agent':
      return `您想创建一个Agent吗？请补充以下信息：\n• Agent名称（如"文案写手"）\n• 使用什么模型？（如GPT-4o、Claude等）\n• 需要哪些工具？`;
    case 'create_workflow':
      return `您想创建一个工作流吗？请描述流程步骤，例如："接收文本 → AI判断 → 人工复审"`;
    case 'run_workflow':
      return `您想运行工作流吗？请指定要运行哪个工作流。`;
    default:
      return `请更详细地描述您想做什么。`;
  }
}
