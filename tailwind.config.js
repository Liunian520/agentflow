/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#ffffff',
        'bg-secondary': '#f9fafb',
        'bg-tertiary': '#f3f4f6',
        'bg-hover': '#f3f4f6',
        'bg-active': '#e5e7eb',
        'text-primary': '#111827',
        'text-secondary': '#6b7280',
        'text-tertiary': '#9ca3af',
        'text-inverse': '#ffffff',
        'border': '#e5e7eb',
        'border-hover': '#d1d5db',
        'border-focus': '#8b5cf6',
        'accent': {
          DEFAULT: '#8b5cf6',
          hover: '#7c3aed',
          light: '#ede9fe',
          bg: '#f5f3ff',
        },
        'success': '#10b981',
        'success-light': '#d1fae5',
        'warning': '#f59e0b',
        'warning-light': '#fef3c7',
        'error': '#ef4444',
        'error-light': '#fee2e2',
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
