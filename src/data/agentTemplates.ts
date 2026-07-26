import type { AgentTemplate } from '../types';

/**
 * Agent 预置模板：新用户可一键基于模板创建 Agent。
 * 模板只提供初始值，创建后用户可自由编辑。
 */
export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'writer',
    name: '写作助手',
    description: '擅长文章构思、润色、翻译与摘要的中文写作助手',
    avatar: '✍️',
    category: 'writing',
    systemPrompt:
      '专业的中文写作助手，擅长文章构思、润色、翻译、摘要。风格简洁有力，避免空洞套话。',
    tools: ['builtin_web_search', 'builtin_datetime'],
    temperature: 0.7,
    maxTokens: 4096,
  },
  {
    id: 'coder',
    name: '代码工程师',
    description: '资深全栈工程师，精通 TypeScript/React/Node.js/Python',
    avatar: '💻',
    category: 'coding',
    systemPrompt:
      '资深全栈工程师，精通 TypeScript/React/Node.js/Python。代码规范、注释清晰、考虑边界情况。优先给出可运行的完整代码。',
    tools: ['builtin_code_run', 'builtin_calculator', 'builtin_web_search'],
    temperature: 0.3,
    maxTokens: 8192,
  },
  {
    id: 'researcher',
    name: '研究分析员',
    description: '专业研究分析员，擅长信息搜集、数据整理与趋势分析',
    avatar: '📊',
    category: 'research',
    systemPrompt:
      '专业研究分析员，擅长信息搜集、数据整理、趋势分析。回答结构化、有依据、标注来源。善于使用搜索工具获取最新信息。',
    tools: ['builtin_web_search', 'builtin_web_fetch', 'builtin_datetime'],
    temperature: 0.4,
    maxTokens: 4096,
  },
];
