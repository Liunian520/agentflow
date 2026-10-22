import { useCallback, useRef, useState, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Play,
  Save,
  Settings,
  MoreHorizontal,
  ChevronLeft,
  Zap,
  Clock,
  Layers,
  SlidersHorizontal,
  X,
  Check,
  Undo2,
  Redo2,
  Bookmark,
  Trash2,
  Plus,
} from 'lucide-react';
import { NodePanel } from '../components/workflow/NodePanel';
import { PropertiesPanel } from '../components/workflow/PropertiesPanel';
import { ExecutionPanel } from '../components/workflow/ExecutionPanel';
import { CustomNode } from '../components/workflow/CustomNode';
import { useStore } from '../store/useStore';
import { cn, generateId } from '../lib/utils';

const nodeTypes: NodeTypes = {
  custom: CustomNode,
};

const getInitialNodes = (workflow: any): Node[] => {
  if (!workflow || !workflow.nodes) return [];
  
  const positions = [
    { x: 50, y: 200 },
    { x: 300, y: 200 },
    { x: 550, y: 100 },
    { x: 550, y: 300 },
    { x: 800, y: 200 },
    { x: 1050, y: 200 },
  ];

  return workflow.nodes.map((node: any, index: number) => {
    const defaultData = node.defaultData || {};
    const savedPosition = node.position || defaultData.position;
    return {
      id: node.id,
      type: 'custom',
      position: savedPosition || positions[index % positions.length],
      data: {
        label: defaultData.label || node.name,
        description: defaultData.description || node.description,
        iconName: defaultData.iconName || node.icon,
        type: node.type,
        templateId: node.id,
        tools: defaultData.tools || node.tools || [],
        ...defaultData,
      },
    };
  });
};

const getInitialEdges = (workflow: any): Edge[] => {
  if (!workflow || !workflow.edges) return [];
  return workflow.edges.map((edge: any) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    animated: false,
  }));
};

