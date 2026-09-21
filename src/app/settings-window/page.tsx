'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { SettingsModal } from '@/components/SettingsModal'
import { useIsTauri } from '@/lib/tauri'

/**
 * 设置独立子窗口页面(Tauri 桌面壳专用)。
 *
 * 主窗口任意设置入口 → chat-store 拦截 → 预声明的原生子窗口(visible:false)
 * show 出来加载本页;生产模式下窗口先加载 splash/settings-window 兜底页,
 * 探测到服务器后跳转到远程域名的本路由(与 buddy 悬浮球同构,登录态经共享
 * WebView cookie 直接生效)。
 *
 * Web 直接访问一律跳回聊天页——独立窗口形态仅桌面壳有意义。
 */
export default function SettingsWindowPage() {
  const router = useRouter()
  const inTauri = useIsTauri()

  useEffect(() => {
    if (!inTauri) router.replace('/chat')
  }, [inTauri, router])

  if (!inTauri) return null

  return (
    <div className="h-dvh overflow-hidden bg-surface">
      <SettingsModal
        forceOpen
        onRequestClose={() => {
          void import('@/lib/tauri').then((m) => m.tauri.hideCurrentWindow())
        }}
      />
    </div>
  )
}
