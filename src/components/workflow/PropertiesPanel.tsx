import { useState } from 'react';
import { X, Trash2, Copy, Play, Plus, Settings, Bot, Trash, Loader2, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import * as Icons from 'lucide-react';
import type { Node } from 'reactflow';
import type { NodeType, SubAgentDef } from '../../types';
import { useStore } from '../../store/useStore';
import { discoverA2AAgent } from '../../api/llmApi';
import type { A2AAgentCard } from '../../api/llmApi';

interface PropertiesPanelProps {
  selectedNode: Node | null;
  workflowId: string | null;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

const iconMap: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  Webhook: Icons.Webhook,
  Clock: Icons.Clock,
  Play: Icons.Play,
  Bot: Icons.Bot,
  Search: Icons.Search,
  Code2: Icons.Code2,
  PenTool: Icons.PenTool,
  Globe: Icons.Globe,
  Database: Icons.Database,
  FileText: Icons.FileText,
  Mail: Icons.Mail,
  GitBranch: Icons.GitBranch,
  RefreshCw: Icons.RefreshCw,
  Settings: Icons.Settings,
  Send: Icons.Send,
  Bell: Icons.Bell,
  Box: Icons.Box,
  Server: Icons.Server,
  Brain: Icons.Brain,
  Code: Icons.Code,
  User: Icons.User,
  BookOpen: Icons.BookOpen,
  Layers: Icons.Layers,
  Share2: Icons.Share2,
  Network: Icons.Network,
};

const typeColors: Record<string, string> = {
  start: 'bg-emerald-500',
  end: 'bg-red-500',
  llm: 'bg-blue-500',
  agent: 'bg-violet-500',
  code: 'bg-amber-500',
  template: 'bg-teal-500',
  variable: 'bg-cyan-500',
  http: 'bg-orange-500',
  database: 'bg-blue-800',
  knowledge: 'bg-lime-500',
  condition: 'bg-violet-500',
  loop: 'bg-pink-500',
  subworkflow: 'bg-indigo-500',
  subagent: 'bg-violet-600',
  a2a: 'bg-cyan-600',
  'human-in-loop': 'bg-rose-500',
  host: 'bg-gray-600',
};

const modelOptions = [
  'GPT-4o',
  'GPT-4 Turbo',
  'GPT-3.5 Turbo',
  'Claude 3.5 Sonnet',
  'Claude 3 Opus',
  'Gemini 1.5 Pro',
  'DeepSeek V3',
];

const codeLanguageOptions = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'bash', label: 'Bash' },
];

const httpMethodOptions = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

const bodyTypeOptions = [
  { value: 'json', label: 'JSON' },
  { value: 'form', label: 'Form Data' },
  { value: 'raw', label: 'Raw' },
  { value: 'none', label: 'None' },
];

const queryTypeOptions = [
  { value: 'select', label: 'SELECT' },
  { value: 'insert', label: 'INSERT' },
  { value: 'update', label: 'UPDATE' },
  { value: 'delete', label: 'DELETE' },
];

const loopTypeOptions = [
  { value: 'count', label: '次数循环' },
  { value: 'array', label: '数组循环' },
];

const operationOptions = [
  { value: 'set', label: '设置' },
  { value: 'append', label: '追加' },
  { value: 'increment', label: '增加' },
  { value: 'decrement', label: '减少' },
];

