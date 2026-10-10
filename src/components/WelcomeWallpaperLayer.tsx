'use client'

import { useEffect, useState } from 'react'
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
 * 其余 tab(生图/探索/写作/错题本)仍无壁纸。
 * 桌面会话页可读性:壁纸层自身挂 .is-session 做「压暗 + 降饱和 + 模糊」
 * (v3,见 globals.css),欢迎页与手机端不挂该类。
 */
export function WelcomeWallpaperLayer() {
  const mode = useChatStore((s) => s.backdropMode)
  const active = useChatStore((s) => s.chatWelcomeActive)
  const isMobile = useIsMobileViewport()
  const pathname = usePathname()
  /* backdropMode 初值直接读 localStorage —— 服务端读不到,SSR 渲空而客户端渲壁纸,
     首帧必分歧。后果不只是警告:React 会整份替换 document,把 layout 首帧脚本
     写好的 .dark 一并冲掉(实测:刷新后 body 回 rgb(245,245,247) 浅色)。
     故客户端首帧也渲空,挂载后再出壁纸 —— 壁纸是装饰层,晚一帧无感。 */
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || mode !== 'image') return null
  // /chat 全域(含具体会话)都在;桌面端额外收口:非聊天页不渲染
  const isChatRoute = !!pathname?.startsWith('/chat')
  if (!isMobile && !isChatRoute) return null

  // 手机端蒙版分档:/chat 欢迎态 → home;/chat 会话态 → chat;其余(生图/探索/写作/错题本)→ work
  const scrimClass = isChatRoute
    ? active
      ? 'mps-home'
      : 'mps-chat'
    : 'mps-work'

  // 桌面会话态(有消息)才压暗壁纸;欢迎态与手机端保持各自原有观感
  const wallClass = !isMobile && !active ? 'welcome-wallpaper is-session' : 'welcome-wallpaper'

  return (
    <>
      <div className={wallClass} aria-hidden="true" />
      {/* 蒙版层:仅移动端显示(globals.css 内 media query 门控),DOM 顺序保证其垫在内容列之下 */}
      <div className={`mobile-page-scrim ${scrimClass}`} aria-hidden="true" />
    </>
  )
}
