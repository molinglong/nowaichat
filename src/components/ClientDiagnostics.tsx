'use client'

import { useEffect } from 'react'
import { installDiagnostics } from '@/lib/client-diagnostics'

/**
 * 全站取证采集器的挂载点(装在 Providers 里)。
 *
 * 只做副作用挂载,不渲染任何东西:生产包的 React #185、未捕获 Promise、
 * 资源加载失败(重新部署后旧 chunk 404 会白屏)都在这里收口并上报落库,
 * 手机上开 /diagnostics 直接读证据,不依赖看不见的控制台。
 *
 * 与 ReactErrorLogger 的分工:那个只在开发模式打完整堆栈,这个是生产常驻。
 */
export function ClientDiagnostics() {
  useEffect(() => {
    installDiagnostics()
  }, [])

  return null
}