const variableTypeOptions = [
  { value: 'string', label: '字符串' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔' },
  { value: 'object', label: '对象' },
  { value: 'array', label: '数组' },
];

export function PropertiesPanel({
  selectedNode,
  workflowId,
  onClose,
  onDelete,
  onDuplicate,
}: PropertiesPanelProps) {
  const [activeTab, setActiveTab] = useState<'basic' | 'config'>('basic');

  // A2A Agent Card 发现状态
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoveredCard, setDiscoveredCard] = useState<A2AAgentCard | null>(null);

  const handleDiscoverAgent = async () => {
    const config = selectedNode?.data?.a2aConfig;
    if (!config?.agentUrl) return;
    setDiscovering(true);
    setDiscoverError(null);
    const result = await discoverA2AAgent(config.agentUrl, config.authHeaders);
    setDiscovering(false);
    if (result.success && result.agentCard) {
      setDiscoveredCard(result.agentCard);
      // 将发现的 card 存入节点配置
      if (selectedNode && workflowId) {
        updateWorkflowNode(workflowId, selectedNode.id, {
          ...selectedNode.data,
          a2aConfig: { ...config, discoveredCard: result.agentCard },
        });
      }
    } else {
      setDiscoverError(result.message || '发现失败');
    }
  };

  const { updateWorkflowNode, workflows, hosts, channels, mcps } = useStore();

  const workflow = workflows.find((w) => w.id === workflowId);

  const getAvailableModels = () => {
    const modelList: string[] = [];
    channels.forEach((channel) => {
      channel.models.forEach((model) => {
        modelList.push(`${channel.name} - ${model.name}`);
      });
    });
    return modelList.length > 0 ? modelList : modelOptions;
  };

  if (!selectedNode) {
    return (
      <div className="w-72 bg-white border-l border-border flex flex-col h-full">
        <div className="p-4 border-b border-border">
          <div className="text-sm font-semibold text-text-primary">属性</div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-bg-secondary flex items-center justify-center mb-3">
            <Settings className="w-6 h-6 text-text-tertiary" />
          </div>
          <p className="text-sm text-text-secondary mb-1">选择一个节点</p>
          <p className="text-xs text-text-tertiary">查看和编辑节点属性</p>
        </div>
      </div>
    );
  }

  const nodeType = selectedNode.data.type as NodeType;
  const IconComponent = iconMap[selectedNode.data.iconName] || Icons.Box;
  const typeColor = typeColors[nodeType] || 'bg-gray-500';

  const handleLabelChange = (value: string) => {
    if (workflowId) {
      updateWorkflowNode(workflowId, selectedNode.id, { label: value });
      selectedNode.data.label = value;
    }
  };

  const handleDescriptionChange = (value: string) => {
    if (workflowId) {
      updateWorkflowNode(workflowId, selectedNode.id, { description: value });
      selectedNode.data.description = value;
    }
  };

  const handleConfigChange = (key: string, value: any) => {
    if (!workflowId) return;
    const configKey = `${nodeType}Config` as keyof typeof selectedNode.data;
    const currentConfig = selectedNode.data[configKey] || {};
    const updatedConfig = { ...currentConfig, [key]: value };
    updateWorkflowNode(workflowId, selectedNode.id, { [configKey]: updatedConfig });
    selectedNode.data[configKey] = updatedConfig;
  };

  const showConfigTab = ['llm', 'agent', 'code', 'http', 'host', 'condition', 'loop', 'variable', 'database', 'knowledge', 'template', 'subworkflow', 'subagent', 'a2a', 'human-in-loop', 'start', 'end'].includes(nodeType);

  const renderConfigContent = () => {
    switch (nodeType) {
      case 'start': {
        const config = selectedNode.data.startConfig;
        return (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">输入参数</label>
              <div className="space-y-2">
                {(config?.inputs || []).map((input: any, index: number) => (
                  <div key={input.id || index} className="p-3 bg-bg-secondary rounded-md">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-text-primary">{input.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${input.required ? 'bg-red-100 text-red-600' : 'bg-bg-hover text-text-tertiary'}`}>
                        {input.required ? '必填' : '可选'}
                      </span>
                    </div>
                    <div className="text-xs text-text-tertiary mb-2">{input.description || ''}</div>
                    <div className="flex gap-2">
                      <select
                        defaultValue={input.type}
                        className="flex-1 px-2 py-1 text-xs border border-border rounded bg-white"
                        onChange={(e) => {
                          const newInputs = [...(config?.inputs || [])];
                          newInputs[index] = { ...input, type: e.target.value };
                          handleConfigChange('inputs', newInputs);
                        }}
                      >
                        {variableTypeOptions.map((v) => (
                          <option key={v.value} value={v.value}>{v.label}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        defaultValue={input.default || ''}
                        placeholder="默认值"
                        className="flex-1 px-2 py-1 text-xs border border-border rounded"
                        onBlur={(e) => {
                          const newInputs = [...(config?.inputs || [])];
                          newInputs[index] = { ...input, default: e.target.value };
                          handleConfigChange('inputs', newInputs);
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  const newInputs = [...(config?.inputs || []), {
                    id: `inp-${Date.now()}`,
                    name: `input_${config?.inputs?.length + 1}`,
                    type: 'string',
                    required: false,
                    default: '',
                    description: '',
                  }];
                  handleConfigChange('inputs', newInputs);
                }}
                className="w-full mt-2 flex items-center justify-center gap-1 py-2 text-xs text-accent hover:bg-accent/10 rounded-md transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                添加输入参数
              </button>
            </div>
          </div>
        );
      }

      case 'end': {
        const config = selectedNode.data.endConfig;
        return (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">输出参数</label>
              <div className="space-y-2">
                {(config?.outputs || []).map((output: any, index: number) => (
                  <div key={output.id || index} className="p-3 bg-bg-secondary rounded-md">
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        defaultValue={output.name}
                        placeholder="输出名称"
                        className="flex-1 px-2 py-1 text-xs border border-border rounded"
                        onBlur={(e) => {
                          const newOutputs = [...(config?.outputs || [])];
                          newOutputs[index] = { ...output, name: e.target.value };
                          handleConfigChange('outputs', newOutputs);
                        }}
                      />
                      <select
                        defaultValue={output.type}
                        className="flex-1 px-2 py-1 text-xs border border-border rounded bg-white"
                        onChange={(e) => {
                          const newOutputs = [...(config?.outputs || [])];
                          newOutputs[index] = { ...output, type: e.target.value };
                          handleConfigChange('outputs', newOutputs);
                        }}
                      >
                        {variableTypeOptions.map((v) => (
                          <option key={v.value} value={v.value}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                    <input
                      type="text"
                      defaultValue={output.value}
                      placeholder="变量引用，如 {{result}}"
                      className="w-full px-2 py-1 text-xs border border-border rounded font-mono"
                      onBlur={(e) => {
                        const newOutputs = [...(config?.outputs || [])];
                        newOutputs[index] = { ...output, value: e.target.value };
                        handleConfigChange('outputs', newOutputs);
                      }}
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  const newOutputs = [...(config?.outputs || []), {
                    id: `out-${Date.now()}`,
                    name: `output_${config?.outputs?.length + 1}`,
                    type: 'string',
                    value: '',
                  }];
                  handleConfigChange('outputs', newOutputs);
                }}
                className="w-full mt-2 flex items-center justify-center gap-1 py-2 text-xs text-accent hover:bg-accent/10 rounded-md transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                添加输出参数
              </button>
            </div>
          </div>
        );
      }

      case 'llm': {
        const config = selectedNode.data.llmConfig;
        const llmMcpTools = mcps.flatMap((m) =>
          m.tools.map((t) => ({ server: m.name, name: t.name, desc: t.description })),
        );
        const llmMcpNameSet = new Set(llmMcpTools.map((t) => t.name));
        const toggleLlmTool = (toolName: string) => {
          const cur = config?.tools || [];
          handleConfigChange(
            'tools',
            cur.includes(toolName) ? cur.filter((t: string) => t !== toolName) : [...cur, toolName],
          );
        };
        return (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">模型</label>
              <select
                defaultValue={config?.model}
                onChange={(e) => handleConfigChange('model', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
              >
                {getAvailableModels().map((model) => (
                  <option key={model}>{model}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">温度</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  defaultValue={config?.temperature || 0.7}
                  onChange={(e) => handleConfigChange('temperature', parseFloat(e.target.value))}
                  className="flex-1 accent-accent"
                />
                <span className="text-sm text-text-secondary w-12 text-right">{config?.temperature || 0.7}</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">最大 Token 数</label>
              <input
                type="number"
                defaultValue={config?.maxTokens || 1024}
                onBlur={(e) => handleConfigChange('maxTokens', parseInt(e.target.value) || 1024)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">系统提示词</label>
              <textarea
                defaultValue={config?.systemPrompt}
                placeholder="输入系统提示词..."
                rows={4}
                onBlur={(e) => handleConfigChange('systemPrompt', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">用户提示词</label>
              <textarea
                defaultValue={config?.userPrompt}
                placeholder="输入用户提示词，支持变量引用如 {{input}}"
                rows={3}
                onBlur={(e) => handleConfigChange('userPrompt', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">输出变量名</label>
              <input
                type="text"
                defaultValue={config?.outputVariable || 'llm_output'}
                onBlur={(e) => handleConfigChange('outputVariable', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">工具能力（MCP）</label>
              {llmMcpTools.length === 0 ? (
                <div className="text-xs text-text-tertiary px-3 py-2 border border-dashed border-border rounded-md">
                  尚未配置 MCP 工具，请到「系统设置 → MCP 服务器」添加后在此勾选。
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {llmMcpTools.map((t) => {
                      const selected = (config?.tools || []).includes(t.name);
                      return (
                        <button
                          key={`${t.server}-${t.name}`}
                          title={t.desc}
                          onClick={() => toggleLlmTool(t.name)}
                          className={cn(
                            'px-2 py-1 text-xs rounded-full transition-colors',
                            selected
                              ? 'bg-accent text-white'
                              : 'bg-bg-secondary text-text-secondary hover:bg-accent/10',
                          )}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                  {(config?.tools || []).filter((t: string) => !llmMcpNameSet.has(t)).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <div className="text-[11px] text-text-tertiary mb-1">未匹配 MCP 的旧工具（点击移除）：</div>
                      <div className="flex flex-wrap gap-1.5">
                        {(config?.tools || [])
                          .filter((t: string) => !llmMcpNameSet.has(t))
                          .map((tool: string) => (
                            <button
                              key={tool}
                              onClick={() =>
                                handleConfigChange(
                                  'tools',
                                  (config?.tools || []).filter((x: string) => x !== tool),
                                )
                              }
                              className="px-2 py-0.5 text-[11px] rounded-full bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
                            >
                              {tool} ×
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      }

      case 'agent': {
        const config = selectedNode.data.agentConfig;
        const availableMcpTools = mcps.flatMap((m) =>
          m.tools.map((t) => ({ server: m.name, name: t.name, desc: t.description })),
        );
        const mcpToolNameSet = new Set(availableMcpTools.map((t) => t.name));
        const toggleMcpTool = (toolName: string) => {
          const cur = config?.tools || [];
          handleConfigChange(
            'tools',
            cur.includes(toolName) ? cur.filter((t: string) => t !== toolName) : [...cur, toolName],
          );
        };
        return (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">模型</label>
              <select
                defaultValue={config?.model}
                onChange={(e) => handleConfigChange('model', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
              >
                {getAvailableModels().map((model) => (
                  <option key={model}>{model}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">系统提示词</label>
              <textarea
                defaultValue={config?.systemPrompt}
                placeholder="输入系统提示词..."
                rows={5}
                onBlur={(e) => handleConfigChange('systemPrompt', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">温度</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  defaultValue={config?.temperature || 0.7}
                  onChange={(e) => handleConfigChange('temperature', parseFloat(e.target.value))}
                  className="flex-1 accent-accent"
                />
                <span className="text-sm text-text-secondary w-12 text-right">{config?.temperature || 0.7}</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">最大 Token 数</label>
              <input
                type="number"
                defaultValue={config?.maxTokens || 4096}
                onBlur={(e) => handleConfigChange('maxTokens', parseInt(e.target.value) || 4096)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">工具能力（MCP）</label>
              {availableMcpTools.length === 0 ? (
                <div className="text-xs text-text-tertiary px-3 py-2 border border-dashed border-border rounded-md">
                  尚未配置 MCP 工具，请到「系统设置 → MCP 服务器」添加后在此勾选。
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {availableMcpTools.map((t) => {
                      const selected = (config?.tools || []).includes(t.name);
                      return (
                        <button
                          key={`${t.server}-${t.name}`}
                          title={t.desc}
                          onClick={() => toggleMcpTool(t.name)}
                          className={cn(
                            'px-2 py-1 text-xs rounded-full transition-colors',
                            selected
                              ? 'bg-accent text-white'
                              : 'bg-bg-secondary text-text-secondary hover:bg-accent/10',
                          )}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                  {(config?.tools || []).filter((t: string) => !mcpToolNameSet.has(t)).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <div className="text-[11px] text-text-tertiary mb-1">未匹配 MCP 的旧工具（点击移除）：</div>
                      <div className="flex flex-wrap gap-1.5">
                        {(config?.tools || [])
                          .filter((t: string) => !mcpToolNameSet.has(t))
                          .map((tool: string) => (
                            <button
                              key={tool}
                              onClick={() =>
                                handleConfigChange(
                                  'tools',
                                  (config?.tools || []).filter((x: string) => x !== tool),
                                )
                              }
                              className="px-2 py-0.5 text-[11px] rounded-full bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
                            >
                              {tool} ×
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      }

      case 'subagent': {
        const config = selectedNode.data.subagentConfig;
        const availableTools = mcps.flatMap((m) =>
          m.tools.map((t) => ({ server: m.name, name: t.name, desc: t.description })),
        );

        const updateSubAgent = (idx: number, patch: Partial<SubAgentDef>) => {
          const agents = [...(config?.agents || [])];
          agents[idx] = { ...agents[idx], ...patch };
          handleConfigChange('agents', agents);
        };
        const removeSubAgent = (idx: number) => {
          handleConfigChange('agents', (config?.agents || []).filter((_a: any, i: number) => i !== idx));
        };
        const addSubAgent = () => {
          handleConfigChange('agents', [
            ...(config?.agents || []),
            {
              id: `sub-${Date.now()}`,
              name: '新子 Agent',
              model: 'gpt-4o',
              systemPrompt: '',
              temperature: 0.7,
              tools: [],
            },
          ]);
        };
        const toggleTool = (idx: number, toolName: string) => {
          const tools = config?.agents?.[idx]?.tools || [];
          const next = tools.includes(toolName)
            ? tools.filter((t: string) => t !== toolName)
            : [...tools, toolName];
          updateSubAgent(idx, { tools: next });
        };

        return (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-primary">并行执行</label>
              <input
                type="checkbox"
                checked={config?.parallel !== false}
                onChange={(e) => handleConfigChange('parallel', e.target.checked)}
                className="accent-accent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">输出变量</label>
              <input
                defaultValue={config?.outputVariable || 'subagent_result'}
                onBlur={(e) => handleConfigChange('outputVariable', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">
                聚合提示词（可选）
              </label>
              <textarea
                defaultValue={config?.aggregatorPrompt}
                placeholder="将各子 Agent 输出整合为最终交付物的总编辑提示"
                rows={3}
                onBlur={(e) => handleConfigChange('aggregatorPrompt', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-text-primary">
                  子 Agent（{config?.agents?.length || 0}）
                </label>
                <button
                  onClick={addSubAgent}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded-md transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加
                </button>
              </div>

              {(config?.agents || []).map((agent: any, idx: number) => (
                <div key={agent.id} className="border border-border rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      defaultValue={agent.name}
                      onBlur={(e) => updateSubAgent(idx, { name: e.target.value })}
                      className="flex-1 px-2 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:border-accent"
                    />
                    <button
                      onClick={() => removeSubAgent(idx)}
                      className="p-1.5 text-text-tertiary hover:text-red-500 transition-colors"
                    >
                      <Trash className="w-4 h-4" />
                    </button>
                  </div>

                  <select
                    defaultValue={agent.model}
                    onChange={(e) => updateSubAgent(idx, { model: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
                  >
                    {getAvailableModels().map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>

                  <textarea
                    defaultValue={agent.systemPrompt}
                    rows={3}
                    placeholder="系统提示词"
                    onBlur={(e) => updateSubAgent(idx, { systemPrompt: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none"
                  />

                  <input
                    defaultValue={agent.inputVariable || ''}
                    placeholder="输入变量（可选，留空则用全部上下文）"
                    onBlur={(e) =>
                      updateSubAgent(idx, { inputVariable: e.target.value || undefined })
                    }
                    className="w-full px-2 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:border-accent"
                  />

                  <div>
                    <label className="block text-xs text-text-tertiary mb-1">MCP 工具（来自已配置服务器）</label>
                    {availableTools.length === 0 ? (
                      <p className="text-xs text-text-tertiary">尚未配置 MCP 工具，请到「系统设置 → MCP 服务器」添加后在此勾选。</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {availableTools.map((t) => (
                          <button
                            key={`${t.server}-${t.name}`}
                            title={`${t.server} · ${t.desc}`}
                            onClick={() => toggleTool(idx, t.name)}
                            className={cn(
                              'px-2 py-1 text-xs rounded-full transition-colors',
                              (agent.tools || []).includes(t.name)
                                ? 'bg-accent text-white'
                                : 'bg-bg-secondary text-text-secondary hover:bg-accent/10',
                            )}
                          >
                            {t.server}:{t.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      }

      case 'a2a': {
        const config = selectedNode.data.a2aConfig || {
          agentUrl: '',
          message: '',
          streaming: true,
          outputVariable: 'a2a_result',
          timeout: 120000,
        };
        const card = discoveredCard || config.discoveredCard;
        return (
          <div className="p-4 space-y-4">
            {/* Agent URL */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">Agent URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={config.agentUrl || ''}
                  onChange={(e) => {
                    if (selectedNode && workflowId) {
                      updateWorkflowNode(workflowId, selectedNode.id, {
                        ...selectedNode.data,
                        a2aConfig: { ...config, agentUrl: e.target.value },
                      });
                    }
                  }}
                  placeholder="https://external-agent.example.com"
                  className="flex-1 px-3 py-2 text-sm border border-border rounded-md bg-bg-primary text-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
                <button
                  type="button"
                  onClick={handleDiscoverAgent}
                  disabled={discovering || !config.agentUrl}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-cyan-600 hover:bg-cyan-700 rounded-md transition-colors disabled:opacity-50"
                >
                  {discovering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  发现
                </button>
              </div>
              {discoverError && (
                <p className="mt-1.5 text-xs text-red-500">{discoverError}</p>
              )}
            </div>

            {/* Agent Card 信息 */}
            {card && (
              <div className="p-3 bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800 rounded-md space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-cyan-700 dark:text-cyan-300">{card.name}</span>
                  {card.version && <span className="text-xs text-text-tertiary">v{card.version}</span>}
                </div>
                {card.description && <p className="text-xs text-text-secondary">{card.description}</p>}
                {card.capabilities && (
                  <div className="flex gap-2 flex-wrap">
                    {card.capabilities.streaming && <span className="text-xs px-1.5 py-0.5 bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-300 rounded">流式</span>}
                    {card.capabilities.pushNotifications && <span className="text-xs px-1.5 py-0.5 bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-300 rounded">推送</span>}
                  </div>
                )}
                {card.skills && card.skills.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-text-tertiary">Skills ({card.skills.length})</span>
                    {card.skills.map((skill: { id: string; name: string; description: string; tags?: string[] }) => (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => {
                          if (selectedNode && workflowId) {
                            updateWorkflowNode(workflowId, selectedNode.id, {
                              ...selectedNode.data,
                              a2aConfig: { ...config, skillId: skill.id },
                            });
                          }
                        }}
                        className={cn(
                          'block w-full text-left p-2 rounded-md text-xs transition-colors',
                          config.skillId === skill.id
                            ? 'bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-300'
                            : 'hover:bg-bg-hover'
                        )}
                      >
                        <span className="font-medium">{skill.name}</span>
                        <span className="block text-text-tertiary mt-0.5">{skill.description}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 消息模板 */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                消息内容
                <span className="ml-2 text-xs text-text-tertiary font-normal">支持 {`{{变量名}}`} 模板替换</span>
              </label>
              <textarea
                value={config.message || ''}
                onChange={(e) => {
                  if (selectedNode && workflowId) {
                    updateWorkflowNode(workflowId, selectedNode.id, {
                      ...selectedNode.data,
                      a2aConfig: { ...config, message: e.target.value },
                    });
                  }
                }}
                placeholder={'请分析以下内容：{{input}}'}
                rows={4}
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-bg-primary text-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>

            {/* 流式模式 */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-text-primary">流式模式</span>
                <p className="text-xs text-text-tertiary">使用 sendSubscribe 实时接收响应</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (selectedNode && workflowId) {
                    updateWorkflowNode(workflowId, selectedNode.id, {
                      ...selectedNode.data,
                      a2aConfig: { ...config, streaming: !config.streaming },
                    });
                  }
                }}
                className={cn(
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                  config.streaming ? 'bg-cyan-600' : 'bg-gray-300'
                )}
              >
                <span className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  config.streaming ? 'translate-x-6' : 'translate-x-1'
                )} />
              </button>
            </div>

            {/* 输出变量 */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">输出变量名</label>
              <input
                type="text"
                value={config.outputVariable || ''}
                onChange={(e) => {
                  if (selectedNode && workflowId) {
                    updateWorkflowNode(workflowId, selectedNode.id, {
                      ...selectedNode.data,
                      a2aConfig: { ...config, outputVariable: e.target.value },
                    });
                  }
                }}
                placeholder="a2a_result"
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-bg-primary text-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>

            {/* 认证头 */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                认证头
                <span className="ml-2 text-xs text-text-tertiary font-normal">可选（如 Authorization: Bearer xxx）</span>
              </label>
              <textarea
                value={config.authHeaders ? JSON.stringify(config.authHeaders, null, 2) : ''}
                onChange={(e) => {
                  let headers: Record<string, string> | undefined;
                  try {
                    headers = e.target.value.trim() ? JSON.parse(e.target.value) : undefined;
                  } catch {
                    // JSON 解析失败时不更新
                  }
                  if (selectedNode && workflowId && headers !== undefined) {
                    updateWorkflowNode(workflowId, selectedNode.id, {
                      ...selectedNode.data,
                      a2aConfig: { ...config, authHeaders: headers },
                    });
                  }
                }}
                placeholder={'{"Authorization": "Bearer token123"}'}
                rows={2}
                className="w-full px-3 py-2 text-xs font-mono border border-border rounded-md bg-bg-primary text-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
          </div>
        );
      }

      case 'code': {
        const config = selectedNode.data.codeConfig;
        return (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">语言</label>
              <select
                defaultValue={config?.language}
                onChange={(e) => handleConfigChange('language', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
              >
                {codeLanguageOptions.map((lang) => (
                  <option key={lang.value} value={lang.value}>{lang.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">代码</label>
              <textarea
                defaultValue={config?.code}
                rows={8}
                onBlur={(e) => handleConfigChange('code', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">输入变量</label>
              <div className="flex flex-wrap gap-1.5">
                {(config?.inputVariables || []).map((varName: string, index: number) => (
                  <span
                    key={index}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-accent/10 text-accent rounded-full"
                  >
                    {varName}
                    <button
                      onClick={() => {
                        const newVars = (config?.inputVariables || []).filter((_v: string, i: number) => i !== index);
                        handleConfigChange('inputVariables', newVars);
                      }}
                      className="hover:text-accent-dark"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                placeholder="输入变量名，回车添加"
                className="w-full mt-2 px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const target = e.target as HTMLInputElement;
                    const newVars = [...(config?.inputVariables || []), target.value.trim()];
                    handleConfigChange('inputVariables', newVars);
                    target.value = '';
                  }
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">输出变量名</label>
                <input
                  type="text"
                  defaultValue={config?.outputVariable || 'code_output'}
                  onBlur={(e) => handleConfigChange('outputVariable', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">超时(ms)</label>
                <input
                  type="number"
                  defaultValue={config?.timeout || 30000}
                  onBlur={(e) => handleConfigChange('timeout', parseInt(e.target.value) || 30000)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
          </div>
        );
      }

      case 'template': {
        const config = selectedNode.data.templateConfig;
        return (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">模板类型</label>
              <select
                defaultValue={config?.templateType}
                onChange={(e) => handleConfigChange('templateType', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
              >
                <option value="string">字符串</option>
                <option value="json">JSON</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">模板内容</label>
              <textarea
                defaultValue={config?.template}
                placeholder="输入模板，支持变量引用如 {{name}}"
                rows={6}
                onBlur={(e) => handleConfigChange('template', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">输出变量名</label>
              <input
                type="text"
                defaultValue={config?.outputVariable || 'template_output'}
                onBlur={(e) => handleConfigChange('outputVariable', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>
        );
      }

      case 'variable': {
        const config = selectedNode.data.variableConfig;
        return (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">操作类型</label>
              <select
                defaultValue={config?.operation}
                onChange={(e) => handleConfigChange('operation', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
              >
                {operationOptions.map((op) => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">变量名</label>
              <input
                type="text"
                defaultValue={config?.variableName}
                placeholder="输入变量名"
                onBlur={(e) => handleConfigChange('variableName', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">变量类型</label>
              <select
                defaultValue={config?.valueType}
                onChange={(e) => handleConfigChange('valueType', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
              >
                {variableTypeOptions.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">值</label>
              <textarea
                defaultValue={config?.value}
                placeholder="输入值或变量引用"
                rows={3}
                onBlur={(e) => handleConfigChange('value', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none"
              />
            </div>
          </div>
        );
      }

      case 'http': {
        const config = selectedNode.data.httpConfig;
        return (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">方法</label>
                <select
                  defaultValue={config?.method}
                  onChange={(e) => handleConfigChange('method', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
                >
                  {httpMethodOptions.map((method) => (
                    <option key={method} value={method}>{method}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">Body 类型</label>
                <select
                  defaultValue={config?.bodyType}
                  onChange={(e) => handleConfigChange('bodyType', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
                >
                  {bodyTypeOptions.map((bt) => (
                    <option key={bt.value} value={bt.value}>{bt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">URL</label>
              <input
                type="text"
                defaultValue={config?.url}
                placeholder="https://api.example.com/endpoint"
                onBlur={(e) => handleConfigChange('url', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">请求头</label>
              <textarea
                defaultValue={JSON.stringify(config?.headers || {}, null, 2)}
                rows={4}
                onBlur={(e) => {
                  try {
                    handleConfigChange('headers', JSON.parse(e.target.value));
                  } catch {
                    handleConfigChange('headers', {});
                  }
                }}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">请求体</label>
              <textarea
                defaultValue={config?.body}
                rows={4}
                onBlur={(e) => handleConfigChange('body', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none font-mono text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">输出变量名</label>
                <input
                  type="text"
                  defaultValue={config?.outputVariable || 'http_output'}
                  onBlur={(e) => handleConfigChange('outputVariable', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">超时(ms)</label>
                <input
                  type="number"
                  defaultValue={config?.timeout || 30000}
                  onBlur={(e) => handleConfigChange('timeout', parseInt(e.target.value) || 30000)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
          </div>
        );
      }

      case 'database': {
        const config = selectedNode.data.databaseConfig;
        return (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">连接</label>
              <select
                defaultValue={config?.connectionId}
                onChange={(e) => handleConfigChange('connectionId', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
              >
                <option value="">选择数据库连接</option>
                <option value="db-1">MySQL - 主数据库</option>
                <option value="db-2">PostgreSQL - 分析库</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">查询类型</label>
              <select
                defaultValue={config?.queryType}
                onChange={(e) => handleConfigChange('queryType', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
              >
                {queryTypeOptions.map((qt) => (
                  <option key={qt.value} value={qt.value}>{qt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">SQL 语句</label>
              <textarea
                defaultValue={config?.sql}
                placeholder="输入 SQL 语句..."
                rows={5}
                onBlur={(e) => handleConfigChange('sql', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">输出变量名</label>
              <input
                type="text"
                defaultValue={config?.outputVariable || 'db_output'}
                onBlur={(e) => handleConfigChange('outputVariable', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>
        );
      }

      case 'knowledge': {
        const config = selectedNode.data.knowledgeConfig;
        return (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">知识库</label>
              <select
                defaultValue={config?.knowledgeBaseId}
                onChange={(e) => handleConfigChange('knowledgeBaseId', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
              >
                <option value="">选择知识库</option>
                <option value="kb-1">产品文档</option>
                <option value="kb-2">API 文档</option>
                <option value="kb-3">FAQ 知识库</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">查询语句</label>
              <textarea
                defaultValue={config?.query}
                placeholder="输入查询语句，支持变量引用"
                rows={3}
                onBlur={(e) => handleConfigChange('query', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">返回数量</label>
              <input
                type="number"
                defaultValue={config?.topK || 5}
                min={1}
                max={20}
                onBlur={(e) => handleConfigChange('topK', parseInt(e.target.value) || 5)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">输出变量名</label>
              <input
                type="text"
                defaultValue={config?.outputVariable || 'knowledge_output'}
                onBlur={(e) => handleConfigChange('outputVariable', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>
        );
      }

      case 'condition': {
        const config = selectedNode.data.conditionConfig;
        return (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">条件分支</label>
              <div className="space-y-2">
                {(config?.conditions || []).map((condition: any, index: number) => (
                  <div key={condition.id || index} className="p-3 bg-bg-secondary rounded-md">
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        defaultValue={condition.label}
                        placeholder="分支标签"
                        className="flex-1 px-2 py-1 text-sm border border-border rounded"
                        onBlur={(e) => {
                          const newConditions = [...(config?.conditions || [])];
                          newConditions[index] = { ...condition, label: e.target.value };
                          handleConfigChange('conditions', newConditions);
                        }}
                      />
                      <button
                        onClick={() => {
                          const newConditions = (config?.conditions || []).filter((_c: any, i: number) => i !== index);
                          handleConfigChange('conditions', newConditions);
                        }}
                        className="p-1.5 text-text-tertiary hover:text-red-500 transition-colors"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                    </div>
                    <input
                      type="text"
                      defaultValue={condition.expression}
                      placeholder="表达式，如 value > 0"
                      className="w-full px-2 py-1.5 text-sm border border-border rounded font-mono text-xs"
                      onBlur={(e) => {
                        const newConditions = [...(config?.conditions || [])];
                        newConditions[index] = { ...condition, expression: e.target.value };
                        handleConfigChange('conditions', newConditions);
                      }}
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  const newConditions = [...(config?.conditions || []), {
                    id: `cond-${Date.now()}`,
                    label: `条件${config?.conditions?.length + 1}`,
                    expression: '',
                  }];
                  handleConfigChange('conditions', newConditions);
                }}
                className="w-full mt-2 flex items-center justify-center gap-1 py-2 text-xs text-accent hover:bg-accent/10 rounded-md transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                添加条件分支
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">默认分支标签</label>
              <input
                type="text"
                defaultValue={config?.defaultLabel || '默认'}
                onBlur={(e) => handleConfigChange('defaultLabel', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>
        );
      }

      case 'loop': {
        const config = selectedNode.data.loopConfig;
        return (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">循环类型</label>
              <select
                defaultValue={config?.loopType}
                onChange={(e) => handleConfigChange('loopType', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
              >
                {loopTypeOptions.map((lt) => (
                  <option key={lt.value} value={lt.value}>{lt.label}</option>
                ))}
              </select>
            </div>

            {config?.loopType === 'count' && (
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">循环次数</label>
                <input
                  type="number"
                  defaultValue={config?.count || 10}
                  min={1}
                  max={1000}
                  onBlur={(e) => handleConfigChange('count', parseInt(e.target.value) || 10)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>
            )}

            {config?.loopType === 'array' && (
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">数组变量</label>
                <input
                  type="text"
                  defaultValue={config?.arrayVariable}
                  placeholder="数组变量名"
                  onBlur={(e) => handleConfigChange('arrayVariable', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">元素变量名</label>
                <input
                  type="text"
                  defaultValue={config?.itemVariable || 'item'}
                  onBlur={(e) => handleConfigChange('itemVariable', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">索引变量名</label>
                <input
                  type="text"
                  defaultValue={config?.indexVariable || 'index'}
                  onBlur={(e) => handleConfigChange('indexVariable', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
          </div>
        );
      }

      case 'subworkflow': {
        const config = selectedNode.data.subworkflowConfig;
        return (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">选择子工作流</label>
              <select
                defaultValue={config?.workflowId}
                onChange={(e) => handleConfigChange('workflowId', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
              >
                <option value="">选择工作流</option>
                {workflow ? workflows.filter((w) => w.id !== workflowId).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                )) : null}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">输入映射</label>
              <textarea
                defaultValue={JSON.stringify(config?.inputMapping || {}, null, 2)}
                rows={4}
                placeholder='{"input_var": "{{parent_var}}"}'
                onBlur={(e) => {
                  try {
                    handleConfigChange('inputMapping', JSON.parse(e.target.value));
                  } catch {
                    handleConfigChange('inputMapping', {});
                  }
                }}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">输出变量名</label>
              <input
                type="text"
                defaultValue={config?.outputVariable || 'subworkflow_output'}
                onBlur={(e) => handleConfigChange('outputVariable', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>
        );
      }

      case 'human-in-loop': {
        const config = selectedNode.data.humanConfig;
        return (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">审核标题</label>
              <input
                type="text"
                defaultValue={config?.title}
                onBlur={(e) => handleConfigChange('title', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">审核描述</label>
              <textarea
                defaultValue={config?.description}
                rows={3}
                onBlur={(e) => handleConfigChange('description', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">审核人</label>
              <input
                type="text"
                defaultValue={config?.assignee}
                placeholder="用户名或邮箱"
                onBlur={(e) => handleConfigChange('assignee', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">超时时间(ms)</label>
              <input
                type="number"
                defaultValue={config?.timeout || 86400000}
                onBlur={(e) => handleConfigChange('timeout', parseInt(e.target.value) || 86400000)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <div className="text-xs text-text-tertiary mt-1">默认 24 小时</div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">审核字段</label>
              <div className="space-y-2">
                {(config?.inputFields || []).map((field: any, index: number) => (
                  <div key={field.id || index} className="p-3 bg-bg-secondary rounded-md">
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        defaultValue={field.label}
                        placeholder="字段标签"
                        className="flex-1 px-2 py-1 text-sm border border-border rounded"
                        onBlur={(e) => {
                          const newFields = [...(config?.inputFields || [])];
                          newFields[index] = { ...field, label: e.target.value };
                          handleConfigChange('inputFields', newFields);
                        }}
                      />
                      <select
                        defaultValue={field.type}
                        className="px-2 py-1 text-sm border border-border rounded bg-white"
                        onChange={(e) => {
                          const newFields = [...(config?.inputFields || [])];
                          newFields[index] = { ...field, type: e.target.value };
                          handleConfigChange('inputFields', newFields);
                        }}
                      >
                        <option value="text">文本</option>
                        <option value="textarea">多行文本</option>
                        <option value="select">选择</option>
                        <option value="boolean">布尔</option>
                      </select>
                      <button
                        onClick={() => {
                          const newFields = (config?.inputFields || []).filter((_f: any, i: number) => i !== index);
                          handleConfigChange('inputFields', newFields);
                        }}
                        className="p-1.5 text-text-tertiary hover:text-red-500 transition-colors"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        defaultChecked={field.required}
                        onChange={(e) => {
                          const newFields = [...(config?.inputFields || [])];
                          newFields[index] = { ...field, required: e.target.checked };
                          handleConfigChange('inputFields', newFields);
                        }}
                        className="rounded"
                      />
                      必填
                    </label>
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  const newFields = [...(config?.inputFields || []), {
                    id: `field-${Date.now()}`,
                    label: `字段${config?.inputFields?.length + 1}`,
                    type: 'text',
                    required: false,
                  }];
                  handleConfigChange('inputFields', newFields);
                }}
                className="w-full mt-2 flex items-center justify-center gap-1 py-2 text-xs text-accent hover:bg-accent/10 rounded-md transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                添加字段
              </button>
            </div>
          </div>
        );
      }

      case 'host': {
        const config = selectedNode.data.hostConfig;
        return (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">选择主机</label>
              <select
                defaultValue={config?.hostId}
                onChange={(e) => handleConfigChange('hostId', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
              >
                <option value="">选择主机</option>
                {hosts.filter((h) => h.enabled).map((h) => (
                  <option key={h.id} value={h.id}>{h.name} ({h.host}:{h.port})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">操作类型</label>
              <select
                defaultValue={config?.operation}
                onChange={(e) => handleConfigChange('operation', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
              >
                <option value="command">执行命令</option>
                <option value="upload">上传文件</option>
                <option value="download">下载文件</option>
              </select>
            </div>

            {config?.operation === 'command' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1.5">工作目录</label>
                  <input
                    type="text"
                    defaultValue={config?.workDir || '/root'}
                    onBlur={(e) => handleConfigChange('workDir', e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1.5">命令</label>
                  <textarea
                    defaultValue={config?.command}
                    placeholder="输入要执行的命令"
                    rows={4}
                    onBlur={(e) => handleConfigChange('command', e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none font-mono text-xs"
                  />
                </div>
              </>
            )}

            {(config?.operation === 'upload' || config?.operation === 'download') && (
              <>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1.5">本地路径</label>
                  <input
                    type="text"
                    defaultValue={config?.localPath}
                    placeholder="本地文件路径"
                    onBlur={(e) => handleConfigChange('localPath', e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1.5">远程路径</label>
                  <input
                    type="text"
                    defaultValue={config?.remotePath}
                    placeholder="远程文件路径"
                    onBlur={(e) => handleConfigChange('remotePath', e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent font-mono"
                  />
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">输出变量名</label>
                <input
                  type="text"
                  defaultValue={config?.outputVariable || 'host_output'}
                  onBlur={(e) => handleConfigChange('outputVariable', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">超时(ms)</label>
                <input
                  type="number"
                  defaultValue={config?.timeout || 60000}
                  onBlur={(e) => handleConfigChange('timeout', parseInt(e.target.value) || 60000)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  const visibleTabs = showConfigTab ? ['basic', 'config'] : ['basic'];

  return (
    <div className="w-72 bg-white border-l border-border flex flex-col h-full">
      <div className="p-4 border-b border-border flex items-center justify-between flex-shrink-0">
        <div className="text-sm font-semibold text-text-primary">节点属性</div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="p-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', typeColor)}>
              <IconComponent className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-text-primary truncate">
                {selectedNode.data.label}
              </div>
              <div className="text-xs text-text-tertiary capitalize">{nodeType}</div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onDuplicate}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-md transition-colors active:scale-[0.97]"
            >
              <Copy className="w-4 h-4" />
              复制
            </button>
            <button
              onClick={onDelete}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors active:scale-[0.97]"
            >
              <Trash2 className="w-4 h-4" />
              删除
            </button>
          </div>
        </div>

        {visibleTabs.length > 1 && (
          <div className="flex border-b border-border flex-shrink-0">
            {(visibleTabs as Array<'basic' | 'config'>).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b-2 transition-colors',
                  activeTab === tab
                    ? 'border-accent text-accent bg-accent/5'
                    : 'border-transparent text-text-tertiary hover:text-text-secondary'
                )}
              >
                {tab === 'basic' && <Settings className="w-3.5 h-3.5" />}
                {tab === 'config' && <Bot className="w-3.5 h-3.5" />}
                {tab === 'basic' ? '基础' : '配置'}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'basic' && (
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">
                  节点名称
                </label>
                <input
                  type="text"
                  defaultValue={selectedNode.data.label}
                  onBlur={(e) => handleLabelChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">
                  描述
                </label>
                <textarea
                  defaultValue={selectedNode.data.description}
                  onBlur={(e) => handleDescriptionChange(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none"
                />
              </div>

              <div className="pt-2 border-t border-border">
                <div className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">节点信息</div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">节点 ID</span>
                    <span className="text-text-secondary font-mono">{selectedNode.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">类型</span>
                    <span className="text-text-secondary capitalize">{nodeType}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'config' && renderConfigContent()}
        </div>
      </div>

      <div className="p-4 border-t border-border flex-shrink-0">
        <button className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors active:scale-[0.97]">
          <Play className="w-4 h-4" />
          测试此节点
        </button>
      </div>
    </div>
  );
}
