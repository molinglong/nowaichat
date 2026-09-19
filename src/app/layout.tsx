import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/Providers";
import "./globals.css";
// katex 样式已并入 globals.css 顶部 @import(见该文件),
// 单独在此 import 会让 root layout 挂两个 css chunk —— 触发 Next 14.2 的
// css-entry 关联 bug: 后一个 chunk 挤掉 globals.css, HTML 拿不到 Tailwind 全站裸奔。

// 苹方不再走 next/font(全量 woff2 会被 preload ~18MB):
// 改用 globals.css 顶部的 cn-font-split 子集分片 + :root --font-sans 系统栈,
// macOS/iOS 命中系统原生苹方零下载, 其他平台按需拉分片。
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "八号产房 - AI 多模型对话助手",
  description: "支持 OpenAI、Anthropic、DeepSeek、通义千问、文心一言的多模型 AI 对话平台",
  // iOS 添加到主屏幕后,以 standalone 模式运行,顶部状态栏样式(translucent 需要配合 viewport-fit=cover)
  appleWebApp: {
    capable: true,
    title: "八号产房",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

/**
 * 移动端 viewport 配置。
 * - viewportFit: 'cover' 是解锁 env(safe-area-inset-*) 的前提
 * - maximumScale: 5 保留用户缩放能力(无障碍要求)
 * - themeColor 分浅/深色,匹配系统浏览器顶部栏
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0d" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 苹方子集分片: public 静态直出, unicode-range 按需拉 woff2。
            不走 CSS @import/webpack(1500+ font-face 会拖垮 dev server);
            macOS/iOS 命中系统苹方时浏览器不会下载分片, 零开销 */}
        {['100', '300', '400', '500', '600'].map((w) => (
          <link
            key={w}
            rel="stylesheet"
            href={`/fonts-subset/${w}/result.css`}
          />
        ))}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                // 1. 主题同步
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {}

                // 2. Tauri 环境检测 + 手动注入 data-tauri 属性
                //    （Tauri 2 不会自动加这个属性到 <html>，需要我们手动写）
                if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
                  document.documentElement.setAttribute('data-tauri', '');
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${geistMono.variable} font-sans antialiased bg-background text-foreground`}
      >
        <Providers>
          {/* Tauri/Web 双端统一结构:不再渲染自定义标题栏,浏览器/原生窗口各自负责头部控件 */}
          <div className="flex h-screen flex-col overflow-hidden">
            <div className="flex-1 overflow-hidden">{children}</div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
