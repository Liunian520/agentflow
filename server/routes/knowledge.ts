import { Router } from 'express';
import { prisma } from '../db';
import { searchKnowledge } from '../services/knowledgeService';

const router = Router();

router.get('/', async (_req, res) => {
  const docs = await prisma.knowledgeDoc.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(docs);
});

router.post('/', async (req, res) => {
  const { title, content, embedding, source } = req.body;
  const doc = await prisma.knowledgeDoc.create({
    data: {
      title,
      content,
      embedding: embedding ? JSON.stringify(embedding) : null,
      source: source || 'upload',
    },
  });
  res.json(doc);
});

router.post('/search', async (req, res) => {
  const { embedding, topK } = req.body;
  if (!embedding || !Array.isArray(embedding)) {
    return res.status(400).json({ error: 'embedding array required' });
  }
  const results = await searchKnowledge(embedding, topK || 3);
  res.json(results);
});

router.delete('/:id', async (req, res) => {
  await prisma.knowledgeDoc.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

export default router;
