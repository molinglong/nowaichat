'use client'

import { useEffect, useState, type ReactNode } from 'react'

/**
 * 只在浏览器挂载后渲染 children(服务端渲染与 hydration 首帧返回 null)。
 *
 * 为什么需要:useSuspenseQuery 在服务端也会执行 queryFn —— v5 的 useSuspenseQuery
 * 把 enabled 写死成 true(见 @tanstack/react-query/build/modern/useSuspenseQuery.js),
 * 且 useBaseQuery 是在 render 阶段 `throw fetchOptimistic(...)`,不靠 effect。
 * 于是服务端那次自请求带不上浏览器 cookie → middleware 回 401 → fetchJson 抛
 * AuthorizationError('Unauthorized') → 被流进 RSC payload → 浏览器 hydration 时在
 * updateDehydratedSuspenseComponent 里重抛成控制台 Uncaught 错误,React 只能整棵子树
 * 客户端重渲兜回来(每次硬加载白打一个注定失败的请求)。
 *
 * 放在 Suspense 内部用:取数组件不进服务端渲染,软导航时仍是 cache 命中即同步渲染。
 */
export function ClientOnly({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return mounted ? children : null
}
