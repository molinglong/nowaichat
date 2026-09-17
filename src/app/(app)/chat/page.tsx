'use client'

/**
 * /chat 新对话页 —— 客户端渲染 + Suspense。
 *
 * 改造:
 *   - useQuery → useSuspenseQuery:组件在数据未到位时抛 promise,
 *     Next.js App Router 的 Router Suspense 自动用 loading.tsx 作 fallback。
 *     切到 /chat 时,如果数据已经从别的路由 prefetch 进 cache,这里同步命中,
 *     体感"瞬间出现";cache miss 才显示骨架。
 *   - TopBar 在 hover/click 时已经预热了 queryKeys.providers(),
 *     所以首次进入通常就是 cache hit。
 *
 * SSR 鉴权仍然由 chat/layout.tsx (server) 在 layout 阶段处理。
 */

import { ChatPanel } from '@/components/chat/ChatPanel'
import { Suspense } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { useChatStore } from '@/store/chat-store'
import { queryKeys, STALE } from '@/lib/query/keys'
import { fetchJson } from '@/lib/query/fetcher'
import type { ModelDefinition } from '@/lib/ai/types'

function NewChatContent() {
  const { status } = useSession()

  // 新对话重置信号: Sidebar/TopBar 的「新对话」动作会 bump 它。
  // 新对话发出首条消息后 ChatPanel 用 history.replaceState 改写 URL,
  // 此后 React 可能复用同一棵 page 子树(或 push 同路径直接 no-op),
  // 不重挂载 ChatPanel 就会残留上一个会话的消息 —— key 里带上 nonce
  // 保证每次「开新对话」都强制卸载重建,回到空白状态。
  const newChatNonce = useChatStore((s) => s.newChatNonce)

  const { data: allModels } = useSuspenseQuery<ModelDefinition[]>({
    queryKey: queryKeys.providers(),
    queryFn: async () => {
      const payload = await fetchJson<
        | Array<{ id?: string; effectiveModels: Array<Omit<ModelDefinition, 'provider'> & { provider?: string }> }>
        | { providers: Array<{ id?: string; effectiveModels: Array<Omit<ModelDefinition, 'provider'>> }> }
      >('/api/providers')
      const list = Array.isArray(payload) ? payload : payload.providers ?? []
      return list.flatMap(
        (p) => p.effectiveModels.map(
          (m): ModelDefinition => ({
            id: m.id,
            name: m.name,
            provider: p.id ?? (m as { provider?: string }).provider ?? '',
            contextWindow: m.contextWindow,
            supportsVision: m.supportsVision,
            supportsFiles: m.supportsFiles,
            supportsReasoning: m.supportsReasoning,
          })
        )
      )
    },
    staleTime: STALE.providers,
  })

  const defaultModel = allModels[0]?.id || 'gpt-4o'

  return (
    <ChatPanel
      key={`new-chat-${newChatNonce}`}
      initialMessages={[]}
      initialModel={defaultModel}
      allModels={allModels}
    />
  )
}

export default function NewChatPage() {
  return (
    // 用一个空 fallback 包本组件本身——让 React Suspense 监视内部的 useSuspenseQuery。
    // Next.js Router Suspense 会用同目录的 loading.tsx 作为"路由级"fallback,
    // 这里只是在 Suspense boundary 内做最后兜底(例如 cache 完全为空)
    <Suspense>
      <NewChatContent />
    </Suspense>
  )
}
