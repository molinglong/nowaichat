'use client'

import { Menu, ArrowLeft, Settings as SettingsIcon } from 'lucide-react'
import { useRouter, usePathname } from 'next/navigation'
import { useChatStore } from '@/store/chat-store'
import { cn } from '@/lib/utils'

/**
 * 方案 C 手机端悬浮圆钮(≤md):深色半透明玻璃圆钮悬浮在壁纸上,
 * 取代原移动端顶栏带(汉堡/标题/设置)与 BottomDock 的导航职责。
 *
 * - 欢迎页/功能页:左 = ☰ 抽屉,右 = ⚙ 设置
 * - 会话页(/chat/c/*):左 = ← 返回欢迎页,左二 = ☰ 抽屉,右 = ⚙ 设置
 * - 设计稿参数:40px 圆、rgb(28 28 30/.36) 底 + blur(14px)、白 1px 半透明描边;
 *   亮壁纸上看不清的白玻璃已按原型定稿改深色半透明
 * - z-30:压过页面内容与 TopFade(z-10),低于全屏抽屉(z-50)与设置弹窗(z-100)
 */
export function MobileFloatButtons() {
  const router = useRouter()
  const pathname = usePathname()
  const toggleSidebar = useChatStore((s) => s.toggleSidebar)
  const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)

  const isConversation = !!pathname?.startsWith('/chat/c/')

  const btnBase =
    'flex items-center justify-center w-10 h-10 rounded-full border border-white/35 ' +
    'text-white shadow-[0_2px_12px_rgb(0_0_0_/_0.18)] transition-transform duration-150 ' +
    'active:scale-90 touch-manipulation'
  const btnStyle: React.CSSProperties = {
    background: 'rgb(28 28 30 / 0.36)',
    WebkitBackdropFilter: 'blur(14px)',
    backdropFilter: 'blur(14px)',
    WebkitTapHighlightColor: 'transparent',
  }

  return (
    // fixed(不是 absolute):基线要按视口顶算,才能与抽屉头部(fixed inset-0)落在同一条线,
    // 不吃 app-frame 的 pt-[var(--sat)] 与 shell 1px 边框,免得安全区被算两遍。
    <div
      className="md:hidden pointer-events-none fixed inset-x-0 z-30"
      style={{ top: 'var(--m-chrome-top)' }}
    >
      <div className="relative h-10">
        {/* 左一:会话页=返回欢迎页,其余页=开抽屉 */}
        <button
          onClick={() => (isConversation ? router.push('/chat') : toggleSidebar())}
          className={cn(btnBase, 'pointer-events-auto absolute left-[var(--m-chrome-inset)] top-0')}
          aria-label={isConversation ? '返回' : '打开侧边栏'}
          style={btnStyle}
        >
          {isConversation ? <ArrowLeft className="w-[18px] h-[18px]" /> : <Menu className="w-[18px] h-[18px]" />}
        </button>
        {/* 左二:仅会话页出现(开抽屉),与左一同间距 */}
        {isConversation && (
          <button
            onClick={toggleSidebar}
            className={cn(btnBase, 'pointer-events-auto absolute left-[calc(var(--m-chrome-inset)_+_40px_+_var(--m-chrome-gap))] top-0')}
            aria-label="打开侧边栏"
            style={btnStyle}
          >
            <Menu className="w-[18px] h-[18px]" />
          </button>
        )}
        {/* 右:设置 */}
        <button
          onClick={() => setSettingsOpen(true)}
          className={cn(btnBase, 'pointer-events-auto absolute right-[var(--m-chrome-inset)] top-0')}
          aria-label="设置"
          style={btnStyle}
        >
          <SettingsIcon className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  )
}
