const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';

export interface SSHConnectRequest {
  hostId: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKey?: string;
}

export interface SSHExecuteRequest {
  hostId: string;
  command: string;
}

export interface SSHFileRequest {
  hostId: string;
  localPath: string;
  remotePath: string;
}

export interface SSHResponse {
  success: boolean;
  message?: string;
  stdout?: string;
  stderr?: string;
  status?: 'connected' | 'disconnected' | 'connecting';
  hosts?: string[];
}

export const sshApi = {
  connect: async (data: SSHConnectRequest): Promise<SSHResponse> => {
    const response = await fetch(`${API_BASE}/ssh/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  execute: async (data: SSHExecuteRequest): Promise<SSHResponse> => {
    const response = await fetch(`${API_BASE}/ssh/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  upload: async (data: SSHFileRequest): Promise<SSHResponse> => {
    const response = await fetch(`${API_BASE}/ssh/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  download: async (data: SSHFileRequest): Promise<SSHResponse> => {
    const response = await fetch(`${API_BASE}/ssh/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  disconnect: async (hostId: string): Promise<SSHResponse> => {
    const response = await fetch(`${API_BASE}/ssh/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostId }),
    });
    return response.json();
  },

  getStatus: async (hostId: string): Promise<SSHResponse> => {
    const response = await fetch(`${API_BASE}/ssh/status/${hostId}`);
    return response.json();
  },

  getHosts: async (): Promise<SSHResponse> => {
    const response = await fetch(`${API_BASE}/ssh/hosts`);
    return response.json();
  },
};
