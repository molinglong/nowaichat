'use client'

import { Component, useCallback, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { AuthorizationError } from '@/lib/query/fetcher'

/**
 * 会话失效兜底边界。
 *
 * 为什么需要它:useSuspenseQuery 的 queryFn 抛错只能被 ErrorBoundary 接住(不能像
 * useQuery 那样在 useEffect 里判断 401 再 redirect)。若浏览器 hydration 完成后
 * 首个请求才吃到 401(典型:12h 压缩有效期到点、在别处登出),AuthorizationError
 * 会在 updateDehydratedSuspenseComponent 里抛出,而项目里的 error.tsx 全是通用错误页、
 * 不认这个错误 —— 结果是控制台 Uncaught + 页面崩掉,而不是引导重新登录。
 *
 * 用法:包在页面的 Suspense 外层(错误向上传播,边界必须是 Suspense 的祖先)。
 * 只消化 401/403;其余错误在 render 里重抛,继续交给上层 error.tsx。
 */

type InnerProps = { children: ReactNode; onAuthExpired: () => void }
type InnerState = { error: Error | null; authExpired: boolean }

class InnerAuthErrorBoundary extends Component<InnerProps, InnerState> {
  state: InnerState = { error: null, authExpired: false }

  static getDerivedStateFromError(error: unknown): InnerState {
    if (error instanceof AuthorizationError) return { error: null, authExpired: true }
    return { error: error as Error, authExpired: false }
  }

  componentDidCatch(error: Error) {
    if (error instanceof AuthorizationError) this.props.onAuthExpired()
  }

  render() {
    // 非鉴权错误不在本层消化:重抛让祖先的 error.tsx 接管
    if (this.state.error) throw this.state.error
    // 已在跳转 /login,不给用户留半截 UI
    if (this.state.authExpired) return null
    return this.props.children
  }
}

export function AuthErrorBoundary({ children }: { children: ReactNode }) {
  const router = useRouter()
  const onAuthExpired = useCallback(() => router.replace('/login'), [router])

  return (
    <InnerAuthErrorBoundary onAuthExpired={onAuthExpired}>
      {children}
    </InnerAuthErrorBoundary>
  )
}
