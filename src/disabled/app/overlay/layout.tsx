import '@/app/globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Overlay',
  description: '游戏辅助遮罩',
}

export default function OverlayLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh">
      <body className="bg-transparent overflow-hidden">
        {children}
      </body>
    </html>
  )
}
