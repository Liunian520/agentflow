import { Client, SFTPWrapper } from 'ssh2';

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

      client.on('ready', () => {
        const connInfo: ConnectionInfo = {
          client,
          config,
          connected: true,
          lastUsed: new Date(),
        };
        this.connections.set(hostId, connInfo);
        resolve({ success: true, message: '连接成功' });
      });

      client.on('error', (err) => {
        client.end();
        resolve({ success: false, message: err.message });
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
      };

      if (config.authType === 'password' && config.password) {
        authMethods.password = config.password;
      } else if (config.authType === 'privateKey' && config.privateKey) {
        authMethods.privateKey = Buffer.from(config.privateKey, 'base64').toString('utf-8');
      }

      client.connect(authMethods);
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

        stream.on('close', () => {
          resolve({ success: true, stdout, stderr });
        });
      });
    });
  }

  async uploadFile(hostId: string, localPath: string, remotePath: string): Promise<{ success: boolean; message: string }> {
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

        const readStream = require('fs').createReadStream(localPath);
        const writeStream = sftp.createWriteStream(remotePath);

        writeStream.on('close', () => {
          sftp.end();
          resolve({ success: true, message: '上传成功' });
        });

        writeStream.on('error', (err: any) => {
          sftp.end();
          resolve({ success: false, message: err.message });
        });

        readStream.pipe(writeStream);
      });
    });
  }

  async downloadFile(hostId: string, remotePath: string, localPath: string): Promise<{ success: boolean; message: string }> {
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

        const readStream = sftp.createReadStream(remotePath);
        const writeStream = require('fs').createWriteStream(localPath);

        writeStream.on('close', () => {
          sftp.end();
          resolve({ success: true, message: '下载成功' });
        });

        writeStream.on('error', (err: any) => {
          sftp.end();
          resolve({ success: false, message: err.message });
        });

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
