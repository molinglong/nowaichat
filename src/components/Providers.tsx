'use client'

import { SessionProvider } from 'next-auth/react'
import { useEffect, type ReactNode } from 'react'
import { QueryProvider } from '@/lib/query/QueryProvider'
import { ReactErrorLogger } from '@/components/ReactErrorLogger'
import { ClientDiagnostics } from '@/components/ClientDiagnostics'
import { startAutoGridToneWatch } from '@/lib/theme'

export function Providers({ children }: { children: ReactNode }) {
  // 智能光态(格子)的常驻看门人: 按本地钟点自动落到日出/白天/暮色/晚上。
  // 挂在这里是因为它是全局客户端根 —— 用户不开设置面板时也要照常跨段切换
  useEffect(() => startAutoGridToneWatch(), [])

  return (
    <SessionProvider>
      {/* 生产常驻取证:崩了往服务器上报证据,手机上 /diagnostics 读 */}
      <ClientDiagnostics />
      {/* 全局 React 错误捕获:开发模式下打印完整堆栈,定位 Maximum update depth 元凶 */}
      <ReactErrorLogger />
      {/* QueryProvider 内含 React Query 单例 client,跨 layout 跳转保留缓存 */}
      <QueryProvider>{children}</QueryProvider>
    </SessionProvider>
  )
}
