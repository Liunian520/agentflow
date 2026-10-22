/**
 * SSRF 防护：出站 URL 校验器
 *
 * 后端多处（LLM 代理 baseUrl、A2A agentUrl、MCP url）会以服务器身份向用户提供的 URL 发起请求，
 * 若不校验，攻击者可让服务器访问内网服务或云元数据端点（169.254.169.254）实现 SSRF。
 *
 * 策略：
 *  - 仅允许 http / https 协议
 *  - 拒绝直连私有网段 / 环回 / 链路本地 / 元数据 IP
 *  - 对域名做 DNS 解析，若解析到私有 IP 同样拒绝（防 DNS rebinding / 内网域名）
 *  - 通过环境变量 ALLOW_PRIVATE_URLS=1 可放开（用于本地开发）
 */

import dns from 'dns';
import net from 'net';
import { promisify } from 'util';

const lookup = promisify(dns.lookup);

const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_URLS === '1';

/** 判断一个 IPv4/IPv6 字符串是否属于私有 / 环回 / 链路本地 / 元数据 范围 */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  // IPv4
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;                          // 10.0.0.0/8
    if (p[0] === 127) return true;                         // 127.0.0.0/8 环回
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16.0.0/12
    if (p[0] === 192 && p[1] === 168) return true;         // 192.168.0.0/16
    if (p[0] === 169 && p[1] === 254) return true;         // 169.254.0.0/16 链路本地 + 云元数据
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // 100.64.0.0/10 CGNAT
    if (p[0] === 0) return true;                           // 0.0.0.0/8
    return false;
  }
  // IPv6
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === '::1') return true;                        // 环回
    if (low === '::') return true;
    if (low.startsWith('fe80')) return true;               // 链路本地
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // 唯一本地地址 ULA
    // IPv4-mapped ::ffff:a.b.c.d
    const m = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
    if (m) return isPrivateIp(m[1]);
    return false;
  }
  return true; // 无法识别按不安全处理
}

/**
 * 校验出站 URL 是否安全。安全则返回规范化后的 URL 字符串；否则抛出错误。
 * @param rawUrl 待校验 URL
 * @param label  错误信息前缀（如 "LLM baseUrl" / "A2A agentUrl"）
 */
export async function assertSafeOutboundUrl(rawUrl: string, label = 'URL'): Promise<string> {
  if (ALLOW_PRIVATE) return rawUrl;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`${label} 非法：无法解析 URL`);
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`${label} 非法：仅允许 http/https 协议`);
  }

  const host = u.hostname.replace(/^\[|\]$/g, ''); // 去除 IPv6 方括号

  // 明确拒绝的主机名
  const lowerHost = host.toLowerCase();
  if (
    lowerHost === 'localhost' ||
    lowerHost.endsWith('.localhost') ||
    lowerHost.endsWith('.local') ||
    lowerHost.endsWith('.internal') ||
    lowerHost === 'metadata.google.internal'
  ) {
    throw new Error(`${label} 非法：拒绝访问内网/本地主机 (${host})`);
  }

  // 若本身就是 IP 字面量，直接判断
  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      throw new Error(`${label} 非法：拒绝访问私有/元数据地址 (${host})`);
    }
    return rawUrl;
  }

  // 域名：解析所有 A/AAAA 记录，任一落入私有范围即拒绝
  try {
    const results = await lookup(host, { all: true });
    for (const r of results) {
      if (isPrivateIp(r.address)) {
        throw new Error(`${label} 非法：域名 ${host} 解析到私有地址 ${r.address}`);
      }
    }
  } catch (e: any) {
    if (e?.message?.includes('非法')) throw e;
    throw new Error(`${label} 校验失败：无法解析域名 ${host}`);
  }

  return rawUrl;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * 出站 fetch：禁止自动跟随重定向，每一跳都重新做 SSRF 校验。
 */
export async function safeFetch(url: string, init: RequestInit = {}, label = 'URL'): Promise<globalThis.Response> {
  let current = await assertSafeOutboundUrl(url, label);
  let method = (init.method || 'GET').toUpperCase();
  let body = init.body;

  for (let hop = 0; hop < 5; hop++) {
    const response = await fetch(current, {
      ...init,
      method,
      body,
      redirect: 'manual',
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => undefined);
    if (!location) throw new Error(`${label} 非法：重定向缺少 Location`);

    current = await assertSafeOutboundUrl(new URL(location, current).toString(), label);
    if (response.status === 301 || response.status === 302 || response.status === 303) {
      method = 'GET';
      body = undefined;
    }
  }

  throw new Error(`${label} 非法：重定向次数过多`);
}