export function WorkflowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showProperties, setShowProperties] = useState(true);
  const [showNodePanelMobile, setShowNodePanelMobile] = useState(false);
  const [showPropertiesMobile, setShowPropertiesMobile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showExecutionPanel, setShowExecutionPanel] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const { workflows, updateWorkflow, removeWorkflowNode, duplicateWorkflowNode, executionState, startExecution, stopExecution, currentWorkflowId, setCurrentWorkflow, checkpoints, addCheckpoint, deleteCheckpoint } = useStore();
  const workflowsLoaded = useStore((s) => s.workflows.length > 0);
  const currentWorkflow = id ? workflows.find((w) => w.id === id) : null;
  const lastNodeCountRef = useRef<number>(0);

  // ===== Undo / Redo 历史（作用于画布本地 nodes/edges） =====
  const nodesRef = useRef<Node[]>(nodes);
  const edgesRef = useRef<Edge[]>(edges);
  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  type GraphSnap = { nodes: Node[]; edges: Edge[] };
  const MAX_HISTORY = 50;
  const historyRef = useRef<{ past: GraphSnap[]; future: GraphSnap[] }>({ past: [], future: [] });
  const [, forceHistoryRender] = useState(0);

  const cloneGraph = (n: Node[], e: Edge[]): GraphSnap => ({
    nodes: JSON.parse(JSON.stringify(n)),
    edges: JSON.parse(JSON.stringify(e)),
  });

  const pushSnapshot = useCallback(() => {
    historyRef.current = {
      past: [...historyRef.current.past, cloneGraph(nodesRef.current, edgesRef.current)].slice(-MAX_HISTORY),
      future: [],
    };
    forceHistoryRender((t) => t + 1);
  }, []);

  const commit = useCallback(
    (mutate: (cur: GraphSnap) => GraphSnap) => {
      pushSnapshot();
      const next = mutate(cloneGraph(nodesRef.current, edgesRef.current));
      setNodes(next.nodes);
      setEdges(next.edges);
      setIsDirty(true);
    },
    [pushSnapshot, setNodes, setEdges],
  );

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.past.length === 0) return;
    const prev = h.past[h.past.length - 1];
    const cur = cloneGraph(nodesRef.current, edgesRef.current);
    historyRef.current = {
      past: h.past.slice(0, -1),
      future: [cur, ...h.future].slice(0, MAX_HISTORY),
    };
    forceHistoryRender((t) => t + 1);
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setIsDirty(true);
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.future.length === 0) return;
    const next = h.future[0];
    const cur = cloneGraph(nodesRef.current, edgesRef.current);
    historyRef.current = {
      past: [...h.past, cur].slice(-MAX_HISTORY),
      future: h.future.slice(1),
    };
    forceHistoryRender((t) => t + 1);
    setNodes(next.nodes);
    setEdges(next.edges);
    setIsDirty(true);
  }, [setNodes, setEdges]);

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  // 检查点弹层
  const [showCheckpoint, setShowCheckpoint] = useState(false);
  const [cpLabel, setCpLabel] = useState('');

  const createCheckpoint = () => {
    if (!id) return;
    addCheckpoint(id, cpLabel, { nodes: nodesRef.current, edges: edgesRef.current });
    setCpLabel('');
    setShowCheckpoint(false);
  };

  const restoreCheckpoint = (cp: { nodes: Node[]; edges: Edge[] }) => {
    const snap = cloneGraph(cp.nodes, cp.edges);
    pushSnapshot();
    setNodes(snap.nodes);
    setEdges(snap.edges);
    setIsDirty(true);
    setShowCheckpoint(false);
  };

  // 路由不存在：等待加载完成，避免误判
  const isNotFound = workflowsLoaded && id && !currentWorkflow;

  // 只在切换工作流时整图重载。属性编辑会更新 updatedAt，若跟着重载会把未保存的节点位置清掉。
  useEffect(() => {
    if (currentWorkflow) {
      const initialNodes = getInitialNodes(currentWorkflow);
      const initialEdges = getInitialEdges(currentWorkflow);
      setNodes(initialNodes);
      setEdges(initialEdges);
      lastNodeCountRef.current = currentWorkflow.nodes.length;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 故意不依赖 updatedAt
  }, [id, currentWorkflow?.id, setNodes, setEdges]);

  useEffect(() => {
    if (!currentWorkflow || !reactFlowInstance) return;

    const currentCount = currentWorkflow.nodes.length;
    if (currentCount > lastNodeCountRef.current) {
      const newNodes = currentWorkflow.nodes.slice(lastNodeCountRef.current);
      const rfNodes: Node[] = newNodes.map((node: any) => {
        const defaultData = node.defaultData || {};
        const position = reactFlowInstance.screenToFlowPosition({
          x: typeof window !== 'undefined' ? window.innerWidth / 2 : 500,
          y: typeof window !== 'undefined' ? window.innerHeight / 2 : 300,
        });
        return {
          id: node.id,
          type: 'custom',
          position: {
            x: position.x + (Math.random() - 0.5) * 100,
            y: position.y + (Math.random() - 0.5) * 100,
          },
          data: {
            label: defaultData.label || node.name,
            description: defaultData.description || node.description,
            iconName: defaultData.iconName || node.icon,
            type: node.type,
            templateId: node.id,
            tools: defaultData.tools || node.tools || [],
            ...defaultData,
          },
        };
      });
      setNodes((nds) => nds.concat(rfNodes));
    }
    lastNodeCountRef.current = currentCount;
  }, [currentWorkflow?.nodes, reactFlowInstance, setNodes]);

  const handleNodesChange = useCallback(
    (changes: any[]) => {
      // 当节点被添加、删除、位置改变（拖拽结束）时记录历史快照
      const hasSignificantChange = changes.some(
        (c) => c.type === 'remove' || c.type === 'add' || (c.type === 'position' && c.dragging === false)
      );
      if (hasSignificantChange) pushSnapshot();
      onNodesChange(changes);
      if (hasSignificantChange) {
        setIsDirty(true);
      }
    },
    [onNodesChange, pushSnapshot]
  );

  const handleEdgesChange = useCallback(
    (changes: any[]) => {
      const hasChange = changes.some((c) => c.type === 'remove' || c.type === 'add');
      if (hasChange) pushSnapshot();
      onEdgesChange(changes);
      if (hasChange) {
        setIsDirty(true);
      }
    },
    [onEdgesChange, pushSnapshot]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      // 防止自连接
      if (params.source === params.target) return;
      commit((cur) => ({
        nodes: cur.nodes,
        edges: addEdge(
          {
            ...params,
            id: `edge-${generateId()}`,
            animated: false,
          },
          cur.edges
        ),
      }));
    },
    [commit]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const nodeData = event.dataTransfer.getData('application/reactflow');
      if (!nodeData || !reactFlowInstance || !id) return;

      const nodeTemplate = JSON.parse(nodeData);
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const defaultData = nodeTemplate.defaultData || {};

      const newNode: Node = {
        id: `node-${generateId()}`,
        type: 'custom',
        position,
        data: {
          label: defaultData.label || nodeTemplate.name,
          description: defaultData.description || nodeTemplate.description,
          iconName: defaultData.iconName || nodeTemplate.icon,
          type: nodeTemplate.type,
          templateId: nodeTemplate.id,
          tools: defaultData.tools || [],
          ...defaultData,
        },
      };

      commit((cur) => ({ nodes: [...cur.nodes, newNode], edges: cur.edges }));
    },
    [reactFlowInstance, commit, id]
  );

  const onDragStart = (event: React.DragEvent, nodeTemplate: any) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify(nodeTemplate));
    event.dataTransfer.effectAllowed = 'move';
  };

  const onNodeClick = (_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setShowProperties(true);
    setShowPropertiesMobile(true);
  };

  const onPaneClick = () => {
    setSelectedNode(null);
    setShowPropertiesMobile(false);
  };

  const handleDeleteNode = () => {
    if (selectedNode && id) {
      const delId = selectedNode.id;
      commit((cur) => ({
        nodes: cur.nodes.filter((n) => n.id !== delId),
        edges: cur.edges.filter((e) => e.source !== delId && e.target !== delId),
      }));
      removeWorkflowNode(id, delId);
      setSelectedNode(null);
      setShowPropertiesMobile(false);
    }
  };

  const handleDuplicateNode = () => {
    if (selectedNode && id) {
      const newNode: Node = {
        ...selectedNode,
        id: `node-${generateId()}`,
        position: {
          x: selectedNode.position.x + 50,
          y: selectedNode.position.y + 50,
        },
        data: {
          ...selectedNode.data,
          label: `${selectedNode.data.label} (副本)`,
        },
        selected: false,
      };
      commit((cur) => ({ nodes: [...cur.nodes, newNode], edges: cur.edges }));
      duplicateWorkflowNode(id, selectedNode.id);
      setSelectedNode(newNode);
    }
  };

  useEffect(() => {
    if (id && currentWorkflowId !== id) {
      setCurrentWorkflow(id);
    }
  }, [id, currentWorkflowId, setCurrentWorkflow]);

  const handleRun = () => {
    if (executionState.isRunning) {
      stopExecution();
    } else {
      setShowExecutionPanel(true);
      startExecution();
    }
  };

  const handleSave = () => {
    if (!id) return;
    setIsSaving(true);
    setSaveSuccess(false);

    setTimeout(() => {
      if (currentWorkflow) {
        const workflowNodes = nodes.map((n) => {
          const data = n.data;
          return {
            id: n.id,
            type: data.type,
            name: data.label,
            description: data.description,
            icon: data.iconName,
            color: '',
            category: '',
            position: n.position,
            defaultData: { ...data, position: n.position },
          };
        });
        const workflowEdges = edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: typeof e.label === 'string' ? e.label : undefined,
        }));
        updateWorkflow(id, {
          nodes: workflowNodes as any,
          edges: workflowEdges,
        });
      }
      setIsSaving(false);
      setSaveSuccess(true);
      setIsDirty(false);
      setTimeout(() => setSaveSuccess(false), 2000);
    }, 600);
  };

  // 路由切换/卸载前提示未保存的修改
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // 键盘快捷键：Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y 重做
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  const statusConfig = {
    draft: { label: '草稿', color: 'bg-gray-100 text-gray-600' },
    published: { label: '已发布', color: 'bg-emerald-100 text-emerald-700' },
    running: { label: '运行中', color: 'bg-blue-100 text-blue-700' },
    paused: { label: '已暂停', color: 'bg-amber-100 text-amber-700' },
  };

  const status = currentWorkflow?.status || 'draft';
  const statusInfo = statusConfig[status as keyof typeof statusConfig];

  // 工作流不存在
  if (isNotFound) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-bg-secondary">
        <div className="bg-white border border-border rounded-2xl p-8 max-w-md text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-red-50 flex items-center justify-center mb-4">
            <X className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-text-primary mb-2">工作流不存在</h2>
          <p className="text-sm text-text-secondary mb-6">
            找不到 ID 为 <code className="px-1.5 py-0.5 bg-bg-secondary rounded text-xs font-mono">{id}</code> 的工作流，可能已被删除。
          </p>
          <button
            onClick={() => navigate('/workflows', { replace: true })}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
          >
            返回工作流列表
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      <div className="h-12 sm:h-14 bg-white border-b border-border flex items-center justify-between px-3 sm:px-4 flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={() => navigate('/workflows')}
            className="p-2 -ml-2 rounded-md hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors active:scale-95"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="hidden sm:block h-6 w-px bg-border" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <h1 className="text-sm sm:text-base font-semibold text-text-primary truncate">
                {currentWorkflow?.name || '工作流编辑器'}
              </h1>
              {isDirty && (
                <span
                  className="px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded-full flex-shrink-0 bg-amber-100 text-amber-700"
                  title="有未保存的修改"
                >
                  未保存
                </span>
              )}
              <span
                className={cn(
                  'px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded-full flex-shrink-0',
                  statusInfo.color
                )}
              >
                {statusInfo.label}
              </span>
            </div>
            <div className="hidden sm:flex text-xs text-text-tertiary items-center gap-3">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                编辑于 刚刚
              </span>
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3" />
                {currentWorkflow?.runs || 0} 次运行
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={cn(
              'p-2 sm:flex sm:items-center sm:gap-1.5 sm:px-3 sm:py-1.5 text-sm rounded-md transition-colors active:scale-95',
              saveSuccess
                ? 'text-emerald-600 bg-emerald-50'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
            )}
          >
            {saveSuccess ? (
              <Check className="w-5 h-5 sm:w-4 sm:h-4" />
            ) : (
              <Save className="w-5 h-5 sm:w-4 sm:h-4" />
            )}
            <span className="hidden sm:inline">{isSaving ? '保存中...' : saveSuccess ? '已保存' : '保存'}</span>
          </button>
          {/* Undo / Redo / 检查点 */}
          <div className="hidden md:flex items-center gap-1">
            <button
              onClick={undo}
              disabled={!canUndo}
              title="撤销 (Ctrl+Z)"
              className={cn(
                'p-2 rounded-md transition-colors active:scale-95',
                canUndo ? 'text-text-secondary hover:text-text-primary hover:bg-bg-hover' : 'text-text-tertiary opacity-40 cursor-not-allowed'
              )}
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              title="重做 (Ctrl+Shift+Z)"
              className={cn(
                'p-2 rounded-md transition-colors active:scale-95',
                canRedo ? 'text-text-secondary hover:text-text-primary hover:bg-bg-hover' : 'text-text-tertiary opacity-40 cursor-not-allowed'
              )}
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>

          {/* 检查点弹层 */}
          <div className="relative hidden md:block">
            <button
              onClick={() => setShowCheckpoint((v) => !v)}
              title="检查点"
              className={cn(
                'flex items-center gap-1.5 px-2 py-2 rounded-md transition-colors',
                showCheckpoint ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              )}
            >
              <Bookmark className="w-4 h-4" />
            </button>
            {showCheckpoint && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowCheckpoint(false)} />
                <div className="absolute right-0 top-11 z-50 w-72 bg-white border border-border rounded-lg shadow-xl p-3 space-y-2">
                  <div className="text-xs font-semibold text-text-primary">检查点</div>
                  <div className="flex gap-2">
                    <input
                      value={cpLabel}
                      onChange={(e) => setCpLabel(e.target.value)}
                      placeholder="检查点名称（可选）"
                      onKeyDown={(e) => { if (e.key === 'Enter') createCheckpoint(); }}
                      className="flex-1 px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:border-accent"
                    />
                    <button
                      onClick={createCheckpoint}
                      className="flex items-center gap-1 px-2 py-1.5 text-xs text-white bg-accent hover:bg-accent-hover rounded-md transition-colors active:scale-95"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      创建
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {(checkpoints[id || ''] || []).length === 0 && (
                      <p className="text-xs text-text-tertiary py-2 text-center">暂无检查点</p>
                    )}
                    {(checkpoints[id || ''] || []).slice().reverse().map((cp) => (
                      <div key={cp.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-bg-secondary">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-text-primary truncate">{cp.label}</div>
                          <div className="text-[10px] text-text-tertiary">
                            {new Date(cp.timestamp).toLocaleString()} · {cp.nodes.length} 节点
                          </div>
                        </div>
                        <button
                          onClick={() => restoreCheckpoint(cp)}
                          className="px-2 py-1 text-[11px] text-accent hover:bg-accent/10 rounded-md transition-colors"
                        >
                          恢复
                        </button>
                        <button
                          onClick={() => id && deleteCheckpoint(id, cp.id)}
                          className="p-1 text-text-tertiary hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <button className="hidden sm:block p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors">
            <Settings className="w-4 h-4" />
          </button>
          <div className="hidden sm:block h-6 w-px bg-border" />
          <button
            onClick={handleRun}
            className={cn(
              'flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-1.5 text-sm font-medium rounded-md transition-colors active:scale-95 min-h-[40px] sm:min-h-0',
              executionState.isRunning
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-accent hover:bg-accent-hover text-white'
            )}
          >
            <Play className="w-4 h-4" />
            <span className="hidden sm:inline">{executionState.isRunning ? '停止运行' : '运行'}</span>
          </button>
          <button
            onClick={() => {
              const confirmed = confirm('确定要清空当前画布吗？此操作可通过撤销恢复。');
              if (confirmed) {
                commit(() => ({ nodes: [], edges: [] }));
              }
            }}
            className="p-2 -mr-2 text-text-secondary hover:text-red-500 hover:bg-red-50 rounded-md transition-colors active:scale-95"
            title="清空画布"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden relative">
        <div className="flex-1 flex overflow-hidden relative">
          <div className="hidden md:block flex-shrink-0">
            <NodePanel onDragStart={onDragStart} />
          </div>

          <div
            className={cn(
              'fixed inset-0 z-40 md:hidden transition-opacity duration-300',
              showNodePanelMobile ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            )}
          >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowNodePanelMobile(false)}
          />
          <div
            className={cn(
              'absolute left-0 top-0 h-full w-72 bg-white shadow-xl transition-transform duration-300',
              showNodePanelMobile ? 'translate-x-0' : '-translate-x-full'
            )}
          >
            <div className="flex items-center justify-between h-14 px-4 border-b border-border">
              <span className="font-semibold text-text-primary">节点库</span>
              <button
                onClick={() => setShowNodePanelMobile(false)}
                className="p-1.5 rounded-md hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="h-[calc(100%-3.5rem)] overflow-y-auto">
              <NodePanel onDragStart={onDragStart} />
            </div>
          </div>
        </div>

        <div className="flex-1 relative" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onConnectEnd={() => {
              setIsDirty(true);
            }}
            nodeTypes={nodeTypes}
            fitView
            className="bg-[#fafafa]"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e5e7eb" />
            <Controls
              className="!bg-white !border !border-border !rounded-lg !shadow-md"
              position="bottom-right"
            />
            <MiniMap
              className="hidden sm:block !bg-white !border !border-border !rounded-lg"
              position="bottom-left"
              nodeColor={(node) => {
                const type = node.data?.type;
                const colors: Record<string, string> = {
                  start: '#10b981',
                  end: '#ef4444',
                  llm: '#3b82f6',
                  agent: '#8b5cf6',
                  code: '#f59e0b',
                  template: '#14b8a6',
                  variable: '#06b6d4',
                  http: '#f97316',
                  database: '#1e40af',
                  knowledge: '#84cc16',
                  condition: '#8b5cf6',
                  loop: '#ec4899',
                  subworkflow: '#6366f1',
                  'human-in-loop': '#f43f5e',
                  host: '#6b7280',
                };
                return colors[type] || '#9ca3af';
              }}
            />
          </ReactFlow>

          <div className="md:hidden absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white rounded-full shadow-lg border border-border px-2 py-1.5 z-10">
            <button
              onClick={() => setShowNodePanelMobile(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full hover:bg-bg-secondary text-sm font-medium text-text-primary active:scale-95 transition-transform"
            >
              <Layers className="w-4 h-4" />
              <span>节点</span>
            </button>
            <div className="w-px h-5 bg-border" />
            <button
              onClick={() => {
                setShowPropertiesMobile(true);
                setShowProperties(true);
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full hover:bg-bg-secondary text-sm font-medium text-text-primary active:scale-95 transition-transform"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>属性</span>
            </button>
          </div>
        </div>

        <div className="hidden lg:block flex-shrink-0">
          {showProperties && (
            <PropertiesPanel
              selectedNode={selectedNode}
              workflowId={id || null}
              onClose={() => setShowProperties(false)}
              onDelete={handleDeleteNode}
              onDuplicate={handleDuplicateNode}
            />
          )}
        </div>

        <div
          className={cn(
            'fixed inset-0 z-40 lg:hidden transition-opacity duration-300',
            showPropertiesMobile ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          )}
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowPropertiesMobile(false)}
          />
          <div
            className={cn(
              'absolute right-0 top-0 h-full w-80 bg-white shadow-xl transition-transform duration-300',
              showPropertiesMobile ? 'translate-x-0' : 'translate-x-full'
            )}
          >
            <PropertiesPanel
              selectedNode={selectedNode}
              workflowId={id || null}
              onClose={() => setShowPropertiesMobile(false)}
              onDelete={handleDeleteNode}
              onDuplicate={handleDuplicateNode}
            />
          </div>
        </div>
        </div>

      {showExecutionPanel && (
        <div className="h-[320px] border-t border-border bg-white flex-shrink-0">
          <ExecutionPanel />
        </div>
      )}
      </div>
    </div>
  );
}
