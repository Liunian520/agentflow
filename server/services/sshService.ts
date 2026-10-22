import fs from 'fs';
import path from 'path';
import { Client, SFTPWrapper } from 'ssh2';

const DENIED_LOCAL_ROOTS = ['/etc', '/proc', '/sys', '/root', '/boot', '/dev', '/run', '/bin', '/sbin'];

/** PEM 原文直接使用；只有整段是 Base64 且解开后仍是 PEM 时才解码。 */
export function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('PRIVATE KEY')) return trimmed;
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8').trim();
  if (decoded.includes('PRIVATE KEY')) return decoded;
  return trimmed;
}

/** SFTP 的本地路径在本机文件系统上，限制在绝对路径且避开系统目录。 */
export function assertSafeLocalPath(input: string): string {
  if (!input || typeof input !== 'string' || !path.isAbsolute(input)) {
    throw new Error('本地路径必须是绝对路径');
  }
  let resolved = path.resolve(input);
  const parent = path.dirname(resolved);
  if (fs.existsSync(parent)) {
    resolved = path.join(fs.realpathSync(parent), path.basename(resolved));
  }
  const lower = resolved.toLowerCase();
  if (lower === '/' || DENIED_LOCAL_ROOTS.some((root) => lower === root || lower.startsWith(root + path.sep))) {
    throw new Error(`拒绝访问系统路径: ${resolved}`);
  }
  const allowed = (process.env.SSH_ALLOWED_ROOTS || '')
    .split(',').map((s) => s.trim()).filter(Boolean).map((p) => path.resolve(p));
  if (allowed.length > 0) {
    const ok = allowed.some((root) => {
      const rel = path.relative(root, resolved);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
    if (!ok) throw new Error(`本地路径不在 SSH_ALLOWED_ROOTS 内: ${resolved}`);
  }
  return resolved;
}

interface SSHConfig {
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKey?: string;
}

interface ConnectionInfo {
  client: Client;
  config: SSHConfig;
  connected: boolean;
  lastUsed: Date;
}

export class SSHService {
  private connections: Map<string, ConnectionInfo> = new Map();
  private sftpSessions: Map<string, SFTPWrapper> = new Map();

  async connect(hostId: string, config: SSHConfig): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve) => {
      if (this.connections.has(hostId)) {
        const conn = this.connections.get(hostId)!;
        if (conn.connected) {
          resolve({ success: true, message: '已连接' });
          return;
        }
      }

      const client = new Client();

      // 防止 ready/error/超时 竞态导致的重复 resolve
      let settled = false;
      const CONNECT_TIMEOUT = 20000;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { client.end(); } catch { /* noop */ }
        resolve({ success: false, message: `连接超时 (${CONNECT_TIMEOUT / 1000}s)，请检查主机地址、端口与网络` });
      }, CONNECT_TIMEOUT);
      const done = (r: { success: boolean; message: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };

      client.on('ready', () => {
        const connInfo: ConnectionInfo = {
          client,
          config,
          connected: true,
          lastUsed: new Date(),
        };
        this.connections.set(hostId, connInfo);
        done({ success: true, message: '连接成功' });
      });

      client.on('error', (err) => {
        try { client.end(); } catch { /* noop */ }
        done({ success: false, message: err.message });
      });

      client.on('close', () => {
        const conn = this.connections.get(hostId);
        if (conn) {
          conn.connected = false;
        }
        this.sftpSessions.delete(hostId);
      });

      const authMethods: any = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: CONNECT_TIMEOUT,
      };

      if (config.authType === 'password' && config.password) {
        authMethods.password = config.password;
      } else if (config.authType === 'privateKey' && config.privateKey) {
        authMethods.privateKey = normalizePrivateKey(config.privateKey);
      }

      try {
        client.connect(authMethods);
      } catch (e: any) {
        done({ success: false, message: e?.message || '连接发起失败' });
      }
    });
  }

  disconnect(hostId: string): void {
    const conn = this.connections.get(hostId);
    if (conn && conn.client) {
      conn.client.end();
      this.connections.delete(hostId);
    }
  }

  async executeCommand(hostId: string, command: string): Promise<{ success: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const conn = this.connections.get(hostId);
      if (!conn || !conn.connected) {
        resolve({ success: false, stdout: '', stderr: '主机未连接' });
        return;
      }

      conn.lastUsed = new Date();

      conn.client.exec(command, (err, stream) => {
        if (err) {
          resolve({ success: false, stdout: '', stderr: err.message });
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on('close', (code: number | null) => {
          resolve({ success: code === 0, stdout, stderr });
        });
      });
    });
  }

  async uploadFile(hostId: string, localPath: string, remotePath: string): Promise<{ success: boolean; message: string }> {
    let safePath: string;
    try {
      safePath = assertSafeLocalPath(localPath);
    } catch (error: any) {
      return { success: false, message: error.message };
    }
    return new Promise((resolve) => {
      const conn = this.connections.get(hostId);
      if (!conn || !conn.connected) {
        resolve({ success: false, message: '主机未连接' });
        return;
      }

      conn.lastUsed = new Date();

      conn.client.sftp((err, sftp) => {
        if (err) {
          resolve({ success: false, message: err.message });
          return;
        }

        let settled = false;
        const finish = (result: { success: boolean; message: string }) => {
          if (settled) return;
          settled = true;
          try { sftp.end(); } catch { /* noop */ }
          resolve(result);
        };

        const readStream = fs.createReadStream(safePath);
        const writeStream = sftp.createWriteStream(remotePath);
        readStream.on('error', (streamErr: Error) => finish({ success: false, message: streamErr.message }));
        writeStream.on('error', (streamErr: Error) => finish({ success: false, message: streamErr.message }));
        writeStream.on('close', () => finish({ success: true, message: '上传成功' }));
        readStream.pipe(writeStream);
      });
    });
  }

  async downloadFile(hostId: string, remotePath: string, localPath: string): Promise<{ success: boolean; message: string }> {
    let safePath: string;
    try {
      safePath = assertSafeLocalPath(localPath);
    } catch (error: any) {
      return { success: false, message: error.message };
    }
    return new Promise((resolve) => {
      const conn = this.connections.get(hostId);
      if (!conn || !conn.connected) {
        resolve({ success: false, message: '主机未连接' });
        return;
      }

      conn.lastUsed = new Date();

      conn.client.sftp((err, sftp) => {
        if (err) {
          resolve({ success: false, message: err.message });
          return;
        }

        let settled = false;
        const finish = (result: { success: boolean; message: string }) => {
          if (settled) return;
          settled = true;
          try { sftp.end(); } catch { /* noop */ }
          resolve(result);
        };

        const readStream = sftp.createReadStream(remotePath);
        const writeStream = fs.createWriteStream(safePath);
        readStream.on('error', (streamErr: Error) => finish({ success: false, message: streamErr.message }));
        writeStream.on('error', (streamErr: Error) => finish({ success: false, message: streamErr.message }));
        writeStream.on('close', () => finish({ success: true, message: '下载成功' }));
        readStream.pipe(writeStream);
      });
    });
  }

  getConnectionStatus(hostId: string): 'connected' | 'disconnected' | 'connecting' {
    const conn = this.connections.get(hostId);
    if (!conn) return 'disconnected';
    return conn.connected ? 'connected' : 'connecting';
  }

  getConnectedHosts(): string[] {
    const hosts: string[] = [];
    this.connections.forEach((conn, hostId) => {
      if (conn.connected) {
        hosts.push(hostId);
      }
    });
    return hosts;
  }
}
