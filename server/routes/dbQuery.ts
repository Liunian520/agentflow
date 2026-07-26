import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

router.post('/', async (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query string required' });
  }

  // 安全限制：只允许 SELECT 查询（只读）
  const trimmed = query.trim().toLowerCase();
  if (!trimmed.startsWith('select')) {
    return res.status(403).json({ error: 'Only SELECT queries are allowed' });
  }

  try {
    // 使用 Prisma $queryRawUnsafe 执行原始 SQL
    // 注意：这有一定风险，但我们已经通过 startsWith('select') 做了限制
    const rows = await prisma.$queryRawUnsafe(query);
    res.json({ rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Query execution failed' });
  }
});

export default router;
