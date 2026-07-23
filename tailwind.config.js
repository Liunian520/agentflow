/** @type {import('tailwindcss').Config} */
export default {
  // 通过在 <html> 上切换 .dark 类实现明暗主题；颜色映射到 CSS 变量，切换类即整站生效
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'bg-primary': 'var(--bg-primary)',
        'bg-secondary': 'var(--bg-secondary)',
        'bg-tertiary': 'var(--bg-tertiary)',
        'bg-hover': 'var(--bg-hover)',
        'bg-active': 'var(--bg-active)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',
        'text-inverse': 'var(--text-inverse)',
        'border': 'var(--border)',
        'border-hover': 'var(--border-hover)',
        'border-focus': 'var(--border-focus)',
        'accent': {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          light: 'var(--accent-light)',
          bg: 'var(--accent-bg)',
        },
        'success': 'var(--success)',
        'success-light': 'var(--success-light)',
        'warning': 'var(--warning)',
        'warning-light': 'var(--warning-light)',
        'error': 'var(--error)',
        'error-light': 'var(--error-light)',
        'node-agent': '#8b5cf6',
        'node-tool': '#3b82f6',
        'node-trigger': '#10b981',
        'node-logic': '#f59e0b',
        'node-output': '#ec4899',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'sm': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'md': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        'lg': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
        'xl': '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
      },
    },
  },
  plugins: [],
}
