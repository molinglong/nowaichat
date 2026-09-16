import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { TopBar } from '@/components/TopBar'
import { SettingsModal } from '@/components/SettingsModal'

export default async function ExploreLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  return (
    <div className="h-screen bg-surface-muted p-0 md:p-1.5 overflow-hidden">
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
