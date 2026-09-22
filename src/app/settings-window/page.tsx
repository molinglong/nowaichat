'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { SettingsModal } from '@/components/SettingsModal'
import { useIsTauri, getIsTauri } from '@/lib/tauri'

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
    // 不能用 inTauri state 判定:useIsTauri 首帧恒 false(useState 初始值),
    // 此 effect 读到的是首帧快照,在 Tauri 设置窗口里也会误判为 Web 而发起
    // replace('/chat'),且 dev 下预取极快会抢在 setV(true) 重渲染前完成导航
    // → 表现为“点设置后设置页闪一下即变主页”的拉锯循环。改同步读运行时
    // 真值:Tauri WebView 内 __TAURI_INTERNALS__ 恒存在,Web 里恒无。
    if (!getIsTauri()) router.replace('/chat')
  }, [router])

  if (!inTauri) return null

  return (
    // 圆角卡片壳:对齐主窗口 (app)/layout 的窗口形态(6px 透明窗沿 + rounded-xl +
    // 边框 + CSS 大阴影)。窗口本身 transparent + shadow:false——矩形系统阴影会
    // 露怯,与主窗口一致改用 CSS 阴影画在透明区上,随圆角内容起伏。
    <div className="h-dvh overflow-hidden p-1.5">
      <div className="h-full overflow-hidden rounded-xl shadow-2xl border border-line bg-surface">
        <SettingsModal
          forceOpen
          onRequestClose={() => {
            void import('@/lib/tauri').then((m) => m.tauri.hideCurrentWindow())
          }}
        />
      </div>
    </div>
  )
}
