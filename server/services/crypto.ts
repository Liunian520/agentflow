import crypto from 'crypto';

// 进程内只保留一把 AES 密钥。index.ts 与 llmProxy 必须共用，
// 否则前端用 /api/crypto/key 加密的数据无法在 LLM 路由里解开。
const AES_KEY_ENV = process.env.AES_ENCRYPTION_KEY;
let currentAesKey = '';
let aesKeyGeneratedAt = 0;
const AES_KEY_ROTATION_MS = 24 * 60 * 60 * 1000;

export function getOrCreateAesKey(): string {
  if (AES_KEY_ENV) return AES_KEY_ENV;
  const now = Date.now();
  if (!currentAesKey || now - aesKeyGeneratedAt > AES_KEY_ROTATION_MS) {
    currentAesKey = crypto.randomBytes(32).toString('hex');
    aesKeyGeneratedAt = now;
  }
  return currentAesKey;
}

export function aesKeyExpiresIn(): number {
  return AES_KEY_ENV ? 365 * 24 * 60 * 60 * 1000 : AES_KEY_ROTATION_MS;
}

export function decryptAesGcm(encrypted: string, keyHex: string): string {
  const [ivHex, ctHex] = encrypted.split(':');
  if (!ivHex || !ctHex) throw new Error('加密数据格式错误');

  const keyBuf = Buffer.from(keyHex, 'hex');
  const ivBuf = Buffer.from(ivHex, 'hex');
  const ctBuf = Buffer.from(ctHex, 'hex');
  if (ctBuf.length <= 16) throw new Error('加密数据格式错误');

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, ivBuf);
  const authTag = ctBuf.slice(ctBuf.length - 16);
  const ciphertext = ctBuf.slice(0, ctBuf.length - 16);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
