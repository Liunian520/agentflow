/**
 * 操作执行器 — 将意图解析结果映射为 Zustand store 操作
 */

import type { ParsedIntent, ActionResult } from '../../../types';
import { useStore } from '../../../store/useStore';
import { generateId } from '../../../lib/utils';

export function executeAction(intent: ParsedIntent): ActionResult {
  const store = useStore.getState();

  switch (intent.action) {
    case 'create_agent': {
      try {
        const { name, description, model, systemPrompt, tools, temperature, avatar } = intent.params;
        store.createAgent({
          name: name || '新助手',
          description: description || 'AI 助手',
          model: model || 'GPT-4o',
          systemPrompt: systemPrompt || '你是一个专业的 AI 助手。',
          tools: tools || [],
          temperature: temperature ?? 0.7,
          avatar: avatar || '🤖',
        });
        // 返回最新创建的 agent
        const newAgent = useStore.getState().agents[useStore.getState().agents.length - 1];
        return {
          success: true,
          type: 'agent_created',
          data: { agentId: newAgent.id, agent: newAgent },
        };
      } catch (error: any) {
        return { success: false, type: 'agent_created', error: error.message };
      }
    }

    case 'create_workflow': {
      try {
        const { name, nodeSequence } = intent.params;
        const workflowId = store.createWorkflow(name || '新工作流');

        // 如果指定了节点序列，自动添加节点和连线
        if (nodeSequence && nodeSequence.length > 0) {
          const createdNodes: string[] = [];
          const wf = useStore.getState().workflows.find((w: any) => w.id === workflowId);
          if (!wf) return { success: false, type: 'workflow_created', error: '找不到工作流' };

          // 从 nodeTemplates 找到对应的模板
          const templates = store.nodeTemplates;
          for (const nodeSpec of nodeSequence) {
            const template = templates.find((t: any) => t.type === nodeSpec.type);
            if (template) {
              const newNodeId = `node-${generateId()}`;
              const newNode = {
                id: newNodeId,
                type: template.type,
                name: nodeSpec.label || template.name,
                description: template.description,
                icon: template.icon,
                color: template.color,
                category: template.category,
                defaultData: template.defaultData ? { ...template.defaultData } : undefined,
              };
              store.updateWorkflow(workflowId, {
                nodes: [...(useStore.getState().workflows.find((w: any) => w.id === workflowId)?.nodes || []), newNode],
              });
              createdNodes.push(newNodeId);
            }
          }

          // 自动连线
          for (let i = 0; i < createdNodes.length - 1; i++) {
            const edge = {
              id: `edge-${generateId()}`,
              source: createdNodes[i],
              target: createdNodes[i + 1],
            };
            store.addWorkflowEdge(workflowId, edge);
          }
        }

        const newWorkflow = useStore.getState().workflows.find((w: any) => w.id === workflowId);
        return {
          success: true,
          type: 'workflow_created',
          data: { workflowId, workflow: newWorkflow },
        };
      } catch (error: any) {
        return { success: false, type: 'workflow_created', error: error.message };
      }
    }

    case 'run_workflow': {
      try {
        const { workflowId } = intent.params;
        if (workflowId) {
          store.setCurrentWorkflow(workflowId);
        }
        const currentId = workflowId || store.currentWorkflowId;
        if (!currentId) {
          return { success: false, type: 'workflow_run', error: '请指定要运行的工作流' };
        }
        store.setCurrentWorkflow(currentId);
        store.startExecution();
        return {
          success: true,
          type: 'workflow_run',
          data: { workflowId: currentId },
        };
      } catch (error: any) {
        return { success: false, type: 'workflow_run', error: error.message };
      }
    }

    case 'list_agents': {
      return {
        success: true,
        type: 'agents_listed',
        data: { agents: store.agents },
      };
    }

    case 'list_workflows': {
      return {
        success: true,
        type: 'workflows_listed',
        data: { workflows: store.workflows },
      };
    }

    case 'update_agent': {
      try {
        const { agentId, updates } = intent.params;
        if (!agentId) {
          // 如果没有指定 agentId，尝试通过名称匹配
          const nameMatch = store.agents.find((a: any) => a.name.includes(intent.originalText));
          if (nameMatch) {
            store.updateAgent(nameMatch.id, updates);
            return { success: true, type: 'agent_updated', data: { agentId: nameMatch.id } };
          }
          return { success: false, type: 'agent_updated', error: '请指定要修改的 Agent' };
        }
        store.updateAgent(agentId, updates);
        return { success: true, type: 'agent_updated', data: { agentId } };
      } catch (error: any) {
        return { success: false, type: 'agent_updated', error: error.message };
      }
    }

    case 'query_status': {
      return {
        success: true,
        type: 'status_queried',
        data: {
          executionState: store.executionState,
          agents: store.agents.length,
          workflows: store.workflows.length,
          currentWorkflow: store.currentWorkflowId,
        },
      };
    }

    case 'ssh_command': {
      // SSH 命令需要后端支持，MVP 暂返回提示
      return {
        success: true,
        type: 'ssh_command_hint',
        data: {
          command: intent.params.command,
          note: 'SSH 命令需要通过工作流中的主机节点执行，或直接在远程主机页面操作',
        },
      };
    }

    case 'general_chat':
      return {
        success: true,
        type: 'general_chat',
        data: { text: intent.originalText },
      };

    default:
      return {
        success: false,
        type: 'unknown',
        error: '无法识别的操作意图',
      };
  }
}
