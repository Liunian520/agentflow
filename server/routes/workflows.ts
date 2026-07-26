import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

router.get('/', async (_req, res) => {
  const workflows = await prisma.workflow.findMany({ orderBy: { updatedAt: 'desc' } });
  res.json(workflows.map(w => ({
    ...w,
    nodes: JSON.parse(w.nodes),
    edges: JSON.parse(w.edges),
    variables: JSON.parse(w.variables),
    metaSkill: w.metaSkill ? JSON.parse(w.metaSkill) : null,
  })));
});

router.post('/', async (req, res) => {
  const { name, description, nodes, edges, status, variables, metaSkill } = req.body;
  const workflow = await prisma.workflow.create({
    data: {
      name,
      description: description || '',
      nodes: JSON.stringify(nodes || []),
      edges: JSON.stringify(edges || []),
      status: status || 'draft',
      variables: JSON.stringify(variables || {}),
      metaSkill: metaSkill ? JSON.stringify(metaSkill) : null,
    },
  });
  res.json({
    ...workflow,
    nodes: JSON.parse(workflow.nodes),
    edges: JSON.parse(workflow.edges),
    variables: JSON.parse(workflow.variables),
    metaSkill: workflow.metaSkill ? JSON.parse(workflow.metaSkill) : null,
  });
});

router.put('/:id', async (req, res) => {
  const { name, description, nodes, edges, status, variables, metaSkill } = req.body;
  const workflow = await prisma.workflow.update({
    where: { id: req.params.id },
    data: {
      name,
      description,
      nodes: nodes !== undefined ? JSON.stringify(nodes) : undefined,
      edges: edges !== undefined ? JSON.stringify(edges) : undefined,
      status,
      variables: variables !== undefined ? JSON.stringify(variables) : undefined,
      metaSkill: metaSkill !== undefined ? (metaSkill ? JSON.stringify(metaSkill) : null) : undefined,
    },
  });
  res.json({
    ...workflow,
    nodes: JSON.parse(workflow.nodes),
    edges: JSON.parse(workflow.edges),
    variables: JSON.parse(workflow.variables),
    metaSkill: workflow.metaSkill ? JSON.parse(workflow.metaSkill) : null,
  });
});

router.delete('/:id', async (req, res) => {
  await prisma.workflow.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

export default router;
