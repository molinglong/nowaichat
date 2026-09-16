import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/Providers";
import "./globals.css";
import "katex/dist/katex.min.css";

const pingfang = localFont({
  src: [
    {
      path: "./fonts/pingfangsc-light.woff2",
      weight: "300",
      style: "normal",
    },
    {
      path: "./fonts/pingfangsc-regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/pingfangsc-medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/pingfangsc-semibold.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  variable: "--font-sans",
  display: "swap",
});
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
        className={`${pingfang.variable} ${geistMono.variable} font-sans antialiased bg-background text-foreground`}
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
