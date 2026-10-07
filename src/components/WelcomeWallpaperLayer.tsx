'use client'

import { usePathname } from 'next/navigation'
import { useChatStore } from '@/store/chat-store'
import { useIsMobileViewport } from '@/hooks/useIsMobileViewport'

/**
 * Shell 层壁纸。挂在 .app-shell 内首位,z-index:-1 ——
 * 铺在 shell 底色之上、侧栏/内容列之下;内容列随之透明
 * (见 globals.css 的 .app-shell:has(> .welcome-wallpaper) 规则)。
 *
 * 方案 C 手机端:壁纸为全局主视觉 —— ≤md 时只要壁纸开关开启就常驻,
 * 不再要求「新对话欢迎页」激活;其上由 .mobile-page-scrim 按路由叠
 * 三档渐变蒙版(欢迎页最透 / 会话页居中 / 功能页最重,保可读性)。
 * 桌面端(≥md):聊天页(欢迎态与会话态同权)常驻,判据走路由不靠 store;
 * 其余 tab(生图/探索/写作/错题本)仍无壁纸。可读性两件套:.welcome-wallpaper
 * 自带的 0.6 基座蒙版 + 会话页那张整列阅读纱(.wp-plate,globals.css 定档)。
 */
export function WelcomeWallpaperLayer() {
  const mode = useChatStore((s) => s.backdropMode)
  const active = useChatStore((s) => s.chatWelcomeActive)
  const isMobile = useIsMobileViewport()
  const pathname = usePathname()

  if (mode !== 'image') return null
  // /chat 全域(含具体会话)都在;桌面端额外收口:非聊天页不渲染
  const isChatRoute = !!pathname?.startsWith('/chat')
  if (!isMobile && !isChatRoute) return null

  // 手机端蒙版分档:/chat 欢迎态 → home;/chat 会话态 → chat;其余(生图/探索/写作/错题本)→ work
  const scrimClass = isChatRoute
    ? active
      ? 'mps-home'
      : 'mps-chat'
    : 'mps-work'

  return (
    <>
      <div className="welcome-wallpaper" aria-hidden="true" />
      {/* 蒙版层:仅移动端显示(globals.css 内 media query 门控),DOM 顺序保证其垫在内容列之下 */}
      <div className={`mobile-page-scrim ${scrimClass}`} aria-hidden="true" />
    </>
  )
}
