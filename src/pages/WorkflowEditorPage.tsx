import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type ReactFlowInstance,
  type NodeMouseHandler,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  ChevronLeft,
  Zap,
  Trash2,
  Pencil,
  Check,
  X,
  Undo2,
  Redo2,
  Maximize2,
  ZoomIn,
  ZoomOut,
  Save,
  Play,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn, generateId } from '../lib/utils';
import { CustomNode } from '../components/workflow/CustomNode';
import { NodePanel } from '../components/workflow/NodePanel';
import { PropertiesPanel } from '../components/workflow/PropertiesPanel';
import { ExecutionPanel } from '../components/workflow/ExecutionPanel';
import { NODE_TYPE_DEFINITIONS, createDefaultNodeConfig } from '../lib/nodeDefaults';
import { WorkflowEngine, compileWorkflow } from '../lib/workflowEngine';
import type { FlowNode, FlowEdge, FlowNodeData, WorkflowNode, WorkflowEdge, ExecutionLog, NodeExecutionStatus } from '../types';

const nodeTypes = {
  custom: CustomNode,
};

const defaultViewport = { x: 0, y: 0, zoom: 1 };

function WorkflowEditorContent() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);

  const {
    workflows,
    deleteWorkflow,
    updateWorkflow,
    workflowEditorNodes,
    workflowEditorEdges,
    workflowEditorSelectedNodeId,
    workflowEditorPast,
    workflowEditorFuture,
    addWorkflowEditorNode,
    updateWorkflowEditorNode,
    deleteWorkflowEditorNode,
    addWorkflowEditorEdge,
    undoWorkflowEditor,
    redoWorkflowEditor,
    setWorkflowEditorSelectedNode,
    loadWorkflowToEditor,
    clearWorkflowEditor,
    executionState,
    breakpoints,
    nodeExecutionStatuses,
    toggleBreakpoint,
    clearBreakpoints,
    setNodeExecutionStatus,
    clearNodeExecutionStatuses,
  } = useStore();

  const workflowEngineRef = useRef<WorkflowEngine | null>(null);

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const [nodes, setNodes, onNodesChange] = useNodesState(workflowEditorNodes as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(workflowEditorEdges as Edge[]);

  const workflow = id ? workflows.find((w) => w.id === id) : null;

  useEffect(() => {
    if (workflow) {
      loadWorkflowToEditor(workflow.id);
    }
    return () => {
      clearWorkflowEditor();
    };
  }, [workflow?.id]);

  useEffect(() => {
    setNodes(workflowEditorNodes.map(n => ({
      ...n,
      type: 'custom',
      data: {
        ...n.data,
        executionStatus: nodeExecutionStatuses[n.id] || 'idle',
        hasBreakpoint: breakpoints.includes(n.id),
      },
    })) as Node[]);
  }, [workflowEditorNodes, nodeExecutionStatuses, breakpoints, setNodes]);

  useEffect(() => {
    setEdges(workflowEditorEdges.map(e => ({
      ...e,
      animated: false,
      style: { stroke: '#6366f1', strokeWidth: 2 },
    })) as Edge[]);
  }, [workflowEditorEdges, setEdges]);

  useEffect(() => {
    if (workflow && !isRenaming) {
      setRenameValue(workflow.name);
    }
  }, [workflow, isRenaming]);

  const onConnect = useCallback(
    (params: Connection) => {
      const newEdge: Omit<FlowEdge, 'id'> & { id?: string } = {
        source: params.source!,
        target: params.target!,
        sourceHandle: params.sourceHandle || null,
        targetHandle: params.targetHandle || null,
      };
      addWorkflowEditorEdge(newEdge);
    },
    [addWorkflowEditorEdge]
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      setWorkflowEditorSelectedNode(node.id);
    },
    [setWorkflowEditorSelectedNode]
  );

  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      toggleBreakpoint(node.id);
    },
    [toggleBreakpoint]
  );

  const onPaneClick = useCallback(() => {
    setWorkflowEditorSelectedNode(null);
  }, [setWorkflowEditorSelectedNode]);

  const addLog = useCallback((log: Omit<ExecutionLog, 'id' | 'timestamp'>) => {
    const newLog: ExecutionLog = {
      ...log,
      id: `log-${generateId()}`,
      timestamp: new Date().toISOString(),
    };
    useStore.setState((state) => ({
      executionState: {
        ...state.executionState,
        logs: [...state.executionState.logs, newLog],
      },
    }));
  }, []);

  const initWorkflowEngine = useCallback(() => {
    if (workflowEditorNodes.length === 0) return null;

    const plan = compileWorkflow(workflowEditorNodes, workflowEditorEdges);
    const engine = new WorkflowEngine(plan);

    engine.on('workflow:start', ({ state }) => {
      useStore.setState((s) => ({
        executionState: {
          ...s.executionState,
          status: 'running',
          isRunning: true,
          startTime: new Date().toISOString(),
          endTime: null,
          variables: state.variables,
          currentNodeId: state.currentNodeId,
          completedNodeIds: state.completedNodeIds,
          error: undefined,
        },
      }));
      addLog({
        nodeId: '',
        nodeName: '系统',
        level: 'info',
        message: '工作流开始执行',
        data: { variableCount: Object.keys(state.variables).length },
      });
    });

    engine.on('node:start', ({ nodeId, nodeName, nodeType }) => {
      setNodeExecutionStatus(nodeId, 'running');
      useStore.setState((s) => ({
        executionState: {
          ...s.executionState,
          currentNodeId: nodeId,
        },
      }));
      addLog({
        nodeId,
        nodeName,
        level: 'info',
        message: `节点开始执行`,
        data: { nodeType },
      });

      if (breakpoints.includes(nodeId)) {
        engine.pause();
        addLog({
          nodeId,
          nodeName,
          level: 'warn',
          message: '命中断点，执行已暂停',
        });
      }
    });

    engine.on('node:complete', ({ nodeId, result, state }) => {
      setNodeExecutionStatus(nodeId, 'completed');
      useStore.setState((s) => ({
        executionState: {
          ...s.executionState,
          variables: state.variables,
          completedNodeIds: state.completedNodeIds,
        },
      }));
      addLog({
        nodeId,
        nodeName: result.nodeName,
        level: 'success',
        message: `节点执行完成 (${result.duration}ms)`,
        data: result.output,
      });
    });

    engine.on('node:error', ({ nodeId, error, result }) => {
      setNodeExecutionStatus(nodeId, 'failed');
      addLog({
        nodeId,
        nodeName: result?.nodeName || nodeId,
        level: 'error',
        message: `节点执行失败: ${error}`,
        data: result,
      });
    });

    engine.on('workflow:complete', ({ state }) => {
      useStore.setState((s) => ({
        executionState: {
          ...s.executionState,
          status: 'completed',
          isRunning: false,
          endTime: new Date().toISOString(),
          variables: state.variables,
          completedNodeIds: state.completedNodeIds,
          currentNodeId: null,
        },
      }));
      addLog({
        nodeId: '',
        nodeName: '系统',
        level: 'success',
        message: '工作流执行完成',
        data: {
          completedNodes: state.completedNodeIds.length,
          totalDuration: state.totalDuration,
        },
      });
    });

    engine.on('workflow:error', ({ error, state }) => {
      useStore.setState((s) => ({
        executionState: {
          ...s.executionState,
          status: 'failed',
          isRunning: false,
          endTime: new Date().toISOString(),
          error,
          variables: state.variables,
          completedNodeIds: state.completedNodeIds,
          currentNodeId: null,
        },
      }));
      addLog({
        nodeId: '',
        nodeName: '系统',
        level: 'error',
        message: `工作流执行失败: ${error}`,
      });
    });

    engine.on('workflow:paused', ({ state }) => {
      useStore.setState((s) => ({
        executionState: {
          ...s.executionState,
          status: 'paused',
          isRunning: false,
          currentNodeId: state.currentNodeId,
        },
      }));
    });

    engine.on('workflow:resumed', ({ state }) => {
      useStore.setState((s) => ({
        executionState: {
          ...s.executionState,
          status: 'running',
          isRunning: true,
          currentNodeId: state.currentNodeId,
        },
      }));
    });

    return engine;
  }, [workflowEditorNodes, workflowEditorEdges, breakpoints, addLog, setNodeExecutionStatus]);

  const handleStartExecution = useCallback(async () => {
    clearNodeExecutionStatuses();

    useStore.setState((s) => ({
      executionState: {
        ...s.executionState,
        logs: [],
      },
    }));

    const engine = initWorkflowEngine();
    if (!engine) {
      addLog({
        nodeId: '',
        nodeName: '系统',
        level: 'error',
        message: '无法初始化工作流引擎，请检查工作流节点',
      });
      return;
    }

    workflowEngineRef.current = engine;

    try {
      await engine.execute();
    } catch (err: any) {
      console.error('工作流执行错误:', err);
    }
  }, [initWorkflowEngine, clearNodeExecutionStatuses, addLog]);

  const handlePauseExecution = useCallback(() => {
    if (workflowEngineRef.current) {
      workflowEngineRef.current.pause();
    }
  }, []);

  const handleResumeExecution = useCallback(() => {
    if (workflowEngineRef.current) {
      workflowEngineRef.current.resume();
    }
  }, []);

  const handleStopExecution = useCallback(() => {
    if (workflowEngineRef.current) {
      workflowEngineRef.current.reset();
      workflowEngineRef.current = null;
    }
    clearNodeExecutionStatuses();
    useStore.setState((s) => ({
      executionState: {
        ...s.executionState,
        status: 'idle',
        isRunning: false,
        currentNodeId: null,
        endTime: new Date().toISOString(),
        error: s.executionState.status === 'running' ? '执行已停止' : undefined,
      },
    }));
  }, [clearNodeExecutionStatuses]);

  const handleStepExecution = useCallback(async () => {
    if (!workflowEngineRef.current) {
      clearNodeExecutionStatuses();
      useStore.setState((s) => ({
        executionState: {
          ...s.executionState,
          logs: [],
        },
      }));
      const engine = initWorkflowEngine();
      if (!engine) return;
      workflowEngineRef.current = engine;
    }

    try {
      await workflowEngineRef.current.stepForward();
    } catch (err: any) {
      console.error('单步执行错误:', err);
    }
  }, [initWorkflowEngine, clearNodeExecutionStatuses]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (!type || !reactFlowWrapper.current || !reactFlowInstance) return;

      let nodeData: any;
      try {
        nodeData = JSON.parse(type);
      } catch {
        return;
      }

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      const nodeType = nodeData.type as string;
      const nodeDef = NODE_TYPE_DEFINITIONS[nodeType];
      const defaultConfig = createDefaultNodeConfig(nodeType);

      const newNode: Omit<FlowNode, 'id'> & { id?: string } = {
        type: nodeType,
        position,
        data: {
          label: nodeData.defaultData?.label || nodeDef?.label || nodeType,
          description: nodeData.defaultData?.description || nodeDef?.label || '',
          iconName: nodeData.defaultData?.iconName || nodeDef?.icon || 'Box',
          type: nodeType,
          ...nodeData.defaultData,
          ...defaultConfig,
        } as FlowNodeData,
      };

      addWorkflowEditorNode(newNode);
    },
    [reactFlowInstance, addWorkflowEditorNode]
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      deleted.forEach((node) => {
        deleteWorkflowEditorNode(node.id);
      });
    },
    [deleteWorkflowEditorNode]
  );

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      updateWorkflowEditorNode(node.id, { position: node.position });
    },
    [updateWorkflowEditorNode]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
        if (workflowEditorSelectedNodeId) {
          event.preventDefault();
          deleteWorkflowEditorNode(workflowEditorSelectedNodeId);
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redoWorkflowEditor();
        } else {
          undoWorkflowEditor();
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'y') {
        event.preventDefault();
        redoWorkflowEditor();
      }
    },
    [workflowEditorSelectedNodeId, deleteWorkflowEditorNode, undoWorkflowEditor, redoWorkflowEditor]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const startRename = () => {
    setRenameValue(workflow?.name || '');
    setIsRenaming(true);
  };

  const confirmRename = async () => {
    if (renameValue.trim() && workflow) {
      await updateWorkflow(workflow.id, { name: renameValue.trim() });
    }
    setIsRenaming(false);
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    if (workflow) {
      await deleteWorkflow(workflow.id);
      navigate('/workflows');
    }
  };

  const handleFitView = () => {
    if (reactFlowInstance) {
      reactFlowInstance.fitView({ padding: 0.2 });
    }
  };

  const handleZoomIn = () => {
    if (reactFlowInstance) {
      reactFlowInstance.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (reactFlowInstance) {
      reactFlowInstance.zoomOut();
    }
  };

  const handleDeleteSelected = () => {
    if (workflowEditorSelectedNodeId) {
      deleteWorkflowEditorNode(workflowEditorSelectedNodeId);
    }
  };

  const handleSave = async () => {
    if (!workflow) return;

    setSaveStatus('saving');

    const wfNodes: WorkflowNode[] = workflowEditorNodes.map((node) => {
      const nodeDef = NODE_TYPE_DEFINITIONS[node.type];
      return {
        id: node.id,
        type: node.type as WorkflowNode['type'],
        name: node.data.label || nodeDef?.label || node.type,
        description: node.data.description || '',
        icon: node.data.iconName || nodeDef?.icon || 'Box',
        color: getNodeColor(node.type),
        category: nodeDef?.category || 'advanced',
        defaultData: node.data,
      };
    });

    const wfEdges: WorkflowEdge[] = workflowEditorEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || undefined,
      targetHandle: edge.targetHandle || undefined,
      label: edge.label,
    }));

    await updateWorkflow(workflow.id, {
      nodes: wfNodes,
      edges: wfEdges,
    });

    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  const handleApplyJson = (newNodes: FlowNode[], newEdges: FlowEdge[]) => {
    const normalizedNodes = newNodes.map((node) => ({
      ...node,
      id: node.id || `node_${generateId()}`,
    }));

    const normalizedEdges = newEdges.map((edge) => ({
      ...edge,
      id: edge.id || `edge_${generateId()}`,
    }));

    useStore.setState((state) => ({
      workflowEditorNodes: normalizedNodes,
      workflowEditorEdges: normalizedEdges,
      workflowEditorPast: [
        ...state.workflowEditorPast,
        { nodes: state.workflowEditorNodes, edges: state.workflowEditorEdges },
      ],
      workflowEditorFuture: [],
      workflowEditorSelectedNodeId: null,
      workflowEditorSelectedEdgeId: null,
    }));
  };

  const getNodeColor = (type: string): string => {
    const colorMap: Record<string, string> = {
      start: '#10b981',
      end: '#ef4444',
      llm: '#3b82f6',
      agent: '#8b5cf6',
      tool: '#f59e0b',
      code: '#eab308',
      template: '#06b6d4',
      variable: '#ec4899',
      http: '#f97316',
      database: '#1e40af',
      knowledge: '#059669',
      condition: '#7c3aed',
      loop: '#ea580c',
      subworkflow: '#4338ca',
      subagent: '#7c3aed',
      a2a: '#0891b2',
      memory_read: '#06b6d4',
      memory_write: '#0891b2',
      human_in_loop: '#db2777',
      host: '#6b7280',
    };
    return colorMap[type] || '#6b7280';
  };

  const selectedNode = workflowEditorSelectedNodeId
    ? nodes.find((n) => n.id === workflowEditorSelectedNodeId) || null
    : null;

  if (!workflow) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg-secondary">
        <div className="text-center">
          <p className="text-text-secondary mb-3">工作流不存在或已删除</p>
          <button
            onClick={() => navigate('/workflows')}
            className="px-4 h-10 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors"
          >
            返回工作流列表
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 顶部栏 */}
      <div className="bg-white border-b border-border px-4 py-3 sm:px-6 flex items-center gap-3 shrink-0">
        <button
          onClick={() => navigate('/workflows')}
          className="p-2 -ml-2 text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-lg transition-colors"
          title="返回"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        {isRenaming ? (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmRename();
                if (e.key === 'Escape') setIsRenaming(false);
              }}
              className="flex-1 min-w-0 max-w-md px-3 py-1.5 text-lg font-semibold border border-accent rounded-md focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              onClick={confirmRename}
              className="p-1.5 text-accent hover:bg-accent/10 rounded-md transition-colors"
              title="确认"
            >
              <Check className="w-5 h-5" />
            </button>
            <button
              onClick={() => setIsRenaming(false)}
              className="p-1.5 text-text-tertiary hover:bg-bg-hover rounded-md transition-colors"
              title="取消"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-text-primary truncate">{workflow.name}</h1>
            <button
              onClick={startRename}
              className="p-1.5 text-text-tertiary hover:text-accent hover:bg-bg-hover rounded-md transition-colors shrink-0"
              title="重命名"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-1">
          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className={cn(
              'flex items-center gap-1.5 px-3 h-9 text-sm rounded-md transition-colors',
              saveStatus === 'saved'
                ? 'bg-green-500 text-white'
                : 'bg-accent text-white hover:bg-accent-hover disabled:opacity-50'
            )}
          >
            <Save className="w-4 h-4" />
            {saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存' : '保存'}
          </button>

          <button
            onClick={handleDelete}
            className={cn(
              'flex items-center gap-1.5 px-3 h-9 text-sm rounded-md transition-colors',
              confirmDelete
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'text-text-tertiary hover:text-red-500 hover:bg-red-50'
            )}
          >
            <Trash2 className="w-4 h-4" />
            {confirmDelete ? '确认删除' : '删除'}
          </button>
        </div>
      </div>

      {/* 工具栏 */}
      <div className="bg-white border-b border-border px-4 py-2 flex items-center gap-1 shrink-0">
        <button
          onClick={undoWorkflowEditor}
          disabled={workflowEditorPast.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 className="w-4 h-4" />
          <span className="hidden sm:inline">撤销</span>
        </button>

        <button
          onClick={redoWorkflowEditor}
          disabled={workflowEditorFuture.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="重做 (Ctrl+Shift+Z / Ctrl+Y)"
        >
          <Redo2 className="w-4 h-4" />
          <span className="hidden sm:inline">重做</span>
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        <button
          onClick={handleFitView}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors"
          title="适应视图"
        >
          <Maximize2 className="w-4 h-4" />
          <span className="hidden sm:inline">适应视图</span>
        </button>

        <button
          onClick={handleZoomIn}
          className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors"
          title="放大"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        <button
          onClick={handleZoomOut}
          className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors"
          title="缩小"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        <button
          onClick={handleDeleteSelected}
          disabled={!workflowEditorSelectedNodeId}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary hover:text-red-500 hover:bg-red-50 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="删除选中节点 (Delete)"
        >
          <Trash2 className="w-4 h-4" />
          <span className="hidden sm:inline">删除</span>
        </button>

        <div className="flex-1" />

        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <span>节点: {workflowEditorNodes.length}</span>
          <span>连线: {workflowEditorEdges.length}</span>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧节点面板 */}
        <NodePanel onDragStart={() => {}} />

        {/* 中间画布 */}
        <div ref={reactFlowWrapper} className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onPaneClick={onPaneClick}
            onNodesDelete={onNodesDelete}
            onNodeDragStop={onNodeDragStop}
            nodeTypes={nodeTypes}
            defaultViewport={defaultViewport}
            fitView
            deleteKeyCode={null}
            attributionPosition="bottom-right"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#d1d5db" />
            <Controls
              position="bottom-left"
              showInteractive={false}
            />
            <MiniMap
              position="bottom-right"
              nodeColor={(node) => {
                const type = node.type || 'default';
                const colorMap: Record<string, string> = {
                  start: '#10b981',
                  end: '#ef4444',
                  llm: '#3b82f6',
                  agent: '#8b5cf6',
                  tool: '#f59e0b',
                  code: '#eab308',
                  condition: '#7c3aed',
                  loop: '#ea580c',
                };
                return colorMap[type] || '#6b7280';
              }}
              maskColor="rgba(0, 0, 0, 0.1)"
              style={{
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
              }}
            />
          </ReactFlow>
        </div>

        {/* 右侧属性面板 */}
        <PropertiesPanel
          selectedNode={selectedNode}
          workflowId={workflow.id}
          onClose={() => setWorkflowEditorSelectedNode(null)}
          onDelete={handleDeleteSelected}
          onDuplicate={() => {}}
        />
      </div>

      {/* 底部执行面板 */}
      <ExecutionPanel
        onStart={handleStartExecution}
        onPause={handlePauseExecution}
        onResume={handleResumeExecution}
        onStop={handleStopExecution}
        onStep={handleStepExecution}
        nodes={workflowEditorNodes}
        edges={workflowEditorEdges}
        workflowId={workflow?.id}
        workflowName={workflow?.name}
        workflowDescription={workflow?.description}
        onApplyJson={handleApplyJson}
        showJsonTab={true}
      />
    </div>
  );
}

export function WorkflowEditorPage() {
  return (
    <ReactFlowProvider>
      <WorkflowEditorContent />
    </ReactFlowProvider>
  );
}
