import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

router.get('/', async (_req, res) => {
  const agents = await prisma.agent.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(agents.map(a => ({
    ...a,
    tools: JSON.parse(a.tools),
  })));
});

router.post('/', async (req, res) => {
  const { name, description, avatar, model, systemPrompt, tools, temperature, maxTokens } = req.body;
  const agent = await prisma.agent.create({
    data: {
      name,
      description: description || '',
      avatar: avatar || '',
      model: model || '',
      systemPrompt: systemPrompt || '',
      tools: JSON.stringify(tools || []),
      temperature,
      maxTokens,
    },
  });
  res.json({ ...agent, tools: JSON.parse(agent.tools) });
});

router.put('/:id', async (req, res) => {
  const { name, description, avatar, model, systemPrompt, tools, temperature, maxTokens } = req.body;
  const agent = await prisma.agent.update({
    where: { id: req.params.id },
    data: {
      name,
      description,
      avatar,
      model,
      systemPrompt,
      tools: tools !== undefined ? JSON.stringify(tools) : undefined,
      temperature,
      maxTokens,
    },
  });
  res.json({ ...agent, tools: JSON.parse(agent.tools) });
});

router.delete('/:id', async (req, res) => {
  await prisma.agent.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

export default router;
