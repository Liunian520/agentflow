/**
 * 密码哈希工具 — 使用 Web Crypto API (SHA-256)
 * 不存储明文密码，仅存储哈希值用于验证
 */

const SALT_PREFIX = 'lnagent_';

/** 对密码进行 SHA-256 哈希（加盐） */
export async function hashPassword(password: string): Promise<string> {
  const salted = SALT_PREFIX + password;
  const encoder = new TextEncoder();
  const data = encoder.encode(salted);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 验证密码是否匹配哈希 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const hash = await hashPassword(password);
  return hash === storedHash;
}
