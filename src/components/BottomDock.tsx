'use client'

import { MessageSquare, Sparkles, Scale, PenLine, BookOpen } from 'lucide-react'
import { useRouter, usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { prefetchTabData, type TabKey } from '@/lib/query/prefetchTab'
import { useStartNewChat } from '@/hooks/useStartNewChat'
import { cn } from '@/lib/utils'

/**
 * 移动端底部 Dock(<768px):页面导航从顶栏中部胶囊下沉至此。
 *
 * 设计要点:
 * - 仅移动端渲染(md:hidden),桌面端仍走 TopBar 中部胶囊,布局零变化
 * - 流内元素((app) layout 主列里 main 的兄弟),非 fixed —— 天然避开层叠上下文坑;
 *   软键盘弹起时被 visual viewport 裁掉,无需处理
 * - 5 项带文字标签,语义零歧义(替代原先移动端 3 个纯图标胶囊 + 极窄屏折叠菜单)
 * - 点击立即高亮(pendingTab 过渡)+ 数据预热(prefetchTabData),与 TopBar 同一套体验
 * - pb 让出 Home Indicator 安全区(浏览器内 --sab 为 0)
 * - 临时聊天模式(访客密码登录)只有聊天页可用,Dock 整体隐藏
 */
type DockKey = TabKey | 'study'

export function BottomDock() {
  const { data: session } = useSession()
  const isEphemeral = session?.ephemeral === true
  const router = useRouter()
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const startNewChat = useStartNewChat()

  // 导航过渡状态:点击立刻设上,导航完成(pathname 更新)清掉 —— 与 TopBar 一致
  const [pendingTab, setPendingTab] = useState<DockKey | null>(null)

  useEffect(() => {
    setPendingTab(null)
  }, [pathname])

  // 「聊天」与 TopBar 语义一致:会话页点击 = 开新对话(useStartNewChat 统一重置流程)
  const handleChat = useCallback(() => {
    if (pathname !== '/chat') setPendingTab('chat')
    startNewChat()
  }, [pathname, startNewChat])

  const handleGo = useCallback(
    (tab: DockKey, path: string, warm?: TabKey) => {
      if (pathname?.startsWith(path)) return
      // 在 router.push 之前预热 — 点按瞬间就开始拉数据(与 TopBar 同策略)
      if (warm) prefetchTabData(queryClient, warm)
      setPendingTab(tab)
      router.push(path)
    },
    [pathname, queryClient, router]
  )

  // 临时聊天模式:仅聊天页可用,无页面可切,Dock 整体隐藏
  if (isEphemeral) return null

  const isImagesPage = pathname?.startsWith('/images')
  const isExplorePage = pathname?.startsWith('/explore')
  const isStudyPage = pathname?.startsWith('/study')
  const isWritePage = pathname?.startsWith('/write')

  const items: Array<{
    key: DockKey
    label: string
    icon: typeof MessageSquare
    active: boolean
    onClick: () => void
  }> = [
    {
      key: 'chat',
      label: '聊天',
      icon: MessageSquare,
      // 聊天兜底:非其他四页即聊天(/chat 新对话页 + /chat/c/[id] 会话页)
      active:
        (!isImagesPage && !isExplorePage && !isStudyPage && !isWritePage) ||
        pendingTab === 'chat',
      onClick: handleChat,
    },
    {
      key: 'images',
      label: '生图',
      icon: Sparkles,
      active: Boolean(isImagesPage) || pendingTab === 'images',
      onClick: () => handleGo('images', '/images', 'images'),
    },
    {
      key: 'explore',
      label: '探索',
      icon: Scale,
      active: Boolean(isExplorePage) || pendingTab === 'explore',
      onClick: () => handleGo('explore', '/explore', 'explore'),
    },
    {
      key: 'write',
      label: '写作',
      icon: PenLine,
      active: Boolean(isWritePage) || pendingTab === 'write',
      onClick: () => handleGo('write', '/write'),
    },
    {
      key: 'study',
      label: '错题本',
      icon: BookOpen,
      active: Boolean(isStudyPage),
      onClick: () => handleGo('study', '/study'),
    },
  ]

  return (
    <nav
      aria-label="页面导航"
      className="md:hidden shrink-0 px-3 pt-1 pb-[max(var(--sab),0.375rem)]"
    >
      <div className="flex items-stretch gap-0.5 p-1 rounded-2xl border border-line/60 bg-surface-glass backdrop-blur-xl shadow-lg">
        {items.map(({ key, label, icon: Icon, active, onClick }) => (
          <button
            key={key}
            onClick={onClick}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-xl transition-all duration-150 active:scale-95 touch-manipulation',
              active
                ? 'bg-accent-soft text-accent'
                : 'text-content-secondary hover:text-content-primary'
            )}
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px] leading-none font-medium">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
