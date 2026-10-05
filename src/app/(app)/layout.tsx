import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { TopBar } from '@/components/TopBar'
import { TopFade } from '@/components/TopFade'
import { SettingsModal } from '@/components/SettingsModal'
import { ContextMenuHost } from '@/components/ui/ContextMenu'
import { ConfirmDialogHost } from '@/components/ui/ConfirmDialog'
import { WelcomeWallpaperLayer } from '@/components/WelcomeWallpaperLayer'
import { MobileFloatButtons } from '@/components/mobile/MobileFloatButtons'
import { MobileDrawer } from '@/components/mobile/MobileDrawer'

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
  // 内容列 relative:承接桌面端浮动工具簇(TopBar ≥md 分支)
  return (
    <div className="app-frame h-screen bg-surface-muted p-0 pt-[var(--sat)] md:p-1.5 overflow-hidden">
      {/* app-shell 加 relative isolate: 为 shell 层壁纸(.welcome-wallpaper, z-index:-1)
          提供定位锚点并收拢层叠上下文,保证壁纸压在 shell 底色上、垫在所有面板下。
          底色用 muted 不用 surface: shell 只在浮动侧栏的四周缝隙露出来,取灰不取白,
          否则纯色模式下侧栏外圈是一圈白板(壁纸模式下这块被壁纸盖住,无此问题) */}
      <div className="app-shell relative isolate h-full flex overflow-hidden rounded-none md:rounded-xl shadow-2xl border border-line bg-surface-muted">
        <WelcomeWallpaperLayer />
        <Sidebar />
        <div className="app-shell-column relative flex flex-col flex-1 min-w-0 bg-surface">
          <TopBar />
          {/* 上沿渐隐:内容滚上去时不再被硬切,而是渐隐着「冲出去」(浮簇本身无底板)。
              仅滚动后显形,静置/短会话不出现,故不吃留白 —— 见 TopFade.tsx */}
          <TopFade />
          {/* 方案 C 手机端(≤md):悬浮圆钮(返回/抽屉/设置)+ 全屏大字导航抽屉。
              BottomDock 已随方案 C 撤下,导航统一走抽屉(组件保留可随时回挂) */}
          <MobileFloatButtons />
          <main className="flex-1 overflow-hidden">
            {children}
          </main>
        </div>
        <MobileDrawer />
      </div>
      <SettingsModal />
      {/* 全局右键菜单宿主(单例):消息气泡 / 代码块 / 会话列表等场景通过 contextMenuStore 弹出 */}
      <ContextMenuHost />
      {/* 通道③ 确认框宿主(单例):confirmDialog() 的 Promise 在此落地,须与 SettingsModal 同级 */}
      <ConfirmDialogHost />
    </div>
  )
}
