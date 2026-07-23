/** 构建版本信息 —— 由 CI 在构建时通过 VITE_BUILD_VERSION 注入，方便确认前端部署版本 */

export const BUILD_VERSION = (import.meta.env.VITE_BUILD_VERSION as string | undefined) || 'dev';

export function shortVersion(version: string, length = 7) {
  if (version === 'dev') return 'dev';
  return version.slice(0, length);
}
