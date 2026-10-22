import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { SSHService } from './services/sshService';
import llmProxyRouter from './services/llmProxy';
import { registerMcpRoutes } from './services/mcpService';
import a2aRouter from './services/a2aService';
import { aesKeyExpiresIn, decryptAesGcm, getOrCreateAesKey } from './services/crypto';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 3001);

// CORS: 严格白名单 — 仅允许本地开发和已部署的前端域名
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://127.0.0.1:5176',
  'https://agentflow.pages.dev',
  'https://agentflow.vercel.app',
  'https://agentflow.netlify.app',
  'https://agent.lnyun.site',
];

// 生产环境可通过环境变量追加额外域名
const extraOrigins = (process.env.CORS_EXTRA_ORIGINS || '').split(',').filter(Boolean);
const allAllowed = [...allowedOrigins, ...extraOrigins];

app.use(cors({
  origin: (origin, callback) => {
    // 无 origin 的请求（如 curl、服务端调用）允许通过
    if (!origin) return callback(null, true);
    if (allAllowed.includes(origin)) return callback(null, true);
    // Cloudflare Pages 子域名通配 (*.pages.dev)
    if (origin.endsWith('.pages.dev')) return callback(null, true);
    // 拒绝时不要抛错，否则 cors 会把策略拒绝变成 HTTP 500
    callback(null, false);
  },
  credentials: true,
}));
app.use(express.json());

// ===== 路由注册 =====
app.use('/api/llm', llmProxyRouter);

// Phase 6：MCP 服务器管理 + 工具调用（JSON-RPC over fetch 客户端）
const mcpRouter = express.Router();
registerMcpRoutes(mcpRouter);
app.use('/api', mcpRouter);

// Phase 11：A2A (Agent-to-Agent) 协议代理
app.use('/api', a2aRouter);

const sshService = new SSHService();

// 前端获取加密密钥（仅限白名单 origin）。密钥实现见 services/crypto.ts。
app.get('/api/crypto/key', (req, res) => {
  res.json({ key: getOrCreateAesKey(), expiresIn: aesKeyExpiresIn() });
});

// SSH connect 端点 — 支持加密私钥
app.post('/api/ssh/connect', async (req, res) => {
  const { hostId, host, port, username, authType, password, privateKey, privateKeyEncrypted } = req.body;
  try {
    // 如果前端发送了加密私钥，先解密
    let resolvedPrivateKey = privateKey;
    if (privateKeyEncrypted) {
      const aesKey = getOrCreateAesKey();
      resolvedPrivateKey = decryptAesGcm(privateKeyEncrypted, aesKey);
    }

    const result = await sshService.connect(hostId, {
      host,
      port,
      username,
      authType,
      password,
      privateKey: resolvedPrivateKey,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/ssh/execute', async (req, res) => {
  const { hostId, command } = req.body;
  try {
    const result = await sshService.executeCommand(hostId, command);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/ssh/upload', async (req, res) => {
  const { hostId, localPath, remotePath } = req.body;
  try {
    const result = await sshService.uploadFile(hostId, localPath, remotePath);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/ssh/download', async (req, res) => {
  const { hostId, remotePath, localPath } = req.body;
  try {
    const result = await sshService.downloadFile(hostId, remotePath, localPath);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/ssh/disconnect', async (req, res) => {
  const { hostId } = req.body;
  try {
    sshService.disconnect(hostId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/ssh/status/:hostId', (req, res) => {
  const { hostId } = req.params;
  const status = sshService.getConnectionStatus(hostId);
  res.json({ success: true, status });
});

app.get('/api/ssh/hosts', (req, res) => {
  const hosts = sshService.getConnectedHosts();
  res.json({ success: true, hosts });
});

// 健康检查（Render 等平台需要）
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SSH Server running on port ${PORT}`);
});
