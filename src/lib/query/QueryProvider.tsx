'use client'

import { useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { getQueryClient } from './client'

/**
 * 客户端 QueryClientProvider。
 *
 * 使用 useState 缓存 getQueryClient() 而不是 useRef——这样它在并发渲染下行为可预期,
 * 而且 Next.js App Router 的 Server Component 树重建时不会丢失引用。
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => getQueryClient())
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
