import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { SSHService } from './services/sshService';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 3001);

// CORS: 允许本地开发和前端部署域名
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'https://agentflow.pages.dev',
  'https://agentflow.vercel.app',
  'https://agentflow.netlify.app',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.pages.dev')) {
      callback(null, true);
    } else {
      callback(null, true); // 生产环境建议改成 false
    }
  },
  credentials: true,
}));
app.use(express.json());

const sshService = new SSHService();

app.post('/api/ssh/connect', async (req, res) => {
  const { hostId, host, port, username, authType, password, privateKey } = req.body;
  try {
    const result = await sshService.connect(hostId, {
      host,
      port,
      username,
      authType,
      password,
      privateKey,
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
