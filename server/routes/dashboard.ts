import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

router.get('/stats', async (_req, res) => {
  const [workflowCount, agentCount, channelCount, totalRuns, traceCount] = await Promise.all([
    prisma.workflow.count(),
    prisma.agent.count(),
    prisma.channel.count(),
    prisma.workflow.aggregate({ _sum: { runs: true } }),
    prisma.executionTrace.count(),
  ]);

  const successTraces = await prisma.executionTrace.count({ where: { outcome: 'success' } });
  const failureTraces = await prisma.executionTrace.count({ where: { outcome: 'failure' } });

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const activeSessions = await prisma.chatMessage.groupBy({
    by: ['sessionId'],
    where: { timestamp: { gte: sevenDaysAgo } },
  });

  res.json({
    workflowCount,
    agentCount,
    channelCount,
    totalRuns: totalRuns._sum.runs || 0,
    traceCount,
    successRate: traceCount > 0 ? Math.round((successTraces / traceCount) * 100) : 0,
    failureRate: traceCount > 0 ? Math.round((failureTraces / traceCount) * 100) : 0,
    activeSessions7d: activeSessions.length,
  });
});

export default router;
