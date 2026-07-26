/**
 * 任务→自动生成子 Agent 列表的编排层
 * 根据任务描述，让 LLM 自动推荐一组适合的子 Agent
 */

export interface DesignSubAgentsOptions {
  taskDescription: string;
  modelPool?: Array<{ modelName: string; displayName: string; provider: string }>;
  maxAgents?: number;
  llmExecutor?: (params: {
    model: string;
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
  }) => Promise<string>;
}

export interface DesignedSubAgent {
  id: string;
  name: string;
  description: string;
  model: string;  // 'auto' 或具体模型名
  systemPrompt: string;
  specialties: string[];
  capabilities: string[];
  keywords: string[];
  temperature: number;
  maxIterations: number;
}

export async function designSubAgents(options: DesignSubAgentsOptions): Promise<DesignedSubAgent[]> {
  const { taskDescription, modelPool = [], maxAgents = 5, llmExecutor } = options;

  if (!llmExecutor) {
    // 无 LLM executor 时返回默认配置
    return generateDefaultAgents(taskDescription, maxAgents);
  }

  const modelList = modelPool.length > 0
    ? modelPool.map(m => `- ${m.modelName} (${m.displayName}): ${m.provider}`).join('\n')
    : '- gpt-4o (默认)';

  const systemPrompt = `你是一个 Agent 架构师。根据用户任务，设计一组协作的子 Agent。
要求：
1. 最多 ${maxAgents} 个子 Agent
2. 每个 Agent 有明确的职责分工
3. model 字段设为 "auto"（除非有特殊需求指定具体模型）
4. 返回 JSON 数组格式

输出格式（严格 JSON，不要 markdown 代码块）：
[
  {
    "id": "agent-1",
    "name": "Agent名称",
    "description": "职责描述",
    "model": "auto",
    "systemPrompt": "系统提示词",
    "specialties": ["专长1", "专长2"],
    "capabilities": ["能力1"],
    "keywords": ["关键词1"],
    "temperature": 0.7,
    "maxIterations": 10
  }
]`;

  const userPrompt = `任务描述：${taskDescription}

可用模型：
${modelList}

请设计子 Agent 团队：`;

  try {
    const response = await llmExecutor({
      model: 'gpt-4o',
      systemPrompt,
      userPrompt,
      temperature: 0.3,
    });

    // 解析 JSON 响应
    const jsonStr = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const agents = JSON.parse(jsonStr);

    if (Array.isArray(agents)) {
      return agents.slice(0, maxAgents).map((a: any, idx: number) => ({
        id: a.id || `agent-${idx + 1}`,
        name: a.name || `Agent ${idx + 1}`,
        description: a.description || '',
        model: a.model || 'auto',
        systemPrompt: a.systemPrompt || '你是一个有帮助的 AI 助手。',
        specialties: Array.isArray(a.specialties) ? a.specialties : [],
        capabilities: Array.isArray(a.capabilities) ? a.capabilities : [],
        keywords: Array.isArray(a.keywords) ? a.keywords : [],
        temperature: a.temperature ?? 0.7,
        maxIterations: a.maxIterations ?? 10,
      }));
    }
  } catch {
    // 解析失败，返回默认
  }

  return generateDefaultAgents(taskDescription, maxAgents);
}

function generateDefaultAgents(task: string, maxAgents: number): DesignedSubAgent[] {
  // 根据任务特征生成默认 Agent 配置
  const hasCode = /code|代码|编程|function|bug|debug/i.test(task);
  const hasWriting = /写|文章|文案|content|write|creative/i.test(task);
  const hasResearch = /研究|分析|调研|research|analyze/i.test(task);

  const agents: DesignedSubAgent[] = [];

  if (hasResearch || agents.length === 0) {
    agents.push({
      id: 'researcher',
      name: '研究员',
      description: '负责信息收集和深度分析',
      model: 'auto',
      systemPrompt: '你是一个研究分析师，负责深入调研问题并给出结构化发现。',
      specialties: ['研究', '分析', '调研'],
      capabilities: ['信息收集', '深度分析'],
      keywords: ['研究', '分析', '调研', 'research'],
      temperature: 0.7,
      maxIterations: 10,
    });
  }

  if (hasCode) {
    agents.push({
      id: 'coder',
      name: '程序员',
      description: '负责代码编写和调试',
      model: 'auto',
      systemPrompt: '你是一个资深程序员，负责编写高质量代码并解决技术问题。',
      specialties: ['编程', '代码', '调试'],
      capabilities: ['代码编写', 'bug修复', '架构设计'],
      keywords: ['代码', 'code', '编程', 'bug', 'debug'],
      temperature: 0.3,
      maxIterations: 15,
    });
  }

  if (hasWriting) {
    agents.push({
      id: 'writer',
      name: '写作者',
      description: '负责内容创作和文案撰写',
      model: 'auto',
      systemPrompt: '你是一个内容写作者，擅长将分析转化为流畅可读的成稿。',
      specialties: ['写作', '文案', '创意'],
      capabilities: ['内容创作', '文案撰写'],
      keywords: ['写', '文章', '文案', 'write', 'content'],
      temperature: 0.8,
      maxIterations: 10,
    });
  }

  // 至少返回一个 Agent
  if (agents.length === 0) {
    agents.push({
      id: 'general',
      name: '通用助手',
      description: '处理通用任务',
      model: 'auto',
      systemPrompt: '你是一个有帮助的 AI 助手。',
      specialties: ['通用'],
      capabilities: ['通用任务处理'],
      keywords: [],
      temperature: 0.7,
      maxIterations: 10,
    });
  }

  return agents.slice(0, maxAgents);
}
