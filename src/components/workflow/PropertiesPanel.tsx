import { useState, useMemo } from 'react';
import { X, Trash2, Copy, Settings, ChevronDown, ChevronRight, Plus, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import * as Icons from 'lucide-react';
import type { Node } from 'reactflow';
import { useStore } from '../../store/useStore';
import { getNodeTypeDefinition, NODE_TYPE_DEFINITIONS } from '../../lib/nodeDefaults';
import type { NodeTypeDefinition } from '../../lib/nodeDefaults';

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
  StopCircle: Icons.StopCircle,
  Wrench: Icons.Wrench,
  Save: Icons.Save,
  Repeat: Icons.Repeat,
  UserCheck: Icons.UserCheck,
  Users: Icons.Users,
};

const typeColorMap: Record<string, string> = {
  start: 'bg-emerald-500',
  end: 'bg-red-500',
  llm: 'bg-blue-500',
  agent: 'bg-violet-500',
  tool: 'bg-amber-500',
  code: 'bg-gray-600',
  http: 'bg-orange-500',
  condition: 'bg-orange-500',
  loop: 'bg-rose-500',
  memory_read: 'bg-cyan-500',
  memory_write: 'bg-cyan-500',
  human_in_loop: 'bg-yellow-500',
  subagent: 'bg-purple-500',
  subworkflow: 'bg-purple-500',
};

interface SchemaProperty {
  type: string;
  title?: string;
  description?: string;
  default?: any;
  widget?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  optionsFrom?: 'mcpTools' | 'mcpServers';
}

interface FormFieldProps {
  schema: SchemaProperty;
  value: any;
  onChange: (value: any) => void;
  required?: boolean;
  path: string;
  mcpTools?: Array<{ name: string; description: string; serverName?: string; serverId?: string }>;
  mcpServers?: Array<{ id: string; name: string }>;
  channelModelOptions?: Array<{ value: string; label: string }>;
}

