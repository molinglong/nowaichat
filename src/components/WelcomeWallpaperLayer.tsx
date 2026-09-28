'use client'

import { useChatStore } from '@/store/chat-store'

/**
 * Shell 层欢迎页壁纸。挂在 .app-shell 内首位,z-index:-1 ——
 * 铺在 shell 底色之上、侧栏/内容列之下;侧栏与内容列随之变半透明
 * (见 globals.css 的 .app-shell:has(> .welcome-wallpaper) 规则)。
 * 仅当背景模式为「内置壁纸」且当前渲染的是新对话欢迎页时存在
 * (激活信号由 ChatPanel 同步)。「桌面毛玻璃」模式不走这里。
 */
export function WelcomeWallpaperLayer() {
  const mode = useChatStore((s) => s.backdropMode)
  const active = useChatStore((s) => s.chatWelcomeActive)
  if (mode !== 'image' || !active) return null
  return <div className="welcome-wallpaper" aria-hidden="true" />
}
