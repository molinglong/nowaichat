'use client'

import { Menu, ArrowLeft, Settings as SettingsIcon, RotateCw } from 'lucide-react'
import { useRouter, usePathname } from 'next/navigation'
import { useChatStore } from '@/store/chat-store'
import { cn } from '@/lib/utils'

/**
 * 方案 C 手机端悬浮圆钮(≤md):深色半透明玻璃圆钮悬浮在壁纸上,
 * 取代原移动端顶栏带(汉堡/标题/设置)与 BottomDock 的导航职责。
 *
 * - 欢迎页/功能页:左 = ☰ 抽屉,右 = ⚙ 设置
 * - 会话页(/chat/c/*):左 = ← 返回欢迎页,左二 = ☰ 抽屉,右 = ⚙ 设置
 * - 设计稿参数:40px 圆、浅色页 = 白 72% 玻璃 + 墨 8% 描边 + 墨图标(2026-10-07 换色定案),
 *   暗色回落 rgb(28 28 30/.36) + 白图标;
 * - z-30:压过页面内容与 TopFade(z-10),低于全屏抽屉(z-50)与设置弹窗(z-100)
 */
export function MobileFloatButtons() {
  const router = useRouter()
  const pathname = usePathname()
  const toggleSidebar = useChatStore((s) => s.toggleSidebar)
  const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)

  const isConversation = !!pathname?.startsWith('/chat/c/')

  // 2026-10-07 换色定案:浅色页上原「深 36% 玻璃」渲染成脏灰,改白玻璃+墨图标(与输入胶囊同族材质);
  // 暗色页白玻璃刺眼,回落回原深玻璃。只换配色,40px/结构/位置一律未动
  const btnBase =
    'flex items-center justify-center w-10 h-10 rounded-full border ' +
    'border-[rgba(29,29,31,0.08)] bg-[rgba(255,255,255,0.72)] text-content-primary ' +
    'shadow-[0_2px_12px_rgb(0_0_0_/_0.10)] ' +
    'dark:border-white/35 dark:bg-[rgb(28_28_30_/_0.36)] dark:text-white ' +
    'transition-transform duration-150 ' +
    'active:scale-90 touch-manipulation'
  const btnStyle: React.CSSProperties = {
    WebkitBackdropFilter: 'blur(14px)',
    backdropFilter: 'blur(14px)',
    WebkitTapHighlightColor: 'transparent',
  }

  return (
    // fixed(不是 absolute):基线要按视口顶算,才能与抽屉头部(fixed inset-0)落在同一条线,
    // 不吃 main 的 max-md:pt-[var(--sat)] 与 shell 1px 边框,免得安全区被算两遍。
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
        {/* 右二:刷新(整页重载,壳内即重新拉远程站) */}
        <button
          onClick={() => window.location.reload()}
          className={cn(
            btnBase,
            'pointer-events-auto absolute right-[calc(var(--m-chrome-inset)_+_40px_+_var(--m-chrome-gap))] top-0'
          )}
          aria-label="刷新页面"
          style={btnStyle}
        >
          <RotateCw className="w-[18px] h-[18px]" />
        </button>
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
