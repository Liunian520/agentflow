import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

router.get('/', async (_req, res) => {
  const channels = await prisma.channel.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(channels.map(c => ({
    ...c,
    models: JSON.parse(c.models),
  })));
});

router.post('/', async (req, res) => {
  const { name, provider, apiKey, baseUrl, models, enabled } = req.body;
  const channel = await prisma.channel.create({
    data: {
      name,
      provider,
      apiKey,
      baseUrl: baseUrl || '',
      models: JSON.stringify(models || []),
      enabled: enabled !== undefined ? enabled : true,
    },
  });
  res.json({ ...channel, models: JSON.parse(channel.models) });
});

router.put('/:id', async (req, res) => {
  const { name, provider, apiKey, baseUrl, models, enabled } = req.body;
  const channel = await prisma.channel.update({
    where: { id: req.params.id },
    data: {
      name,
      provider,
      apiKey,
      baseUrl,
      models: models !== undefined ? JSON.stringify(models) : undefined,
      enabled,
    },
  });
  res.json({ ...channel, models: JSON.parse(channel.models) });
});

router.delete('/:id', async (req, res) => {
  await prisma.channel.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

export default router;
