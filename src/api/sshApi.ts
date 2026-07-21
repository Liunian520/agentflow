const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';
const DEFAULT_TIMEOUT = 15000; // 15s
const MAX_RETRIES = 2;

export interface SSHConnectRequest {
  hostId: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKey?: string;
  privateKeyEncrypted?: string; // AES-GCM 加密后的私钥
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

/** 统一的 fetch 封装：超时 + 重试 + 错误处理 */
async function safeFetch<T>(
  url: string,
  options: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT,
  retries: number = MAX_RETRIES,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // 将外部 AbortSignal 与超时 AbortSignal 合并
  const mergedSignal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  const finalOptions = { ...options, signal: mergedSignal };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, finalOptions);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 200) || response.statusText}`);
      }

      const data = await response.json();
      clearTimeout(timer);
      return data as T;
    } catch (err: any) {
      lastError = err;
      // 超时或网络错误才重试；4xx 不重试
      if (err.name === 'AbortError' || err.message?.startsWith('HTTP 4')) {
        break; // 不重试
      }
      // 等待递增后重试
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  clearTimeout(timer);

  // 统一错误类型映射
  const msg = lastError?.message || '未知错误';
  if (lastError?.name === 'AbortError') {
    throw new Error(`请求超时 (${timeoutMs / 1000}s)，请检查网络或后端服务是否在线`);
  }
  throw new Error(`请求失败: ${msg}`);
}

/** 创建通用的 POST 请求选项 */
function postOptions(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const sshApi = {
  connect: async (data: SSHConnectRequest): Promise<SSHResponse> => {
    // 如果使用私钥认证，自动加密私钥后再传输
    const payload: any = { ...data };
    if (data.authType === 'privateKey' && data.privateKey) {
      try {
        const { getEncryptionKey, encryptAES } = await import('../lib/cryptoUtils');
        const aesKey = await getEncryptionKey();
        payload.privateKeyEncrypted = await encryptAES(data.privateKey, aesKey);
        // 不再发送明文私钥
        delete payload.privateKey;
      } catch (e) {
        // 加密失败时仍发送明文（降级模式），但打印警告
        console.warn('私钥加密失败，将明文传输（不安全）:', e);
      }
    }
    return safeFetch<SSHResponse>(`${API_BASE}/ssh/connect`, postOptions(payload));
  },

  execute: async (data: SSHExecuteRequest): Promise<SSHResponse> => {
    return safeFetch<SSHResponse>(`${API_BASE}/ssh/execute`, postOptions(data));
  },

  upload: async (data: SSHFileRequest): Promise<SSHResponse> => {
    return safeFetch<SSHResponse>(`${API_BASE}/ssh/upload`, postOptions(data));
  },

  download: async (data: SSHFileRequest): Promise<SSHResponse> => {
    return safeFetch<SSHResponse>(`${API_BASE}/ssh/download`, postOptions(data));
  },

  disconnect: async (hostId: string): Promise<SSHResponse> => {
    return safeFetch<SSHResponse>(`${API_BASE}/ssh/disconnect`, postOptions({ hostId }));
  },

  getStatus: async (hostId: string): Promise<SSHResponse> => {
    return safeFetch<SSHResponse>(`${API_BASE}/ssh/status/${hostId}`, { method: 'GET' });
  },

  getHosts: async (): Promise<SSHResponse> => {
    return safeFetch<SSHResponse>(`${API_BASE}/ssh/hosts`, { method: 'GET' });
  },
};
