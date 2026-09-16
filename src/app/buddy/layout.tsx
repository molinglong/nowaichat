import '@/app/globals.css'
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
