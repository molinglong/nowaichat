'use client'

/**
 * /study 导师对话流(学习模式主线,2026-10-04 方案A落地)。
 *
 * 顶栏状态 chip(今日到期/薄弱考点/错题本抽屉)+ 全宽导师会话流。
 * ChatPanel 以 studyMode 上报服务端:强制挂载课本检索/题库练题工具,
 * 注入答案守卫+苏格拉底引导能力段与「当前学情」回灌(错题参与开场)。
 * 错题本与复习翻转卡降级为右侧抽屉——后台自动沉淀的备查视图,
 * 日常复习由导师在对话内主动带出(AI 拉人,不要求用户管理)。
 */

import { useState, Suspense } from 'react'
import { X } from 'lucide-react'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { NoteList } from '@/components/study/NoteList'
import { ReviewCard } from '@/components/study/ReviewCard'
import { AuthErrorBoundary } from '@/components/AuthErrorBoundary'
import { ClientOnly } from '@/components/ClientOnly'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { useChatStore } from '@/store/chat-store'
import { providersModelsQuery } from '@/lib/query/providers'
import { fetchJson } from '@/lib/query/fetcher'
import { cn } from '@/lib/utils'

const CHIP =
  'px-2.5 py-1 rounded-full text-xs bg-surface-subtle/60 border border-line/60 text-content-secondary'

function StudyContent() {
  const { status } = useSession()
  // 与 /chat 同源的"开新课"信号:侧栏「新对话」bump 后本页面也重挂载回空白会话
  const newChatNonce = useChatStore((s) => s.newChatNonce)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<'review' | 'notes'>('notes')

  const { data: allModels } = useSuspenseQuery(providersModelsQuery)
  // 首跑默认模型优先公共池门面档,与 /chat 同规则(见 chat/page.tsx 注释)
  const defaultModel =
    allModels.find((m) => m.publicPool)?.id || allModels[0]?.id || 'gpt-5.4-mini'

  // 状态条计数:与 /api/study/queue、服务端学情回灌同口径(到期含新卡;薄弱=lapses>=1 或掌握度<0.3)
  const { data: queue } = useQuery({
    queryKey: ['study', 'queue'],
    queryFn: () => fetchJson<Array<{ id: string }>>('/api/study/queue'),
    staleTime: 30_000,
  })
  const { data: notes } = useQuery({
    queryKey: ['study', 'notes-count'],
    queryFn: () => fetchJson<Array<{ id: string; lapses: number; mastery: number }>>('/api/study/notes'),
    staleTime: 30_000,
  })
  const dueCount = queue?.length ?? 0
  const weakCount = notes?.filter((n) => n.lapses >= 1 || n.mastery < 0.3).length ?? 0

  if (status === 'loading') return null

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶栏:状态 chip + 错题本抽屉入口 */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-line flex-wrap">
        <span className="text-sm font-medium text-content-primary">学习 · 导师</span>
        <span className="text-xs text-content-muted hidden sm:inline">进入即开课 · 答错自动记入错题本</span>
        <div className="ml-auto flex items-center gap-2">
          <span className={CHIP}>
            今日到期 <b className="text-content-primary">{dueCount}</b>
          </span>
          <span className={CHIP}>
            薄弱考点 <b className="text-content-primary">{weakCount}</b>
          </span>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className={cn(CHIP, 'cursor-pointer hover:text-content-primary hover:bg-surface-subtle transition-colors')}
          >
            错题本(自动)
          </button>
        </div>
      </div>

      {/* 导师会话流(全宽主体) */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <ChatPanel
          key={`study-${newChatNonce}`}
          studyMode
          initialMessages={[]}
          initialModel={defaultModel}
          allModels={allModels}
        />

        {/* 错题本/复习抽屉:后台沉淀的备查视图 */}
        {drawerOpen && (
          <div className="absolute inset-0 z-40">
            <div className="absolute inset-0 bg-black/25" onClick={() => setDrawerOpen(false)} />
            <aside className="absolute right-0 top-0 bottom-0 w-full max-w-[400px] bg-surface border-l border-line shadow-xl flex flex-col">
              <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-line">
                {(
                  [
                    ['review', '今日复习'],
                    ['notes', '错题本'],
                  ] as const
                ).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setDrawerTab(tab)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs transition-colors',
                      drawerTab === tab
                        ? 'bg-surface-subtle text-content-primary font-medium'
                        : 'text-content-muted hover:text-content-primary'
                    )}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="ml-auto p-1.5 rounded-md text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors"
                  aria-label="关闭抽屉"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {drawerTab === 'notes' ? <NoteList /> : <ReviewCard />}
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}

export default function StudyPage() {
  return (
    <AuthErrorBoundary>
      <Suspense>
        <ClientOnly>
          <StudyContent />
        </ClientOnly>
      </Suspense>
    </AuthErrorBoundary>
  )
}