function FormField({ schema, value, onChange, required, path, mcpTools, mcpServers, channelModelOptions }: FormFieldProps) {
  const type = schema.type;
  const widget = schema.widget;

  if (schema.optionsFrom === 'mcpTools' && type === 'string') {
    return (
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">
          {schema.title || path}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {schema.description && (
          <p className="text-xs text-text-tertiary mb-1.5">{schema.description}</p>
        )}
        <select
          value={value ?? schema.default ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
        >
          <option value="">请选择工具</option>
          {(mcpTools || []).map((tool) => (
            <option key={`${tool.serverId || ''}-${tool.name}`} value={tool.name}>
              {tool.serverName ? `[${tool.serverName}] ` : ''}{tool.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (schema.optionsFrom === 'mcpServers' && type === 'string') {
    return (
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">
          {schema.title || path}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {schema.description && (
          <p className="text-xs text-text-tertiary mb-1.5">{schema.description}</p>
        )}
        <select
          value={value ?? schema.default ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
        >
          <option value="">全部服务器</option>
          {(mcpServers || []).map((server) => (
            <option key={server.id} value={server.id}>
              {server.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (widget === 'textarea' || widget === 'code-editor') {
    return (
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">
          {schema.title || path}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {schema.description && (
          <p className="text-xs text-text-tertiary mb-1.5">{schema.description}</p>
        )}
        <textarea
          value={value ?? schema.default ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={widget === 'code-editor' ? 8 : 4}
          className={cn(
            'w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none',
            widget === 'code-editor' && 'font-mono text-xs'
          )}
        />
      </div>
    );
  }

  if (type === 'string' && schema.enum) {
    return (
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">
          {schema.title || path}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {schema.description && (
          <p className="text-xs text-text-tertiary mb-1.5">{schema.description}</p>
        )}
        <select
          value={value ?? schema.default ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
        >
          {schema.enum.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  if (type === 'string' && path === 'model' && channelModelOptions && channelModelOptions.length > 0) {
    return (
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">
          {schema.title || path}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {schema.description && (
          <p className="text-xs text-text-tertiary mb-1.5">{schema.description}</p>
        )}
        <select
          value={value ?? schema.default ?? 'auto'}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white"
        >
          {channelModelOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    );
  }

  if (type === 'string') {
    return (
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">
          {schema.title || path}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {schema.description && (
          <p className="text-xs text-text-tertiary mb-1.5">{schema.description}</p>
        )}
        <input
          type="text"
          value={value ?? schema.default ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
      </div>
    );
  }

  if (type === 'number' || type === 'integer') {
    const hasRange = schema.minimum !== undefined && schema.maximum !== undefined;
    return (
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">
          {schema.title || path}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {schema.description && (
          <p className="text-xs text-text-tertiary mb-1.5">{schema.description}</p>
        )}
        {hasRange ? (
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={schema.minimum}
              max={schema.maximum}
              step={type === 'integer' ? 1 : 0.1}
              value={value ?? schema.default ?? 0}
              onChange={(e) => onChange(parseFloat(e.target.value))}
              className="flex-1 accent-accent"
            />
            <span className="text-sm text-text-secondary w-12 text-right">{value ?? schema.default ?? 0}</span>
          </div>
        ) : (
          <input
            type="number"
            min={schema.minimum}
            max={schema.maximum}
            value={value ?? schema.default ?? ''}
            onChange={(e) => {
              const val = e.target.value === '' ? '' : parseFloat(e.target.value);
              onChange(val);
            }}
            className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        )}
      </div>
    );
  }

  if (type === 'boolean') {
    return (
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium text-text-primary">
            {schema.title || path}
            {required && <span className="text-red-500 ml-1">*</span>}
          </label>
          {schema.description && (
            <p className="text-xs text-text-tertiary mt-0.5">{schema.description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={cn(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
            value ? 'bg-accent' : 'bg-gray-300'
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
              value ? 'translate-x-6' : 'translate-x-1'
            )}
          />
        </button>
      </div>
    );
  }

  if (type === 'array' && schema.items?.type === 'string') {
    const arrValue = Array.isArray(value) ? value : [];
    const [inputValue, setInputValue] = useState('');

    const addItem = () => {
      if (inputValue.trim()) {
        onChange([...arrValue, inputValue.trim()]);
        setInputValue('');
      }
    };

    const removeItem = (index: number) => {
      onChange(arrValue.filter((_: string, i: number) => i !== index));
    };

    return (
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">
          {schema.title || path}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {schema.description && (
          <p className="text-xs text-text-tertiary mb-1.5">{schema.description}</p>
        )}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {arrValue.length === 0 && (
            <div className="text-xs text-text-tertiary py-1">暂无项目</div>
          )}
          {arrValue.map((item: string, index: number) => (
            <span
              key={index}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-accent/10 text-accent rounded-full"
            >
              {item}
              <button
                onClick={() => removeItem(index)}
                className="hover:text-accent-dark"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addItem();
              }
            }}
            placeholder="输入后按回车添加"
            className="flex-1 px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
          <button
            type="button"
            onClick={addItem}
            className="px-3 py-2 text-sm bg-accent text-white rounded-md hover:bg-accent-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  if (type === 'array' && schema.items?.type === 'object') {
    const arrValue = Array.isArray(value) ? value : [];

    const addItem = () => {
      const newItem: Record<string, any> = {};
      if (schema.items?.properties) {
        Object.entries(schema.items.properties).forEach(([key, prop]) => {
          newItem[key] = prop.default ?? (prop.type === 'string' ? '' : prop.type === 'number' || prop.type === 'integer' ? 0 : prop.type === 'boolean' ? false : prop.type === 'array' ? [] : {});
        });
      }
      newItem.id = `item-${Date.now()}`;
      onChange([...arrValue, newItem]);
    };

    const removeItem = (index: number) => {
      onChange(arrValue.filter((_: any, i: number) => i !== index));
    };

    const updateItem = (index: number, field: string, val: any) => {
      const newArr = [...arrValue];
      newArr[index] = { ...newArr[index], [field]: val };
      onChange(newArr);
    };

    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-text-primary">
            {schema.title || path}
            {required && <span className="text-red-500 ml-1">*</span>}
          </label>
          <button
            type="button"
            onClick={addItem}
            className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded-md transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            添加
          </button>
        </div>
        {schema.description && (
          <p className="text-xs text-text-tertiary mb-2">{schema.description}</p>
        )}
        <div className="space-y-2">
          {arrValue.length === 0 && (
            <div className="text-xs text-text-tertiary py-2 text-center border border-dashed border-border rounded-md">
              暂无项目，点击上方添加
            </div>
          )}
          {arrValue.map((item: any, index: number) => (
            <div key={item.id || index} className="p-3 bg-bg-secondary rounded-md space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-secondary">
                  项目 {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  className="p-1 text-text-tertiary hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {schema.items?.properties &&
                Object.entries(schema.items.properties).map(([key, prop]) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-text-secondary mb-1">
                      {prop.title || key}
                    </label>
                    {prop.type === 'string' && prop.enum ? (
                      <select
                        value={item[key] ?? prop.default ?? ''}
                        onChange={(e) => updateItem(index, key, e.target.value)}
                        className="w-full px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:border-accent bg-white"
                      >
                        {prop.enum.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : prop.type === 'string' ? (
                      <input
                        type="text"
                        value={item[key] ?? prop.default ?? ''}
                        onChange={(e) => updateItem(index, key, e.target.value)}
                        className="w-full px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:border-accent"
                      />
                    ) : prop.type === 'number' || prop.type === 'integer' ? (
                      <input
                        type="number"
                        value={item[key] ?? prop.default ?? ''}
                        onChange={(e) =>
                          updateItem(index, key, parseFloat(e.target.value) || 0)
                        }
                        className="w-full px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:border-accent"
                      />
                    ) : prop.type === 'boolean' ? (
                      <button
                        type="button"
                        onClick={() => updateItem(index, key, !item[key])}
                        className={cn(
                          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                          item[key] ? 'bg-accent' : 'bg-gray-300'
                        )}
                      >
                        <span
                          className={cn(
                            'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
                            item[key] ? 'translate-x-5' : 'translate-x-0.5'
                          )}
                        />
                      </button>
                    ) : null}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'object' && schema.properties) {
    return <ObjectField schema={schema} value={value} onChange={onChange} path={path} />;
  }

  return null;
}

function ObjectField({
  schema,
  value,
  onChange,
  path,
  mcpTools,
  mcpServers,
  channelModelOptions,
}: {
  schema: SchemaProperty;
  value: any;
  onChange: (value: any) => void;
  path: string;
  mcpTools?: Array<{ name: string; description: string; serverName?: string; serverId?: string }>;
  mcpServers?: Array<{ id: string; name: string }>;
  channelModelOptions?: Array<{ value: string; label: string }>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const objValue = value ?? {};
  const required = schema.required || [];

  const handlePropertyChange = (key: string, val: any) => {
    onChange({ ...objValue, [key]: val });
  };

  if (path !== '') {
    return (
      <div className="border border-border rounded-md overflow-hidden">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between px-3 py-2 bg-bg-secondary hover:bg-bg-hover transition-colors"
        >
          <span className="text-sm font-medium text-text-primary">
            {schema.title || path}
          </span>
          {collapsed ? (
            <ChevronRight className="w-4 h-4 text-text-tertiary" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-tertiary" />
          )}
        </button>
        {!collapsed && (
          <div className="p-3 space-y-3">
            {Object.entries(schema.properties || {}).map(([key, propSchema]) => (
              <FormField
                key={key}
                schema={propSchema}
                value={objValue[key]}
                onChange={(val) => handlePropertyChange(key, val)}
                required={required.includes(key)}
                path={key}
                mcpTools={mcpTools}
                mcpServers={mcpServers}
                channelModelOptions={channelModelOptions}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {Object.entries(schema.properties || {}).map(([key, propSchema]) => (
        <FormField
          key={key}
          schema={propSchema}
          value={objValue[key]}
          onChange={(val) => handlePropertyChange(key, val)}
          required={required.includes(key)}
          path={key}
          mcpTools={mcpTools}
          mcpServers={mcpServers}
          channelModelOptions={channelModelOptions}
        />
      ))}
    </div>
  );
}

export function PropertiesPanel({
  selectedNode,
  workflowId,
  onClose,
  onDelete,
  onDuplicate,
}: PropertiesPanelProps) {
  const { updateWorkflowEditorNode, channels, mcps } = useStore();

  const nodeTypeDef = useMemo<NodeTypeDefinition | undefined>(() => {
    if (!selectedNode) return undefined;
    return getNodeTypeDefinition(selectedNode.data.type);
  }, [selectedNode]);

  const configSchema = nodeTypeDef?.configSchema;
  const requiredFields = configSchema?.required || [];

  const nodeType = selectedNode?.data.type || '';
  const iconName = nodeTypeDef?.icon || 'Box';
  const IconComponent = iconMap[iconName] || Icons.Box;
  const typeColor = typeColorMap[nodeType] || 'bg-gray-500';

  const mcpServerList = useMemo(() => {
    return (mcps || []).filter((m) => m.enabled).map((m) => ({ id: m.id, name: m.name }));
  }, [mcps]);

  const mcpToolList = useMemo(() => {
    const tools: Array<{ name: string; description: string; serverName?: string; serverId?: string }> = [];
    const currentConfig = selectedNode?.data?.toolConfig;
    const selectedServerId = currentConfig?.mcpServerId;

    (mcps || []).filter((m) => m.enabled).forEach((server) => {
      if (selectedServerId && server.id !== selectedServerId) return;
      (server.tools || []).forEach((tool) => {
        tools.push({
          name: tool.name,
          description: tool.description,
          serverName: server.name,
          serverId: server.id,
        });
      });
    });
    return tools;
  }, [mcps, selectedNode]);

  const channelModelOptions = useMemo(() => {
    if (nodeType !== 'llm' && nodeType !== 'agent' && nodeType !== 'subagent') return undefined;
    const options: Array<{ value: string; label: string }> = [
      { value: 'auto', label: '🤖 自动路由（根据任务类型选择最优模型）' },
    ];
    for (const channel of channels) {
      if (!channel.enabled || !channel.apiKey) continue;
      for (const model of channel.models) {
        options.push({
          value: model.name,
          label: `${model.displayName || model.name} (${channel.name})`,
        });
      }
    }
    return options;
  }, [channels, nodeType]);

  const getConfigKey = (type: string) => {
    return `${type}Config`;
  };

  const getConfigValue = () => {
    if (!selectedNode) return {};
    const configKey = getConfigKey(nodeType) as keyof typeof selectedNode.data;
    return selectedNode.data[configKey] || {};
  };

  const handleConfigChange = (key: string, value: any) => {
    if (!selectedNode) return;
    const configKey = getConfigKey(nodeType);
    const currentConfig = getConfigValue();
    const updatedConfig = { ...currentConfig, [key]: value };
    updateWorkflowEditorNode(selectedNode.id, {
      data: {
        ...selectedNode.data,
        [configKey]: updatedConfig,
      },
    });
  };

  const handleLabelChange = (value: string) => {
    if (!selectedNode) return;
    updateWorkflowEditorNode(selectedNode.id, {
      data: { ...selectedNode.data, label: value },
    });
  };

  const handleDescriptionChange = (value: string) => {
    if (!selectedNode) return;
    updateWorkflowEditorNode(selectedNode.id, {
      data: { ...selectedNode.data, description: value },
    });
  };

  if (!selectedNode) {
    return (
      <div className="w-80 bg-white border-l border-border flex flex-col h-full">
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

  const configValue = getConfigValue();

  return (
    <div className="w-80 bg-white border-l border-border flex flex-col h-full">
      <div className="p-4 border-b border-border flex items-center justify-between flex-shrink-0">
        <div className="text-sm font-semibold text-text-primary">节点属性</div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-3 mb-3">
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', typeColor)}>
              <IconComponent className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-text-primary truncate">
                {selectedNode.data.label || nodeTypeDef?.label || nodeType}
              </div>
              <div className="text-xs text-text-tertiary capitalize">{nodeTypeDef?.label || nodeType}</div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onDuplicate}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-md transition-colors"
            >
              <Copy className="w-4 h-4" />
              复制
            </button>
            <button
              onClick={onDelete}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              删除
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              节点名称
            </label>
            <input
              type="text"
              value={selectedNode.data.label || ''}
              onChange={(e) => handleLabelChange(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              描述
            </label>
            <textarea
              value={selectedNode.data.description || ''}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none"
            />
          </div>

          {configSchema && configSchema.properties && Object.keys(configSchema.properties).length > 0 && (
            <div className="pt-4 border-t border-border">
              <div className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-3">
                节点配置
              </div>
              <ObjectField
                schema={configSchema as SchemaProperty}
                value={configValue}
                onChange={(val) => {
                  if (!selectedNode) return;
                  const configKey = getConfigKey(nodeType);
                  updateWorkflowEditorNode(selectedNode.id, {
                    data: {
                      ...selectedNode.data,
                      [configKey]: val,
                    },
                  });
                }}
                path=""
                mcpTools={mcpToolList}
                mcpServers={mcpServerList}
                channelModelOptions={channelModelOptions}
              />
            </div>
          )}

          <div className="pt-4 border-t border-border">
            <div className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">节点信息</div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-text-tertiary">节点 ID</span>
                <span className="text-text-secondary font-mono truncate ml-2">{selectedNode.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-tertiary">类型</span>
                <span className="text-text-secondary capitalize">{nodeType}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
