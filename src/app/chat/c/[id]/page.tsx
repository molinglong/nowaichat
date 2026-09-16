'use client'

import { useEffect, useMemo, Suspense } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { useChatStore } from '@/store/chat-store'
import { getErrorMessage } from '@/lib/chat-errors'
import { queryKeys, STALE } from '@/lib/query/keys'
import { fetchJson, AuthorizationError, NotFoundError, type FetchJsonOptions } from '@/lib/query/fetcher'
import type { Attachment } from '@/lib/attachment-types'
import type { ModelDefinition } from '@/lib/ai/types'

// ── Types ────────────────────────────────────────────────────────
interface ApiMessage {
  id: string
  role: string
  content: string
  reasoning?: string | null
  model?: string | null
  groupId?: string | null
  attachments: unknown[]
  /** 后端写入的结构化 UI 提示: { kind: 'branch_summary', sourceId, sourceTitle, ... } */
  metadata?: unknown
  promptTokens?: number | null
  completionTokens?: number | null
  createdAt?: string | Date
}

function parseMessageMetadata(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

interface ApiConversation {
  id: string
  title: string
  model: string
  mode: 'single' | 'compare'
  styleOffset: number
  stylePreset: string | null
  maskId: string | null
  compareModels: string[]
  messages: ApiMessage[]
}

interface ApiProviderModel {
  id: string
  name: string
  contextWindow: number
  supportsVision: boolean
  supportsFiles: boolean
  supportsReasoning: boolean
}

interface ApiProvider {
  id: string
  name: string
  effectiveModels: ApiProviderModel[]
}

// ── QueryFn ──────────────────────────────────────────────────────
async function fetchConversation(id: string, opts?: FetchJsonOptions): Promise<ApiConversation> {
  return fetchJson<ApiConversation>(`/api/conversations/${id}`, opts)
}

async function fetchProviders(): Promise<ModelDefinition[]> {
  const payload = await fetchJson<ApiProvider[] | { providers: ApiProvider[] }>('/api/providers')
  const list = Array.isArray(payload)
    ? payload
    : payload.providers ?? []
  return list.flatMap((p) =>
    p.effectiveModels.map(
      (m): ModelDefinition => ({
        id: m.id,
        name: m.name,
        provider: p.id,
        contextWindow: m.contextWindow,
        supportsVision: m.supportsVision,
        supportsFiles: m.supportsFiles,
        supportsReasoning: m.supportsReasoning,
      })
    )
  )
}

// ── UIMessage adapter ────────────────────────────────────────────
function toUIMessage(msg: ApiMessage): UIMessage {
  const parts: UIMessage['parts'] = []
  if (msg.reasoning) {
    parts.push({ type: 'reasoning' as const, text: msg.reasoning, state: 'done' as const })
  }
  parts.push({ type: 'text' as const, text: msg.content, state: 'done' as const })

  const attachments =
    Array.isArray(msg.attachments) && msg.attachments.length > 0
      ? (msg.attachments as Attachment[]).filter(
          (a): a is Attachment =>
            !!a &&
            typeof (a as Attachment).url === 'string' &&
            typeof (a as Attachment).name === 'string'
        )
      : undefined

  return {
    id: msg.id,
    role: msg.role as 'user' | 'assistant' | 'system',
    parts,
    createdAt: msg.createdAt ? new Date(msg.createdAt) : undefined,
    ...(attachments ? { attachments } : {}),
    ...(parseMessageMetadata(msg.metadata) ? { metadata: parseMessageMetadata(msg.metadata)! } : {}),
    ...(msg.promptTokens != null || msg.completionTokens != null
      ? { tokens: { prompt: msg.promptTokens ?? 0, completion: msg.completionTokens ?? 0 } }
      : {}),
  } as UIMessage
}

// ── Page ────────────────────────────────────────────────────────
export default function ConversationClientPage() {
  // providers 由 TopBar 在 hover/click 时预热,这里改用 useSuspenseQuery:
  //   - cache hit → 直接读 cache,同步渲染,无空白帧
  //   - cache miss → 抛 promise → Next.js Router Suspense 兜底到 loading.tsx
  const providersContent = (
    <ConversationClientContent />
  )
  return (
    <Suspense>
      {providersContent}
    </Suspense>
  )
}

function ConversationClientContent() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const router = useRouter()
  const { status } = useSession()
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId)
  const setConversationTitle = useChatStore((s) => s.setConversationTitle)
  const setConversationStylePreset = useChatStore((s) => s.setConversationStylePreset)

  // 会话详情 — 仍用 useQuery,因为要处理 401/404 触发 redirect 副作用
  // (Suspense 抛错只会被 ErrorBoundary 接住,不能 redirect)
  const conversationQuery = useQuery({
    queryKey: queryKeys.conversations.detail(id ?? ''),
    queryFn: ({ signal }) => fetchConversation(id!, { signal }),
    enabled: status === 'authenticated' && !!id,
    staleTime: STALE.conversation,
    gcTime: 30 * 60 * 1000,
  })

  // 模型列表 — Suspense 版本,切会话瞬间从 cache 命中,无网络等待。
  // TopBar 在 hover / 点击其他 tab 时已经把这一项预热。
  const { data: allModels } = useSuspenseQuery<ModelDefinition[]>({
    queryKey: queryKeys.providers(),
    queryFn: () => fetchProviders(),
    staleTime: STALE.providers,
  })

  // 鉴权:未登录跳 /login
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login')
    }
  }, [status, router])

  // 错误转化为导航或提示。
  useEffect(() => {
    const err = conversationQuery.error
    if (!err) return
    if (err instanceof AuthorizationError) {
      router.replace('/login')
      return
    }
    if (err instanceof NotFoundError) {
      // 会话不存在 / 无权限 → 回列表
      router.replace('/chat')
    }
  }, [conversationQuery.error, router])

  const conversation = conversationQuery.data

  // 鉴权:未登录跳 /login

  // 把当前会话元数据同步到 chat-store,让 TopBar 标题、Sidebar 高亮等保持一致
  useEffect(() => {
    if (!conversation) return
    setCurrentConversationId(conversation.id)
    setConversationTitle(conversation.title)
    if (conversation.stylePreset) {
      setConversationStylePreset(conversation.stylePreset)
    } else {
      const o = conversation.styleOffset ?? 50
      if (o <= 20) setConversationStylePreset('scholar')
      else if (o <= 45) setConversationStylePreset('practical')
      else if (o <= 65) setConversationStylePreset('balanced')
      else if (o <= 85) setConversationStylePreset('editor')
      else setConversationStylePreset('mentor')
    }
  }, [conversation, setCurrentConversationId, setConversationTitle, setConversationStylePreset])

  // 派生: 单聊/对比模式的消息分发
  const initialState = useMemo(() => {
    if (!conversation) {
      return {
        initialMessages: [] as UIMessage[],
        laneInitialMessages: undefined as UIMessage[][] | undefined,
      }
    }
    const mode = conversation.mode ?? 'single'
    const uiMessages = conversation.messages.map(toUIMessage)
    const visibleMessages =
      mode === 'compare'
        ? uiMessages
        : uiMessages.filter((_, i) => {
            const m = conversation.messages[i]
            return m.role === 'user' || m.groupId == null || m.model === conversation.model
          })

    if (mode === 'compare' && conversation.compareModels.length >= 2) {
      const lanes = conversation.compareModels.map((modelId) =>
        conversation.messages
          .filter((m) => m.role === 'user' || m.model === modelId)
          .map(toUIMessage)
      )
      return { initialMessages: visibleMessages, laneInitialMessages: lanes }
    }
    return { initialMessages: visibleMessages, laneInitialMessages: undefined }
  }, [conversation])

  // ── 渲染分支 ─────────────────────────────────────────────────
  // 1) 鉴权中(query 尚未允许启动) → 保留 loading 骨架
  // 2) 首次无缓存 + 还在请求中(且没报错) → loading 骨架
  // 3) 有缓存 + 后台 refetching → 直接展示旧数据,不显示骨架
  const showSkeleton =
    status === 'loading' ||
    (!conversation && conversationQuery.isPending)

  if (showSkeleton) {
    return (
      <div className="flex h-full items-center justify-center text-content-muted">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-content-muted border-t-transparent" />
          <span>加载会话中…</span>
        </div>
      </div>
    )
  }

  if (conversationQuery.error && !conversation) {
    const info = getErrorMessage(
      conversationQuery.error instanceof Error
        ? conversationQuery.error
        : new Error(String(conversationQuery.error))
    )
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-lg border border-line bg-surface p-6 text-center">
          <p className="mb-2 font-medium text-content-primary">会话加载失败</p>
          <p className="text-sm text-content-secondary">{info.message}</p>
          <button
            type="button"
            onClick={() => router.replace('/chat')}
            className="mt-4 rounded-md bg-accent px-4 py-2 text-sm text-accent-foreground hover:bg-accent-hover"
          >
            返回对话列表
          </button>
        </div>
      </div>
    )
  }

  if (!conversation) {
    return null
  }

  return (
    // key={conversation.id} 让 React 在切换会话时干净地卸载/重建 ChatPanel,
    // 避免 useChat 的 messages 流污染到上一个会话。同时配合 useQuery 缓存,
    // 命中缓存时 page.tsx 同步返回 data,ChatPanel key 切换几乎无感知。
    <ChatPanel
      key={conversation.id}
      conversationId={conversation.id}
      conversationTitle={conversation.title}
      initialMessages={initialState.initialMessages}
      initialModel={conversation.model}
      allModels={allModels}
      mode={conversation.mode}
      compareModels={
        conversation.mode === 'compare' && conversation.compareModels.length >= 2
          ? conversation.compareModels
          : undefined
      }
      laneInitialMessages={initialState.laneInitialMessages}
      initialStylePreset={conversation.stylePreset ?? undefined}
      initialMaskId={conversation.maskId ?? undefined}
    />
  )
}
