/**
 * 主题应用工具
 * - 'light' / 'dark'：直接在 <html> 上增删 .dark 类
 * - 'system'：跟随系统 prefers-color-scheme，并监听其变化实时切换
 */

export type ThemeMode = 'light' | 'dark' | 'system';

let systemListener: ((e: MediaQueryListEvent) => void) | null = null;
let mediaQuery: MediaQueryList | null = null;

function setDarkClass(isDark: boolean): void {
  const root = document.documentElement;
  if (isDark) root.classList.add('dark');
  else root.classList.remove('dark');
}

/** 应用主题；对 system 模式注册/清理媒体查询监听 */
export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;

  // 先清理旧的 system 监听，避免重复绑定
  if (mediaQuery && systemListener) {
    mediaQuery.removeEventListener('change', systemListener);
    systemListener = null;
  }

  if (theme === 'system') {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setDarkClass(mediaQuery.matches);
    systemListener = (e: MediaQueryListEvent) => setDarkClass(e.matches);
    mediaQuery.addEventListener('change', systemListener);
  } else {
    setDarkClass(theme === 'dark');
  }
}
