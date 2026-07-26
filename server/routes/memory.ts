import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

// Factual Memory
router.get('/factual', async (_req, res) => {
  const memories = await prisma.factualMemory.findMany({ orderBy: { updatedAt: 'desc' } });
  res.json(memories.map(m => ({
    ...m,
    tags: JSON.parse(m.tags),
    keywords: JSON.parse(m.keywords),
  })));
});

router.post('/factual', async (req, res) => {
  const { type, content, tags, keywords, source, sessionId, messageId, importance } = req.body;
  const memory = await prisma.factualMemory.create({
    data: {
      type,
      content,
      tags: JSON.stringify(tags || []),
      keywords: JSON.stringify(keywords || []),
      source: source || '',
      sessionId,
      messageId,
      importance: importance || 0.5,
    },
  });
  res.json({ ...memory, tags: JSON.parse(memory.tags), keywords: JSON.parse(memory.keywords) });
});

router.put('/factual/:id/access', async (req, res) => {
  const memory = await prisma.factualMemory.update({
    where: { id: req.params.id },
    data: {
      accessCount: { increment: 1 },
      lastAccessedAt: new Date(),
    },
  });
  res.json(memory);
});

// Execution Traces
router.get('/traces', async (_req, res) => {
  const traces = await prisma.executionTrace.findMany({ orderBy: { timestamp: 'desc' }, take: 100 });
  res.json(traces.map(t => ({
    ...t,
    plan: JSON.parse(t.plan),
    resultData: JSON.parse(t.resultData),
    failureModes: t.failureModes ? JSON.parse(t.failureModes) : undefined,
    agentIds: t.agentIds ? JSON.parse(t.agentIds) : undefined,
  })));
});

router.post('/traces', async (req, res) => {
  const { userInput, plan, outcome, resultData, failureModes, agentIds, workflowId, duration } = req.body;
  const trace = await prisma.executionTrace.create({
    data: {
      userInput,
      plan: JSON.stringify(plan || []),
      outcome,
      resultData: JSON.stringify(resultData || {}),
      failureModes: failureModes ? JSON.stringify(failureModes) : null,
      agentIds: agentIds ? JSON.stringify(agentIds) : null,
      workflowId,
      duration,
    },
  });
  res.json({
    ...trace,
    plan: JSON.parse(trace.plan),
    resultData: JSON.parse(trace.resultData),
  });
});

// Experiential Reflections
router.get('/reflections', async (_req, res) => {
  const reflections = await prisma.experientialReflection.findMany({ orderBy: { timestamp: 'desc' } });
  res.json(reflections.map(r => ({
    ...r,
    principles: JSON.parse(r.principles),
    basedOnTraceIds: JSON.parse(r.basedOnTraceIds),
  })));
});

router.post('/reflections', async (req, res) => {
  const { trigger, summary, principles, layer, basedOnTraceIds, basedOnTraceCount } = req.body;
  const reflection = await prisma.experientialReflection.create({
    data: {
      trigger,
      summary,
      principles: JSON.stringify(principles || []),
      layer,
      basedOnTraceIds: JSON.stringify(basedOnTraceIds || []),
      basedOnTraceCount: basedOnTraceCount || 0,
    },
  });
  res.json({ ...reflection, principles: JSON.parse(reflection.principles) });
});

// Router Records
router.get('/router-records', async (_req, res) => {
  const records = await prisma.routerRecord.findMany({ orderBy: { timestamp: 'desc' }, take: 200 });
  res.json(records.map(r => ({
    ...r,
    taskFeatures: JSON.parse(r.taskFeatures),
  })));
});

router.post('/router-records', async (req, res) => {
  const { taskFeatures, channelId, modelName, provider, outcome, score, latencyMs, estTokens } = req.body;
  const record = await prisma.routerRecord.create({
    data: {
      taskFeatures: JSON.stringify(taskFeatures || {}),
      channelId,
      modelName,
      provider,
      outcome,
      score: score || 0,
      latencyMs: latencyMs || 0,
      estTokens: estTokens || 0,
    },
  });
  res.json(record);
});

export default router;
