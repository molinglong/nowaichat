import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: 'class',
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // 基础
        background: "rgb(var(--background) / <alpha-value>)",
        foreground: "rgb(var(--foreground) / <alpha-value>)",
        // 面板层级
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          muted: "rgb(var(--surface-muted) / <alpha-value>)",
          subtle: "rgb(var(--surface-subtle) / <alpha-value>)",
          // 毛玻璃：透明度固定烘焙在 0.72，不参与修饰符叠加
          glass: "rgb(var(--surface-glass) / 0.72)",
        },
        // 边框
        line: {
          DEFAULT: "rgb(var(--line) / <alpha-value>)",
          strong: "rgb(var(--line-strong) / <alpha-value>)",
        },
        // 文本层级
        content: {
          primary: "rgb(var(--content-primary) / <alpha-value>)",
          secondary: "rgb(var(--content-secondary) / <alpha-value>)",
          muted: "rgb(var(--content-muted) / <alpha-value>)",
        },
        // 强调色（中灰体系）
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          hover: "rgb(var(--accent-hover) / <alpha-value>)",
          foreground: "rgb(var(--accent-foreground) / <alpha-value>)",
          soft: "rgb(var(--accent-soft) / <alpha-value>)",
        },
        // 危险语义色（弹窗三通道：错误卡描边 / 确认框 danger 主按钮）
        danger: {
          DEFAULT: "rgb(var(--danger) / <alpha-value>)",
          soft: "rgb(var(--danger-soft) / <alpha-value>)",
        },
        // 代码块
        code: {
          header: "rgb(var(--code-header) / <alpha-value>)",
          bg: "rgb(var(--code-bg) / <alpha-value>)",
        },
      },
      transitionTimingFunction: {
        // 浮层进出场统一缓动（与 --ease 同一曲线）
        pop: "cubic-bezier(0.32, 0.72, 0.28, 1)",
      },
      fontFamily: {
        sans: ['var(--font-sans)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        // 发送按钮由禁用变为可用时的轻微弹入
        'pop-in': {
          '0%': { transform: 'scale(0.85)' },
          '60%': { transform: 'scale(1.06)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'pop-in': 'pop-in 240ms ease-out',
      },
    },
  },
  plugins: [],
};
export default config;
