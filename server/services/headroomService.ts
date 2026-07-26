/**
 * Headroom proxy 管理服务
 * - 自动启动本地 Headroom proxy（headroom proxy 命令）
 * - 提供 compress / retrieve / stats 路由供前端调用
 * - 使用 headroom-ai SDK 作为 HTTP 客户端
 */

import type { Request, Response } from 'express';
import express from 'express';
import { spawn, ChildProcess } from 'child_process';
import { HeadroomClient, compress, type CompressResult } from 'headroom-ai';

// ===== Headroom 客户端单例 =====

const DEFAULT_PROXY_URL = process.env.HEADROOM_PROXY_URL || 'http://localhost:8787';
const DEFAULT_API_KEY = process.env.HEADROOM_API_KEY || '';

let client: HeadroomClient | null = null;

function getClient(): HeadroomClient {
  if (!client) {
    client = new HeadroomClient({
      baseUrl: DEFAULT_PROXY_URL,
      apiKey: DEFAULT_API_KEY || undefined,
      timeout: 60000,
    });
  }
  return client;
}

// ===== Headroom Proxy 进程管理 =====

let proxyProcess: ChildProcess | null = null;
let proxyStatus: 'stopped' | 'starting' | 'running' | 'error' = 'stopped';
let proxyError: string | null = null;

/**
 * 启动本地 Headroom proxy 进程
 */
export function startHeadroomProxy(): { success: boolean; error?: string } {
  if (proxyProcess && proxyStatus === 'running') {
    return { success: true };
  }

  try {
    proxyStatus = 'starting';
    proxyError = null;

    // 使用 npx headroom proxy 启动本地代理
    proxyProcess = spawn('npx', ['headroom', 'proxy'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    proxyProcess.stdout?.on('data', (chunk: Buffer) => {
      const output = chunk.toString();
      // 检测代理启动成功的标志
      if (output.includes('Listening') || output.includes('running') || output.includes('started')) {
        proxyStatus = 'running';
      }
    });

    proxyProcess.stderr?.on('data', (chunk: Buffer) => {
      const output = chunk.toString();
      // 一些 headroom proxy 将日志输出到 stderr
      if (output.includes('Listening') || output.includes('running') || output.includes('started')) {
        proxyStatus = 'running';
      }
    });

    proxyProcess.on('error', (err) => {
      proxyStatus = 'error';
      proxyError = err.message;
      proxyProcess = null;
    });

    proxyProcess.on('exit', (code) => {
      proxyStatus = 'stopped';
      proxyProcess = null;
      if (code !== 0 && code !== null) {
        proxyError = `Headroom proxy 进程退出 (code=${code})`;
      }
    });

    // 给一个短暂的宽限期，然后标记为运行
    // 如果进程没有立即退出，假定它正在启动
    setTimeout(() => {
      if (proxyStatus === 'starting') {
        proxyStatus = 'running';
      }
    }, 3000);

    return { success: true };
  } catch (e: any) {
    proxyStatus = 'error';
    proxyError = e.message;
    return { success: false, error: e.message };
  }
}

/**
 * 停止 Headroom proxy 进程
 */
export function stopHeadroomProxy(): { success: boolean } {
  if (proxyProcess) {
    try {
      proxyProcess.kill();
    } catch {
      // ignore
    }
    proxyProcess = null;
  }
  proxyStatus = 'stopped';
  proxyError = null;
  return { success: true };
}

/**
 * 获取 Headroom proxy 状态
 */
export function getHeadroomStatus(): {
  status: 'stopped' | 'starting' | 'running' | 'error';
  error?: string;
  proxyUrl: string;
} {
  return {
    status: proxyStatus,
    error: proxyError || undefined,
    proxyUrl: DEFAULT_PROXY_URL,
  };
}

// ===== Express 路由注册 =====

export function registerHeadroomRoutes(router: express.Router): void {
  // 压缩消息
  router.post('/compress', async (req: Request, res: Response) => {
    try {
      const { messages, options } = req.body;
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ success: false, error: '缺少 messages 数组' });
      }

      const result: CompressResult = await compress(messages, {
        baseUrl: DEFAULT_PROXY_URL,
        apiKey: DEFAULT_API_KEY || undefined,
        model: options?.model,
        tokenBudget: options?.tokenBudget,
        timeout: 60000,
      });

      res.json({
        success: true,
        messages: result.messages,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
        tokensSaved: result.tokensSaved,
        compressionRatio: result.compressionRatio,
        transformsApplied: result.transformsApplied,
        ccrHashes: result.ccrHashes,
        compressed: result.compressed,
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // CCR 检索
  router.get('/retrieve/:hash', async (req: Request, res: Response) => {
    try {
      const { hash } = req.params;
      const query = req.query.q as string | undefined;

      if (!hash) {
        return res.status(400).json({ success: false, error: '缺少 hash 参数' });
      }

      const client = getClient();
      const result = await client.retrieve(hash, { query });

      res.json({ success: true, result });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 压缩统计
  router.get('/stats', async (req: Request, res: Response) => {
    try {
      const client = getClient();

      const [health, proxyStats, sessionStats] = await Promise.allSettled([
        client.health(),
        client.proxyStats(),
        client.getStats(),
      ]);

      res.json({
        success: true,
        proxyStatus: getHeadroomStatus(),
        health: health.status === 'fulfilled' ? health.value : null,
        proxyStats: proxyStats.status === 'fulfilled' ? proxyStats.value : null,
        sessionStats: sessionStats.status === 'fulfilled' ? sessionStats.value : null,
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 启动 proxy
  router.post('/start', (_req: Request, res: Response) => {
    const result = startHeadroomProxy();
    res.json(result);
  });

  // 停止 proxy
  router.post('/stop', (_req: Request, res: Response) => {
    const result = stopHeadroomProxy();
    res.json(result);
  });

  // 健康检查
  router.get('/health', async (_req: Request, res: Response) => {
    try {
      const client = getClient();
      const health = await client.health();
      res.json({ success: true, health });
    } catch (e: any) {
      res.json({ success: false, error: e.message, status: getHeadroomStatus() });
    }
  });
}
