import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { TopBar } from '@/components/TopBar'
import { SettingsModal } from '@/components/SettingsModal'

/**
 * 四个主 tab(chat/images/explore/study)共享的 shell layout。
 *
 * 此前每个 tab 各持有一份一模一样的独立 layout,导致跨 tab 导航时
 * Next.js 视为"不同 layout 之间的跳转"——整棵 Sidebar/TopBar 子树
 * 被卸载重建:侧边栏逐条淡入动画每次重播、会话/面具/模型等 6+ 个
 * 接口每次重发、auth() 每次重跑,体感"每切一次卡一下"。
 *
 * 放进同一个 route group(route group 不改变 URL)后,tab 间导航
 * 只替换 children,shell 与其中所有客户端状态完整保留。
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  // pt-[var(--sat)]: PWA 全屏模式下顶部让出刘海/灵动岛安全区(浏览器内为 0);md 起恢复统一 6px 内边距
  return (
    <div className="h-screen bg-surface-muted p-0 pt-[var(--sat)] md:p-1.5 overflow-hidden">
      <div className="h-full flex overflow-hidden rounded-none md:rounded-xl shadow-2xl border border-line bg-surface">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0 bg-surface">
          <TopBar />
          <main className="flex-1 overflow-hidden">
            {children}
          </main>
        </div>
      </div>
      <SettingsModal />
    </div>
  )
}
