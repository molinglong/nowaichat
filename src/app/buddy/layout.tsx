// 勿在此 import globals.css: 同一个 css 模块被 root layout 和这里的 layout 两个入口引用,
// 会触发 Next 14.2 的 css-entry 归属错乱 —— 编译序在后的本文件抢走全局样式 chunk,
// 导致主站 HTML 注入不到 Tailwind 全站裸奔(2026-09 生产事故)。全局样式由 root layout 单点引入。
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '搭子',
  description: '桌面搭子',
}

export default function BuddyLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh">
      <body className="bg-transparent">
        {children}
      </body>
    </html>
  )
}
