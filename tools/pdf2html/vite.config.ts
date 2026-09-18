import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 零后端静态应用:dev/build/preview 三态一致,pdfjs worker 走 ?url 静态资源
export default defineConfig({
  plugins: [react(), tailwindcss()],
  css: {
    // 本项目位于 aichatt 子目录,Vite 会向上搜到父项目的 postcss.config.mjs(Tailwind v3)
    // 造成 @layer 冲突;内联空配置禁用向上查找,强制只用 @tailwindcss/vite v4
    postcss: {},
  },
})
