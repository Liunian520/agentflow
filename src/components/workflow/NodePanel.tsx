import { useState, useMemo } from 'react';
import {
  Search,
  Play,
  StopCircle,
  Brain,
  Bot,
  Code,
  FileText,
  Variable,
  Globe,
  Database,
  BookOpen,
  GitBranch,
  Repeat,
  Layers,
  UserCheck,
  Server,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Sparkles,
  Target,
  Workflow,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../lib/utils';
import type { NodeType, NodeData } from '../../types';

interface NodePanelProps {
  onDragStart: (event: React.DragEvent, nodeType: any) => void;
}

const metaSkillModules = [
  {
    id: 'decomposition',
    name: '任务分解',
    icon: Target,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    description: 'Task Decomposition',
    hint: '定义任务输入和分解策略',
  },
  {
    id: 'engineering',
    name: 'Agent 工程',
    icon: Brain,
    color: 'text-violet-600',
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-200',
    description: 'Agent Engineering',
    hint: '配置 Agent 角色和能力',
  },
  {
    id: 'orchestration',
    name: '工作流编排',
    icon: Workflow,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    description: 'Workflow Orchestration',
    hint: '连接节点和控制流程',
  },
];

interface NodeTemplate {
  id: string;
  type: NodeType;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  category: string;
  defaultData: Partial<NodeData>;
}

const categories = [
  {
    id: '基础控制',
    icon: Play,
    color: 'text-emerald-600',
    metaSkill: 'decomposition',
  },
  {
    id: 'AI 能力',
    icon: Brain,
    color: 'text-blue-600',
    metaSkill: 'engineering',
  },
  {
    id: '数据处理',
    icon: Code,
    color: 'text-amber-600',
    metaSkill: 'orchestration',
  },
  {
    id: '外部调用',
    icon: Globe,
    color: 'text-orange-600',
    metaSkill: 'engineering',
  },
  {
    id: '流程控制',
    icon: GitBranch,
    color: 'text-purple-600',
    metaSkill: 'orchestration',
  },
  {
    id: '交互与部署',
    icon: UserCheck,
    color: 'text-pink-600',
    metaSkill: 'orchestration',
  },
];

const nodeTemplates: NodeTemplate[] = [
  {
    id: 'start',
    type: 'start',
    name: '开始节点',
    description: '工作流入口，定义输入参数',
    icon: Play,
    color: '#10b981',
    category: '基础控制',
    defaultData: {
      label: '开始',
      description: '工作流入口，定义输入参数',
      iconName: 'Play',
      type: 'start',
      startConfig: {
        inputs: [
          {
            id: 'input-1',
            name: 'input',
            type: 'string',
            required: false,
            description: '工作流输入参数',
          },
        ],
      },
    },
  },
  {
    id: 'end',
    type: 'end',
    name: '结束节点',
    description: '工作流出口，返回执行结果',
    icon: StopCircle,
    color: '#ef4444',
    category: '基础控制',
    defaultData: {
      label: '结束',
      description: '工作流出口，返回执行结果',
      iconName: 'StopCircle',
      type: 'end',
      endConfig: {
        outputs: [
          {
            id: 'output-1',
            name: 'result',
            type: 'string',
            value: '{{input}}',
          },
        ],
      },
    },
  },
  {
    id: 'llm',
    type: 'llm',
    name: '大模型节点',
    description: '调用大模型完成推理、生成、分类',
    icon: Brain,
    color: '#3b82f6',
    category: 'AI 能力',
    defaultData: {
      label: '大模型',
      description: '调用大模型完成推理、生成、分类',
      iconName: 'Brain',
      type: 'llm',
      llmConfig: {
        channelId: '',
        model: 'gpt-4o',
        temperature: 0.7,
        maxTokens: 2048,
        systemPrompt: '你是一个 helpful AI assistant.',
        userPrompt: '{{input}}',
        outputVariable: 'llmResult',
      },
    },
  },
  {
    id: 'agent',
    type: 'agent',
    name: 'Agent 节点',
    description: '配置独立的 AI 代理，带工具调用能力',
    icon: Bot,
    color: '#8b5cf6',
    category: 'AI 能力',
    defaultData: {
      label: 'Agent',
      description: '配置独立的 AI 代理，带工具调用能力',
      iconName: 'Bot',
      type: 'agent',
      agentConfig: {
        model: 'gpt-4o',
        systemPrompt: '你是一个专业的 AI 助手，善于使用工具解决问题。',
        temperature: 0.7,
        maxTokens: 4096,
        tools: [],
      },
    },
  },
  {
    id: 'code',
    type: 'code',
    name: '代码节点',
    description: '运行 JS/Python/Bash 代码处理数据',
    icon: Code,
    color: '#eab308',
    category: '数据处理',
    defaultData: {
      label: '代码',
      description: '运行 JS/Python/Bash 代码处理数据',
      iconName: 'Code',
      type: 'code',
      codeConfig: {
        language: 'javascript',
        code: `// 输入变量通过 args 访问\nconst { input } = args;\n\n// 处理数据\nconst result = input.toUpperCase();\n\n// 返回结果\nreturn { result };`,
        inputVariables: ['input'],
        outputVariable: 'codeResult',
        timeout: 30000,
      },
    },
  },
  {
    id: 'template',
    type: 'template',
    name: '模板节点',
    description: '基于模板变量生成文本/JSON',
    icon: FileText,
    color: '#06b6d4',
    category: '数据处理',
    defaultData: {
      label: '模板',
      description: '基于模板变量生成文本/JSON',
      iconName: 'FileText',
      type: 'template',
      templateConfig: {
        template: '你好，{{name}}！欢迎使用 AgentFlow。',
        templateType: 'string',
        outputVariable: 'templateResult',
      },
    },
  },
  {
    id: 'variable',
    type: 'variable',
    name: '变量节点',
    description: '设置、修改、追加工作流变量',
    icon: Variable,
    color: '#ec4899',
    category: '数据处理',
    defaultData: {
      label: '变量',
      description: '设置、修改、追加工作流变量',
      iconName: 'Variable',
      type: 'variable',
      variableConfig: {
        operation: 'set',
        variableName: 'myVar',
        value: 'hello',
        valueType: 'string',
      },
    },
  },
  {
    id: 'http',
    type: 'http',
    name: 'HTTP 请求',
    description: '发送 HTTP 请求调用外部 API',
    icon: Globe,
    color: '#f97316',
    category: '外部调用',
    defaultData: {
      label: 'HTTP 请求',
      description: '发送 HTTP 请求调用外部 API',
      iconName: 'Globe',
      type: 'http',
      httpConfig: {
        method: 'GET',
        url: 'https://api.example.com/data',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '',
        bodyType: 'none',
        outputVariable: 'httpResult',
        timeout: 30000,
      },
    },
  },
  {
    id: 'database',
    type: 'database',
    name: '数据库节点',
    description: '执行 SQL 查询/写入数据库',
    icon: Database,
    color: '#1e40af',
    category: '外部调用',
    defaultData: {
      label: '数据库',
      description: '执行 SQL 查询/写入数据库',
      iconName: 'Database',
      type: 'database',
      databaseConfig: {
        connectionId: '',
        queryType: 'select',
        sql: 'SELECT * FROM users LIMIT 10;',
        outputVariable: 'dbResult',
      },
    },
  },
  {
    id: 'knowledge',
    type: 'knowledge',
    name: '知识库节点',
    description: '检索知识库内容',
    icon: BookOpen,
    color: '#059669',
    category: '外部调用',
    defaultData: {
      label: '知识库',
      description: '检索知识库内容',
      iconName: 'BookOpen',
      type: 'knowledge',
      knowledgeConfig: {
        knowledgeBaseId: '',
        query: '{{input}}',
        topK: 5,
        outputVariable: 'knowledgeResult',
      },
    },
  },
  {
    id: 'condition',
    type: 'condition',
    name: '条件分支',
    description: 'IF/ELSE 多分支条件判断',
    icon: GitBranch,
    color: '#7c3aed',
    category: '流程控制',
    defaultData: {
      label: '条件分支',
      description: 'IF/ELSE 多分支条件判断',
      iconName: 'GitBranch',
      type: 'condition',
      conditionConfig: {
        conditions: [
          {
            id: 'cond-1',
            label: '条件 1',
            expression: '{{input}} === "yes"',
          },
        ],
        defaultLabel: '默认分支',
      },
    },
  },
  {
    id: 'loop',
    type: 'loop',
    name: '循环节点',
    description: '批量循环处理数组或指定次数',
    icon: Repeat,
    color: '#ea580c',
    category: '流程控制',
    defaultData: {
      label: '循环',
      description: '批量循环处理数组或指定次数',
      iconName: 'Repeat',
      type: 'loop',
      loopConfig: {
        loopType: 'array',
        arrayVariable: 'items',
        count: 5,
        itemVariable: 'item',
        indexVariable: 'index',
      },
    },
  },
  {
    id: 'subworkflow',
    type: 'subworkflow',
    name: '子工作流',
    description: '调用其他工作流作为子流程',
    icon: Layers,
    color: '#4338ca',
    category: '流程控制',
    defaultData: {
      label: '子工作流',
      description: '调用其他工作流作为子流程',
      iconName: 'Layers',
      type: 'subworkflow',
      subworkflowConfig: {
        workflowId: '',
        inputMapping: {},
        outputVariable: 'subworkflowResult',
      },
    },
  },
  {
    id: 'human-in-loop',
    type: 'human-in-loop',
    name: '人工审核',
    description: '暂停等待人工确认后继续',
    icon: UserCheck,
    color: '#db2777',
    category: '交互与部署',
    defaultData: {
      label: '人工审核',
      description: '暂停等待人工确认后继续',
      iconName: 'UserCheck',
      type: 'human-in-loop',
      humanConfig: {
        title: '需要人工审核',
        description: '请确认以下内容是否正确',
        assignee: '',
        timeout: 86400,
        inputFields: [
          {
            id: 'field-1',
            label: '审核意见',
            type: 'textarea',
            required: true,
          },
          {
            id: 'field-2',
            label: '是否通过',
            type: 'boolean',
            required: true,
          },
        ],
      },
    },
  },
  {
    id: 'host',
    type: 'host',
    name: '远程主机',
    description: 'SSH 远程执行命令、上传下载文件',
    icon: Server,
    color: '#6b7280',
    category: '交互与部署',
    defaultData: {
      label: '远程主机',
      description: 'SSH 远程执行命令、上传下载文件',
      iconName: 'Server',
      type: 'host',
      hostConfig: {
        hostId: '',
        operation: 'command',
        command: 'echo "Hello from remote"',
        workDir: '/tmp',
        localPath: '',
        remotePath: '',
        outputVariable: 'hostResult',
        timeout: 60000,
      },
    },
  },
];

export function NodePanel({ onDragStart }: NodePanelProps) {
  const addNodeFromTemplate = useStore((s) => s.addNodeFromTemplate);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<string[]>(
    categories.map((c) => c.id)
  );
  const [showMetaSkill, setShowMetaSkill] = useState(true);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) =>
      prev.includes(categoryId)
        ? prev.filter((c) => c !== categoryId)
        : [...prev, categoryId]
    );
  };

  const filteredNodes = useMemo(() => {
    const query = searchQuery.toLowerCase();
    if (!query) return nodeTemplates;
    return nodeTemplates.filter(
      (node) =>
        node.name.toLowerCase().includes(query) ||
        node.description.toLowerCase().includes(query) ||
        node.category.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const handleDragStart = (event: React.DragEvent, node: NodeTemplate) => {
    const nodeData = {
      id: node.id,
      type: node.type,
      name: node.name,
      description: node.description,
      icon: node.defaultData.iconName || 'Play',
      color: node.color,
      category: node.category,
      defaultData: node.defaultData,
    };
    event.dataTransfer.setData('application/reactflow', JSON.stringify(nodeData));
    event.dataTransfer.effectAllowed = 'move';
    if (onDragStart) {
      onDragStart(event, nodeData);
    }
  };

  const handleNodeClick = (node: NodeTemplate) => {
    if (addNodeFromTemplate) {
      addNodeFromTemplate({
        id: node.id,
        type: node.type,
        name: node.name,
        description: node.description,
        icon: node.defaultData.iconName || 'Play',
        color: node.color,
        category: node.category,
        defaultData: node.defaultData,
      });
    }
  };

  return (
    <div className="w-64 bg-white border-r border-border flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-text-primary">节点库</div>
          <button
            onClick={() => setShowMetaSkill(!showMetaSkill)}
            className={cn(
              'p-1 rounded-md transition-colors',
              showMetaSkill ? 'text-accent bg-accent/10' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'
            )}
            title="Meta-Skill 架构视图"
          >
            <Sparkles className="w-4 h-4" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
          <input
            type="text"
            placeholder="搜索节点..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {showMetaSkill && (
        <div className="px-3 py-2 border-b border-border bg-gradient-to-r from-violet-50/50 to-blue-50/50">
          <div className="flex items-center gap-1.5 mb-2">
            <Layers className="w-3.5 h-3.5 text-violet-500" />
            <span className="text-xs font-medium text-text-secondary">Meta-Skill 编排架构</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {metaSkillModules.map((module) => {
              const ModuleIcon = module.icon;
              return (
                <div
                  key={module.id}
                  className={cn(
                    'p-2 rounded-lg border text-center cursor-pointer hover:shadow-sm transition-all',
                    module.bgColor,
                    module.borderColor
                  )}
                >
                  <ModuleIcon className={cn('w-4 h-4 mx-auto mb-1', module.color)} />
                  <div className={cn('text-[10px] font-medium', module.color)}>
                    {module.name}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-[10px] text-text-tertiary text-center leading-relaxed">
            基于 Skill-MAS 论文的三层编排方法论
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {categories.map((category) => {
          const categoryNodes = filteredNodes.filter((n) => n.category === category.id);
          if (categoryNodes.length === 0) return null;

          const Icon = category.icon;
          const isExpanded = expandedCategories.includes(category.id);
          const metaModule = metaSkillModules.find((m) => m.id === category.metaSkill);

          return (
            <div key={category.id} className="mb-1">
              <button
                onClick={() => toggleCategory(category.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 flex-shrink-0" />
                )}
                <Icon className={cn('w-4 h-4 flex-shrink-0', category.color)} />
                <span className="flex-1 text-left">{category.id}</span>
                {showMetaSkill && metaModule && (
                  <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full', metaModule.bgColor, metaModule.color)}>
                    {metaModule.name.slice(0, 2)}
                  </span>
                )}
                <span className="text-xs text-text-tertiary flex-shrink-0">
                  {categoryNodes.length}
                </span>
              </button>

              {isExpanded && (
                <div className="mt-1 space-y-1 pl-2">
                  {categoryNodes.map((node) => {
                    const NodeIcon = node.icon;
                    return (
                      <div
                        key={node.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, node)}
                        onClick={() => handleNodeClick(node)}
                        className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-bg-secondary cursor-grab active:cursor-grabbing group transition-colors"
                        title={`点击添加到画布中心，或拖拽到画布`}
                      >
                        <GripVertical className="w-3 h-3 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                        <div
                          className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${node.color}15` }}
                        >
                          <NodeIcon
                            className="w-4 h-4"
                            style={{ color: node.color }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-text-primary truncate">
                            {node.name}
                          </div>
                          <div className="text-xs text-text-tertiary truncate">
                            {node.description}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t border-border bg-bg-secondary/50">
        <div className="flex items-start gap-2">
          <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-text-primary mb-0.5">
              智能编排建议
            </div>
            <p className="text-[11px] text-text-tertiary leading-relaxed">
              拖拽节点到画布，或点击节点添加到画布中心
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
