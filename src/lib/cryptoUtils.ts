/**
 * AES-GCM 加密工具 — 用于私钥安全存储和传输
 * 使用 Web Crypto API，密钥由后端 /api/crypto/key 获取
 */

const CRYPTO_KEY_STORAGE = 'agentflow_crypto_key';
const CRYPTO_KEY_EXPIRY = 'agentflow_crypto_key_expiry';

/** 从后端获取 AES 加密密钥（缓存 24h） */
export async function getEncryptionKey(): Promise<string> {
  // 检查缓存
  const cachedKey = localStorage.getItem(CRYPTO_KEY_STORAGE);
  const cachedExpiry = localStorage.getItem(CRYPTO_KEY_EXPIRY);
  if (cachedKey && cachedExpiry && Date.now() < Number(cachedExpiry)) {
    return cachedKey;
  }

  // 从后端获取
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';
  const response = await fetch(`${API_BASE}/crypto/key`);
  if (!response.ok) throw new Error('获取加密密钥失败');
  const { key, expiresIn } = await response.json();

  // 缓存
  localStorage.setItem(CRYPTO_KEY_STORAGE, key);
  localStorage.setItem(CRYPTO_KEY_EXPIRY, String(Date.now() + (expiresIn || 86400000)));
  return key;
}

/** 将 hex 字符串转为 Uint8Array */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/** AES-GCM 加密 */
export async function encryptAES(plaintext: string, keyHex: string): Promise<string> {
  const keyBytes = hexToBytes(keyHex);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12)); // GCM 推荐 12 bytes IV
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    encoded.buffer as ArrayBuffer,
  );

  // 输出格式: iv_hex:ciphertext_hex
  const ivHex = Array.from(iv).map((b) => b.toString(16).padStart(2, '0')).join('');
  const ctHex = Array.from(new Uint8Array(ciphertext)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${ivHex}:${ctHex}`;
}

/** AES-GCM 解密 */
export async function decryptAES(encrypted: string, keyHex: string): Promise<string> {
  const [ivHex, ctHex] = encrypted.split(':');
  if (!ivHex || !ctHex) throw new Error('加密数据格式错误');

  const keyBytes = hexToBytes(keyHex);
  const iv = hexToBytes(ivHex);
  const ct = hexToBytes(ctHex);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    ct.buffer as ArrayBuffer,
  );

  return new TextDecoder().decode(decrypted);
}

/** 检查当前是否使用 HTTPS */
export function isSecureConnection(): boolean {
  return window.location.protocol === 'https:';
}

/** 生成安全警告消息 */
export function getSecurityWarning(): string | null {
  if (!isSecureConnection() && window.location.hostname !== 'localhost') {
    return '当前使用 HTTP 连接，私钥传输不安全！强烈建议启用 HTTPS（Render 默认支持 HTTPS）。';
  }
  return null;
}
