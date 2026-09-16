'use client'

import { SessionProvider } from 'next-auth/react'
import type { ReactNode } from 'react'
import { QueryProvider } from '@/lib/query/QueryProvider'
import { ReactErrorLogger } from '@/components/ReactErrorLogger'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      {/* 全局 React 错误捕获:开发模式下打印完整堆栈,定位 Maximum update depth 元凶 */}
      <ReactErrorLogger />
      {/* QueryProvider 内含 React Query 单例 client,跨 layout 跳转保留缓存 */}
      <QueryProvider>{children}</QueryProvider>
    </SessionProvider>
  )
}
