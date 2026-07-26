import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

router.get('/:sessionId', async (req, res) => {
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: req.params.sessionId },
    orderBy: { timestamp: 'asc' },
  });
  res.json(messages.map(m => ({
    ...m,
    toolArgs: m.toolArgs ? JSON.parse(m.toolArgs) : undefined,
    toolResult: m.toolResult ? JSON.parse(m.toolResult) : undefined,
    metadata: m.metadata ? JSON.parse(m.metadata) : undefined,
    attachments: m.attachments ? JSON.parse(m.attachments) : undefined,
  })));
});

router.post('/', async (req, res) => {
  const { sessionId, role, content, agentId, toolName, toolArgs, toolResult, messageType, metadata, attachments } = req.body;
  const message = await prisma.chatMessage.create({
    data: {
      sessionId,
      role,
      content,
      agentId,
      toolName,
      toolArgs: toolArgs ? JSON.stringify(toolArgs) : null,
      toolResult: toolResult ? JSON.stringify(toolResult) : null,
      messageType,
      metadata: metadata ? JSON.stringify(metadata) : null,
      attachments: attachments ? JSON.stringify(attachments) : null,
    },
  });
  res.json({
    ...message,
    toolArgs: message.toolArgs ? JSON.parse(message.toolArgs) : undefined,
    toolResult: message.toolResult ? JSON.parse(message.toolResult) : undefined,
    metadata: message.metadata ? JSON.parse(message.metadata) : undefined,
    attachments: message.attachments ? JSON.parse(message.attachments) : undefined,
  });
});

router.delete('/session/:sessionId', async (req, res) => {
  await prisma.chatMessage.deleteMany({ where: { sessionId: req.params.sessionId } });
  res.json({ success: true });
});

export default router;
