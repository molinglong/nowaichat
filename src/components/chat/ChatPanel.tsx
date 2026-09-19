'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useChat } from '@ai-sdk/react'
import { useQuery } from '@tanstack/react-query'
import { DefaultChatTransport } from 'ai'
import type { UIMessage } from 'ai'
import { AlertCircle, ChevronDown, RefreshCw, Settings as SettingsIcon, X, Eye, Plus, Minus, Play } from 'lucide-react'
import Link from 'next/link'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { ComparePanel } from './ComparePanel'
import { OutlineSidebar } from './OutlineSidebar'
import { MaskPickerMenu } from './MaskPickerMenu'
import { ContextMeter } from './ContextMeter'
import { useChatStore } from '@/store/chat-store'
import { getErrorMessage } from '@/lib/chat-errors'
import { buildSettingsSnapshot, executeSettingsOps } from '@/lib/settings/executor'
import { toast } from '@/lib/toast'
import { useVisualViewport } from '@/hooks/useVisualViewport'
import { queryKeys, STALE } from '@/lib/query/keys'
import { fetchJson } from '@/lib/query/fetcher'
import type { ModelDefinition } from '@/lib/ai/types'
import { getBuiltinMask } from '@/lib/ai/builtin-masks'
import type { MaskDTO } from '@/lib/ai/mask-types'
import type { Attachment } from './FileUpload'

const MODEL_STORAGE_KEY = 'chat:selectedModel'
const DEEP_THINK_STORAGE_KEY = 'chat:deepThink'
const WEB_SEARCH_STORAGE_KEY = 'chat:webSearch'
const MCP_ENABLED_STORAGE_KEY = 'chat:mcpEnabled'
const COMPARE_MODE_STORAGE_KEY = 'chat:compareMode'
const COMPARE_MODELS_STORAGE_KEY = 'chat:compareModels'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return '夜深了，还在思考？'
  if (hour < 9) return '早上好，新的一天开始了'
  if (hour < 12) return '上午好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  if (hour < 21) return '晚上好'
  return '夜深了，注意休息'
}

/** 欢迎页副标题用日期行: 「9月17日 周四」 */
function getDateLine(): string {
  const now = new Date()
  return `${now.getMonth() + 1}月${now.getDate()}日 周${'日一二三四五六'[now.getDay()]}`
}

interface ChatPanelProps {
  conversationId?: string
  conversationTitle?: string
  initialMessages: UIMessage[]
  initialModel: string
  allModels: ModelDefinition[] // builtin only
  /** 会话模式：single | compare(来自 DB) */
  mode?: string
  /** 对比模式模型列表 (来自 DB) */
  compareModels?: string[]
  /** 对比模式每个泳道的初始消息 */
  laneInitialMessages?: UIMessage[][]
  /** 当前会话已保存的回复风格 preset id,默认 balanced */
  initialStylePreset?: string | null
  /** 当前会话已保存的面具 id(内置面具);null 表示无面具 */
  initialMaskId?: string | null
  /** E 对比模式投票: 最新一轮投票(对比模式回显高亮用) */
  initialCompareVote?: { groupId: string; votedModel: string } | null
  /** 跳转桥: /chat?q= 传入的自动发送文本(bento「继续对话」等外部入口);
   *  mount 后空会话自动发出一次,随后清掉 URL 参数防刷新重发 */
  autoSendText?: string
}

export function ChatPanel({
  conversationId: initialConversationId,
  initialMessages,
  initialModel,
  allModels, // builtin
  conversationTitle,
  mode,
  compareModels: compareModelsProp,
  laneInitialMessages,
  initialStylePreset,
  initialMaskId,
  initialCompareVote,
  autoSendText,
}: ChatPanelProps) {
  const [currentModel, setCurrentModel] = useState(initialModel)
  const [conversationId, setConversationId] = useState(initialConversationId)

  // A 流式恢复: 页面加载时若历史里最后一条 assistant 消息带 streaming 标记,
  // 说明服务端可能仍在生成(草稿行快照中),进入轮询续显模式。
  // 正常流式由 useChat 的流直接驱动,此值保持 null,轮询只在恢复场景激活。
  const [remoteStreamingId, setRemoteStreamingId] = useState<string | null>(() => {
    for (let i = initialMessages.length - 1; i >= 0; i--) {
      const m = initialMessages[i]
      if (m.role === 'assistant') {
        const meta = m.metadata as { streaming?: unknown } | undefined
        return meta?.streaming === true ? m.id : null
      }
    }
    return null
  })
  const conversationStylePreset = useChatStore(state => state.conversationStylePreset)
  const setConversationStylePreset = useChatStore(state => state.setConversationStylePreset)
  const conversationMaskId = useChatStore(state => state.conversationMaskId)
  const setConversationMaskId = useChatStore(state => state.setConversationMaskId)

  // 移动端软键盘:把键盘高度写入 --keyboard-height,让 ChatInput 用
  // padding-bottom: var(--keyboard-height,0px) 顶住键盘。
  useVisualViewport()

  useEffect(() => {
    if (initialConversationId) {
      setConversationStylePreset(initialStylePreset ?? 'balanced')
      return
    }
    const stored = localStorage.getItem('chat:stylePreset')
    setConversationStylePreset(stored || 'balanced')
  }, [initialConversationId, initialStylePreset, setConversationStylePreset])

  // 面具恢复:已有会话用 DB 值;新对话从 localStorage 恢复上次选择
  useEffect(() => {
    if (initialConversationId) {
      setConversationMaskId(initialMaskId ?? null)
      return
    }
    const stored = localStorage.getItem('chat:maskId')
    // 内置裸 id 直接认;user: 前缀的合法性由服务端 getMaskById 兑底
    setConversationMaskId(stored && (getBuiltinMask(stored) || stored.startsWith('user:')) ? stored : null)
  }, [initialConversationId, initialMaskId, setConversationMaskId])

  // 面具选择面板开关
  const [maskPickerOpen, setMaskPickerOpen] = useState(false)
  // 自定义面具列表（badge 解析 + picker「我的面具」分组）
  const { data: userMasks } = useQuery({
    queryKey: queryKeys.masks.list(),
    queryFn: () => fetchJson<MaskDTO[]>('/api/masks'),
    staleTime: STALE.masks,
  })
  const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)
  const setSettingsSection = useChatStore((s) => s.setSettingsSection)
  // 当前生效面具:内置直接查;user: 前缀从自定义列表解析（列表未加载时短暂不显示 badge）
  const activeMask = useMemo(() => {
    const builtin = getBuiltinMask(conversationMaskId)
    if (builtin) return builtin
    if (conversationMaskId?.startsWith('user:')) {
      const um = userMasks?.find((m) => m.id === conversationMaskId)
      if (um) return { id: um.id, name: um.name, avatar: um.avatar, description: um.description }
    }
    return undefined
  }, [conversationMaskId, userMasks])

  // Preview panel state
  const previewCode = useChatStore(state => state.previewCode)
  const setPreviewCode = useChatStore(state => state.setPreviewCode)
  const isPreviewFullscreen = useChatStore(state => state.isPreviewFullscreen)
  const setIsPreviewFullscreen = useChatStore(state => state.setIsPreviewFullscreen)
  
  useEffect(() => {
    if (isPreviewFullscreen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isPreviewFullscreen])
  
  // Auto-enable deepThink for reasoning models (like DeepSeek-R1), but allow user to toggle off
  const shouldAutoEnableDeepThink = initialModel && allModels.find(m => m.id === initialModel)?.supportsReasoning
  const [deepThink, setDeepThink] = useState(shouldAutoEnableDeepThink || false)
  // Track if user manually changed deepThink to prevent auto-re-enabling
  const userToggledDeepThink = useRef(false)
  // Keep stable ref to allModels so we can read it inside effects without causing re-runs.
  // Must be done in useEffect, NOT in the component body — assigning .current during render
  // causes React to see different hook inputs on each render, triggering the
  // "Cannot update a component while rendering" / "areHookInputsEqual" cascade.
  const allModelsRef = useRef(allModels)
  useEffect(() => {
    allModelsRef.current = allModels
  }, [allModels])

  // 联网搜索：默认关闭，仅在用户在 ChatInput 中主动开启时才把 web_search 工具挂到模型。
  // webSearchAvailable 由下文的 searchKeysQuery 派生。
  const [webSearch, setWebSearch] = useState(false)
  // 当前联网搜索引擎（来自共享 store）
  const searchEngine = useChatStore((s) => s.searchEngine)

  // 联网搜索可用性:由 /api/search/keys 返回的 key 数量决定。
  // 用 useQuery 接管,与全站 queryKeys 体系对齐。
  const searchKeysQuery = useQuery<Array<{ engine: string }>>({
    queryKey: queryKeys.search.keys(),
    queryFn: () =>
      fetchJson<Array<{ engine: string }>>('/api/search/keys', {
        // 401 时返回空数组而不是抛错——聊天页允许用户无 key 也能进入
        swallowNotFound: true,
      }).then((data) => (Array.isArray(data) ? data : [])),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: STALE.providers,
  })
  const webSearchAvailable = (searchKeysQuery.data?.length ?? 0) > 0

  // MCP 外部工具:默认启用(配置即全局生效),仅显式关闭后本会话请求不注入。
  // 可用性由用户名下启用的 MCP server 决定;与设置页共享 query 缓存,
  // 设置里新增/启停后 invalidate 会同步刷新这里的按钮显示。
  const [mcpEnabled, setMcpEnabled] = useState(true)
  const mcpServersQuery = useQuery<{ servers: Array<{ enabled: boolean }> }>({
    queryKey: queryKeys.mcp.servers(),
    queryFn: () => fetchJson('/api/mcp/servers'),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: STALE.providers,
  })
  const mcpAvailable = (mcpServersQuery.data?.servers ?? []).some((s) => s.enabled)

  // 从 localStorage 恢复 webSearch 偏好
  useEffect(() => {
    if (!initialConversationId && localStorage.getItem(WEB_SEARCH_STORAGE_KEY) === 'true') {
      setWebSearch(true)
    }
  }, [initialConversationId])

  // 从 localStorage 恢复 MCP 工具偏好(默认启用,仅显式 false 时关闭)
  useEffect(() => {
    if (!initialConversationId && localStorage.getItem(MCP_ENABLED_STORAGE_KEY) === 'false') {
      setMcpEnabled(false)
    }
  }, [initialConversationId])
  
  // Sync deepThink state with model changes - auto-enable for reasoning models (only if user hasn't manually toggled)
  // NOTE: deepThink NOT in dep array — we only want to react to currentModel changes,
  // not to deepThink itself changing (which would cause an infinite loop).
  // allModels is read via ref to avoid the same problem.
  useEffect(() => {
    if (currentModel && !userToggledDeepThink.current) {
      const modelDef = allModelsRef.current.find(m => m.id === currentModel)
      if (modelDef?.supportsReasoning && !deepThink) {
        setDeepThink(true)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentModel])

  // 合并 builtin + custom + provider-user 模型。复用全站 queryKey 的缓存。
  const customModelsQuery = useQuery<ModelDefinition[]>({
    queryKey: queryKeys.customModels(),
    queryFn: () =>
      fetchJson<ModelDefinition[] | { items?: ModelDefinition[] }>(
        '/api/custom-models'
      ).then((data) => (Array.isArray(data) ? data : data?.items ?? [])),
    enabled: !initialConversationId,
    staleTime: STALE.customModels,
  })
  const providerUserModelsQuery = useQuery<ModelDefinition[]>({
    queryKey: [...queryKeys.providers(), 'effective'],
    queryFn: async () => {
      const payload = await fetchJson<
        Array<{ effectiveModels: ModelDefinition[] }> | { providers: Array<{ effectiveModels: ModelDefinition[] }> }
      >('/api/providers')
      const list = Array.isArray(payload) ? payload : payload.providers ?? []
      return list.flatMap((p) => p.effectiveModels ?? [])
    },
    enabled: !initialConversationId,
    staleTime: STALE.providers,
  })

  const mergedModels = useMemo(() => {
    const custom = customModelsQuery.data ?? []
    const providerUser = providerUserModelsQuery.data ?? []
    if (custom.length === 0 && providerUser.length === 0) return allModels
    const seen = new Set<string>()
    const merged: ModelDefinition[] = []
    for (const m of [...allModels, ...custom, ...providerUser]) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      merged.push(m)
    }
    return merged
  }, [allModels, customModelsQuery.data, providerUserModelsQuery.data])

  // 对比模式状态: 仅从 props 初始化(已有 compare 会话),新聊天的 localStorage 预设
  // 在挂载后加载,避免 SSR 水合不一致
  const [compareMode, setCompareMode] = useState(mode === 'compare')

  // 对比模型列表：DB > 默认前两个 (use mergedModels)
  const [compareModels, setCompareModels] = useState<string[]>(() => {
    if (compareModelsProp && compareModelsProp.length >= 2) return compareModelsProp
    const first = mergedModels[0]?.id
    const second = mergedModels.find((m) => m.id !== first)?.id
    return [first, second].filter(Boolean) as string[]
  })

  const handleCompareModeChange = useCallback(
    (enabled: boolean) => {
      setCompareMode(enabled)
      localStorage.setItem(COMPARE_MODE_STORAGE_KEY, String(enabled))
      if (enabled) {
        // 无保存的对比模型时，用当前模型 + 第一个不同模型作为默认
        const saved = localStorage.getItem(COMPARE_MODELS_STORAGE_KEY)
        if (!saved) {
          const second = mergedModels.find((m) => m.id !== currentModel)?.id
          if (second) setCompareModels([currentModel, second])
        }
      }
    },
    [mergedModels, currentModel]
  )

  // 对比模式会话创建后同步回来,用于隐藏切换开关
  const handleCompareConversationCreated = useCallback((convId: string) => {
    setConversationId((prev) => prev ?? convId)
  }, [])

  // On mount, for new chats, load the last selected model and deep think preference from localStorage
  useEffect(() => {
    if (!initialConversationId) {
      const saved = localStorage.getItem(MODEL_STORAGE_KEY)
      if (saved && mergedModels.some((m) => m.id === saved)) {
        setCurrentModel(saved)
      }
      const savedDeepThink = localStorage.getItem(DEEP_THINK_STORAGE_KEY)
      if (savedDeepThink === 'true') {
        setDeepThink(true)
      }
      // 恢复对比模式预设 (移动端不实现对比，跳过)
      if (
        window.matchMedia('(min-width: 768px)').matches &&
        localStorage.getItem(COMPARE_MODE_STORAGE_KEY) === 'true'
      ) {
        setCompareMode(true)
      }
      try {
        const savedCompare = JSON.parse(localStorage.getItem(COMPARE_MODELS_STORAGE_KEY) ?? '[]')
        if (Array.isArray(savedCompare) && savedCompare.length >= 2) {
          const valid = savedCompare.filter((id: unknown) => mergedModels.some((m) => m.id === id))
          if (valid.length >= 2) setCompareModels(valid as string[])
        }
      } catch {
        // 忽略损坏的 localStorage 数据
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const conversationIdRef = useRef(initialConversationId)
  const attachmentsRef = useRef<Attachment[] | undefined>(undefined)
  // 消息区滚动容器(供 OutlineSidebar 做 scroll-spy / 平滑滚动)
  const [messagesScrollEl, setMessagesScrollEl] = useState<HTMLDivElement | null>(null)
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId)
  const setConversationTitle = useChatStore((s) => s.setConversationTitle)
  const bumpConversationVersion = useChatStore((s) => s.bumpConversationVersion)
  const pendingContinuation = useChatStore((s) => s.pendingContinuation)
  const setPendingContinuation = useChatStore((s) => s.setPendingContinuation)
  const markConversationRead = useChatStore((s) => s.markConversationRead)

  // 切换/挂载会话时:
  //  - 通知 store(Sidebar 监听)
  //  - 标记已读 + 3s 后再次标兜底(覆盖流式回复刚完成的情况)
  //  - 卸载时清"接着说"残留
  useEffect(() => {
    setCurrentConversationId(initialConversationId ?? null)
    setConversationTitle(conversationTitle ?? null)
    if (initialConversationId) {
      markConversationRead(initialConversationId)
      const t = setTimeout(() => markConversationRead(initialConversationId), 3000)
      return () => clearTimeout(t)
    }
  }, [initialConversationId, conversationTitle, setCurrentConversationId, setConversationTitle, markConversationRead])

  // 切换会话时清掉"接着说"横幅(避免上一个会话的提示残留)
  useEffect(() => {
    return () => setPendingContinuation(null)
  }, [initialConversationId, setPendingContinuation])

  // 所有 ref 同步必须放在 useEffect 里,不能在 render 体直接写 .current =,
  // 否则 React 18 并发渲染下会触发无限更新循环 (Maximum update depth exceeded)。
  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  // 用 ref 持有最新的可变值,避免 transport body 闭包捕获旧值。
  // 即使 useChat 内部缓存了 transport,body getter 在请求时才读取,
  // 也能拿到最新的 model / deepThink / webSearch 等。
  // useRef() 声明和 .current 赋值严格分开:声明在 render 体,赋值在 useEffect
  const currentModelRef = useRef(currentModel)
  const deepThinkRef = useRef(deepThink)
  const webSearchRef = useRef(webSearch)
  const searchEngineRef = useRef(searchEngine)
  const mcpEnabledRef = useRef(mcpEnabled)
  const conversationStylePresetRef = useRef(conversationStylePreset)
  const conversationMaskIdRef = useRef(conversationMaskId)
  useEffect(() => {
    currentModelRef.current = currentModel
    deepThinkRef.current = deepThink
    webSearchRef.current = webSearch
    searchEngineRef.current = searchEngine
    mcpEnabledRef.current = mcpEnabled
    conversationStylePresetRef.current = conversationStylePreset
    conversationMaskIdRef.current = conversationMaskId
  }, [currentModel, deepThink, webSearch, searchEngine, mcpEnabled, conversationStylePreset, conversationMaskId])

  // Create transport with current model, conversationId, deepThink, and webSearch.
  // 用 useMemo 收敛创建;所有可变值都通过 getter 读 ref,保证请求时拿到最新值。
  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: '/api/chat',
        body: {
          get model() { return currentModelRef.current },
          get conversationId() { return conversationIdRef.current },
          get deepThink() { return deepThinkRef.current },
          get webSearch() { return webSearchRef.current },
          get searchEngine() { return searchEngineRef.current },
          get mcpEnabled() { return mcpEnabledRef.current },
          get stylePreset() { return conversationStylePresetRef.current },
          get maskId() { return conversationMaskIdRef.current },
          // AI 设置控制: 每次请求前读取最新客户端设置快照,服务端注入 system prompt(读写对称)
          get settingsSnapshot() {
            return buildSettingsSnapshot()
          },
          // Attachments are read from ref at send time
          get attachments() {
            return attachmentsRef.current
          },
        },
        // Intercept response to capture conversation ID from header
        fetch: async (url, options) => {
          const response = await fetch(url, options)
          const newConvId = response.headers.get('X-Conversation-Id')
          const newConvTitle = response.headers.get('X-Conversation-Title')
          if (newConvId && newConvId !== conversationIdRef.current) {
            conversationIdRef.current = newConvId
            setConversationId(newConvId)
            setCurrentConversationId(newConvId)
            bumpConversationVersion() // 新会话已入库,通知侧边栏刷新列表
            if (newConvTitle) {
              setConversationTitle(decodeURIComponent(newConvTitle))
            }
            // Update URL without full navigation
            window.history.replaceState(null, '', `/chat/c/${newConvId}`)
          }
          return response
        },
      }),
    // transport 内部所有运行时值都通过 ref 读取最新值,
    // 这里只依赖稳定的 store setter(来自 zustand,引用恒定),避免 transport 被频繁重建
    [setConversationId, setCurrentConversationId, setConversationTitle, bumpConversationVersion]
  )

  // Ref to setMessages,避免在 useChat 初始化器内部自引用导致循环依赖
  const setMessagesRef = useRef<((updater: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])) => void) | null>(null)

  const { messages, sendMessage, setMessages, stop, status, error, clearError, regenerate } = useChat<UIMessage>({
    // 流式 UI 更新节流(AI SDK 官方机制): 不节流时每个 chunk 都触发强制同步重渲染,
    // 快速流式下会累积 React nestedUpdateCount 至 50 抛 "Maximum update depth exceeded",
    // 传 throttle 后通知频率与渲染耗时脱钩,配合打字机视觉平滑度不受影响。
    throttle: 50,
    ...(initialConversationId ? { id: initialConversationId } : {}), // 用会话 ID 作为 useChat 实例 id(仅已有会话),避免不同会话复用同一组件时状态错乱
    transport,
    messages: initialMessages,
    onFinish: async ({ message, isError, isAbort }) => {
      if (isError || isAbort) return
      const convId = conversationIdRef.current
      if (!convId) return
      try {
        // 服务端在 finish 事件之前已完成生图与入库(onFinish 先于 finish part 发送),
        // 这里拉取最新的助手消息,把含图片的最终内容同步到界面。
        const res = await fetch(`/api/conversations/${convId}/messages?limit=1`)
        if (!res.ok) return
        const data = await res.json()
        const latest = data.messages?.[0]
        if (!latest || latest.role !== "assistant" || typeof latest.content !== "string") return
        // 服务端 onFinish 已更新 conversation.updatedAt,通知 Sidebar 刷新列表(更新未读/排序)
        bumpConversationVersion()
        setMessagesRef.current?.((prev: UIMessage[]) =>
          prev.map((m) => {
            if (m.id !== message.id) return m
            // 澄清问答: parts 替换会丢掉本地流式的 tool part,
            // 合并库中 metadata(含 ask_clarification 明细)让卡片经历史回放路径继续渲染
            let latestMeta: unknown = null
            try {
              latestMeta = typeof latest.metadata === 'string' ? JSON.parse(latest.metadata) : latest.metadata
            } catch {
              latestMeta = null
            }
            return {
              ...m,
              ...(latestMeta && typeof latestMeta === 'object' ? { metadata: latestMeta } : {}),
              // 以库中最终数据为准:reasoning 可能被兜底拆分(答案从推理尾部移入正文)
              parts: [
                ...(typeof latest.reasoning === 'string' && latest.reasoning.trim()
                  ? [{ type: 'reasoning' as const, text: latest.reasoning, state: 'done' as const }]
                  : []),
                { type: 'text' as const, text: latest.content, state: 'done' as const },
              ],
            }
          })
        )
      } catch (err) {
        console.error("Failed to sync final message content:", err)
        toast.error('同步最终回复失败', {
          title: '提示',
        })
      }
    },
  })

  // setMessages 引用稳定(来自 useChat),挂到 ref 上供 onFinish 内的最终内容同步使用
  setMessagesRef.current = setMessages

  // A 流式恢复: 远端仍在生成(轮询续显中)也算生成中,输入框保持禁用/停止按钮可见,
  // 新消息按 F 方案入队,待定格后自动发出
  const isLoading = status === 'submitted' || status === 'streaming' || remoteStreamingId != null

  // 生成开始时(stop → send 或 regenerate)清掉"接着说"横幅
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    // 'ready' → 'submitted'/'streaming' 表示新一轮开始,清掉横幅
    if (prev === 'ready' && status !== 'ready' && pendingContinuation) {
      setPendingContinuation(null)
    }
  }, [status, pendingContinuation, setPendingContinuation])

  // 排队发送(F): isLoading 期间用户发送的消息先入队,本轮结束(status 回到 ready)后自动发出。
  // isLoadingRef 供 handleSend 判断当前是否生成中;按项目惯例 ref 声明与赋值分开,赋值在 effect。
  const isLoadingRef = useRef(false)
  useEffect(() => {
    isLoadingRef.current = isLoading
  }, [isLoading])

  // 流式跟随滚动: 默认贴底跟随最新内容;用户向上滚动立即脱离跟随(生成中也能自由回看历史),
  // 滚回底部或点"回到底部"按钮恢复跟随。
  // 脱离判定用滚动方向而非旧的"距底<=24"阈值:旧的纯阈值判定会被 scrollIntoView(smooth)
  // 动画自身的 scroll 事件反复重置回 true,加上流式期间每个 chunk 都发起一次新动画,
  // 用户上滑的每一小步都被拉回,表现为"生成时往上滑不动"。程序化滚动恒向下,不会误触发方向检测。
  const shouldAutoScrollRef = useRef(true)
  const prevScrollTopRef = useRef(0)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  // 滚动容器监听:向上滚=脱离跟随;滚回底部(距底<=40px)=恢复跟随
  useEffect(() => {
    const el = messagesScrollEl
    if (!el) return
    prevScrollTopRef.current = el.scrollTop
    const update = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      const scrolledUp = el.scrollTop < prevScrollTopRef.current - 2
      prevScrollTopRef.current = el.scrollTop
      if (scrolledUp && shouldAutoScrollRef.current) {
        shouldAutoScrollRef.current = false
        setShowScrollToBottom(true)
      } else if (!shouldAutoScrollRef.current && distanceFromBottom <= 40) {
        shouldAutoScrollRef.current = true
        setShowScrollToBottom(false)
      }
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => el.removeEventListener('scroll', update)
  }, [messagesScrollEl])

  // 生成期间贴底跟随:scrollTop 直接赋值(瞬时)而非 smooth 动画,
  // 避免动画与用户滚动形成拉锯;仅在跟随状态下执行
  useEffect(() => {
    if (!isLoading) return
    shouldAutoScrollRef.current = true
    setShowScrollToBottom(false)
    const el = messagesScrollEl
    if (!el) return
    el.scrollTop = el.scrollHeight
    const timer = setInterval(() => {
      if (shouldAutoScrollRef.current) el.scrollTop = el.scrollHeight
    }, 150)
    return () => clearInterval(timer)
  }, [isLoading, messagesScrollEl])

  // 回到底部按钮:恢复跟随并瞬时滚到最新内容
  const handleScrollToBottom = useCallback(() => {
    const el = messagesScrollEl
    if (!el) return
    shouldAutoScrollRef.current = true
    setShowScrollToBottom(false)
    el.scrollTop = el.scrollHeight
  }, [messagesScrollEl])

  const pendingSendQueueRef = useRef<{ text: string; attachments?: Attachment[] }[]>([])
  const [pendingSendQueue, setPendingSendQueue] = useState<{ count: number; preview: string } | null>(null)

  const cancelPendingSendQueue = useCallback(() => {
    pendingSendQueueRef.current = []
    setPendingSendQueue(null)
  }, [])

  // 当前模型的上下文窗口(B): 供 ContextMeter 计算占用百分比
  const currentContextWindow = useMemo(
    () => mergedModels.find((m) => m.id === currentModel)?.contextWindow ?? 0,
    [mergedModels, currentModel]
  )

  // 当前模型的展示名: 欢迎页副标题使用
  const currentModelName = useMemo(
    () => mergedModels.find((m) => m.id === currentModel)?.name,
    [mergedModels, currentModel]
  )

  // 待注入附件: handleSend 先记录,等 sendMessage 把新 user 消息 push 进 messages 后,
  // 由下方 useEffect 把附件挂到最后一条 user 消息上(与 CompareLane 同款时序)。
  // 不能在 sendMessage 前同步 setMessages —— 那时新 user 消息还不存在,
  // 附件会挂到上一条消息上(或无消息可挂),当轮气泡永远看不到附件卡片。
  const pendingAttachmentsRef = useRef<Attachment[] | undefined>(undefined)

  // 消费后置空:挂载后 atts 为 undefined 会早退,不会因依赖 messages 而死循环。
  useEffect(() => {
    const atts = pendingAttachmentsRef.current
    if (!atts || atts.length === 0) return
    setMessages((prev) => {
      const next = [...prev]
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'user') {
          next[i] = { ...next[i], attachments: atts } as UIMessage
          break
        }
      }
      return next
    })
    pendingAttachmentsRef.current = undefined
  }, [messages, setMessages])

  const handleSend = useCallback(
    (text: string, attachments?: Attachment[]) => {
      // 生成中不丢弃输入:入队,本轮结束后由下方 effect 自动发出
      if (isLoadingRef.current) {
        pendingSendQueueRef.current.push({ text, attachments })
        const queue = pendingSendQueueRef.current
        setPendingSendQueue({ count: queue.length, preview: queue[0].text.slice(0, 40) })
        return
      }
      attachmentsRef.current = attachments
      if (attachments && attachments.length > 0) {
        pendingAttachmentsRef.current = attachments
      }
      sendMessage({ text })
      // 注意: 此处不能清空 attachmentsRef —— AI SDK sendMessages 首行 await resolve2(body)
      // 会先让出微任务,若本处同步清空,getter 求值时附件已丢失(实测所有附件类型均发送为 undefined)。
      // 保留本次值: 下一次发送由上方赋值覆盖(无附件时为 undefined);
      // regenerate 时 getter 仍返回本次附件,服务端注入到最后一条 user 消息,行为正确。
    },
    [sendMessage]
  )

  // AI 设置控制: 监听 update_settings 工具调用并执行设置变更。
  // 历史回放安全: 历史消息由 toUIMessage 重建,parts 仅含 text/reasoning(工具明细走
  // metadata),不会出现 tool-update_settings part,因此不会误触发执行。
  // 不依赖 status: 工具若发生在流的最后一步,finish 后 status 已回 ready,依赖
  // status==='streaming' 会漏执行;用 toolCallId 去重保证只执行一次。
  const executedSettingsCallIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant') return
    for (const part of last.parts) {
      if ((part as { type?: string }).type !== 'tool-update_settings') continue
      const p = part as { state?: string; toolCallId?: string; input?: unknown; output?: { ok?: boolean } }
      if (p.state !== 'output-available') continue
      // 服务端 execute 白名单校验未通过(ok=false):前端不再执行
      if (p.output && p.output.ok === false) continue
      const callId = p.toolCallId
      if (!callId || executedSettingsCallIdsRef.current.has(callId)) continue
      executedSettingsCallIdsRef.current.add(callId)
      void executeSettingsOps(p.input)
    }
  }, [messages])

  // 出队: 本轮生成结束(isLoading true→false)且 status 回到 ready 时,自动发出最早一条排队消息。
  // 出错(status='error')不出队,避免连环失败;用户修复后手动发送的下一轮成功结束时继续消化队列。
  const prevIsLoadingRef = useRef(false)
  useEffect(() => {
    const was = prevIsLoadingRef.current
    prevIsLoadingRef.current = isLoading
    if (!was || isLoading || status !== 'ready') return
    const queue = pendingSendQueueRef.current
    if (queue.length === 0) return
    const next = queue.shift()
    setPendingSendQueue(
      queue.length > 0 ? { count: queue.length, preview: queue[0].text.slice(0, 40) } : null
    )
    if (next) handleSend(next.text, next.attachments)
  }, [isLoading, status, handleSend])

  // 跳转桥: /chat?q= 自动发送一次(外部入口,如 bento AI 卡片「继续对话」)。
  // 仅空会话触发;发出后立即清掉 URL 参数,刷新不会重发;
  // consumedRef 兜底防 React 严格模式双调用重复发送。
  const autoSendConsumedRef = useRef(false)
  useEffect(() => {
    if (!autoSendText || autoSendConsumedRef.current) return
    if (messages.length > 0 || isLoadingRef.current) return
    autoSendConsumedRef.current = true
    const url = new URL(window.location.href)
    if (url.searchParams.has('q')) {
      url.searchParams.delete('q')
      const qs = url.searchParams.toString()
      window.history.replaceState({}, '', url.pathname + (qs ? `?${qs}` : ''))
    }
    handleSend(autoSendText)
  }, [autoSendText, messages.length, handleSend])

  // A 流式恢复: 轮询服务端草稿行快照(1.2s),streaming=false 时定格。
  // 定格内容以库中为准(可能是最终内容,比本地快照新)。
  useEffect(() => {
    if (!remoteStreamingId || !conversationId) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages?limit=1`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        const latest = data.messages?.[0]
        if (cancelled || !latest || latest.role !== 'assistant') return
        if (latest.id !== remoteStreamingId) {
          // 草稿行已消失(流出错且无快照时被服务端删除):停止轮询
          setRemoteStreamingId(null)
          return
        }
        const stillStreaming = latest.streaming === true
        if (!stillStreaming) {
          setRemoteStreamingId(null)
          bumpConversationVersion()
        }
        const text = typeof latest.content === 'string' ? latest.content : ''
        const reasoning =
          typeof latest.reasoning === 'string' && latest.reasoning.trim() ? latest.reasoning : null
        if (!text && !reasoning) return
        setMessages((prev) =>
          prev.map((m) =>
            m.id !== remoteStreamingId
              ? m
              : {
                  ...m,
                  parts: [
                    ...(reasoning
                      ? [{ type: 'reasoning' as const, text: reasoning, state: 'done' as const }]
                      : []),
                    ...(text ? [{ type: 'text' as const, text, state: 'done' as const }] : []),
                  ],
                } as UIMessage
          )
        )
      } catch {
        // 网络抖动:下个周期重试
      }
    }
    void poll()
    const timer = setInterval(poll, 1200)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [remoteStreamingId, conversationId, setMessages, bumpConversationVersion])

  const handleStop = useCallback(() => {
    // 在真正停止前,记录最后一条 assistant 文本到 store,
    // 让 ChatInput 顶部能展示"接着说"横幅。
    // 注意:messages 引用是 closure 捕获的,所以这里读到的可能不是最新;
    // 但 useChat 的 messages 与 status 同步更新,这里是在同一个 setState 周期内调用,
    // 用户的"点 stop"通常会先让 status → 'ready',messages 也是最新的。
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
    const lastText = lastAssistant
      ? lastAssistant.parts
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('')
          .trim()
      : ''
    if (lastText) {
      setPendingContinuation({
        conversationId: conversationIdRef.current ?? null,
        text: lastText,
        modelId: currentModel,
      })
    } else {
      setPendingContinuation(null)
    }
    if (remoteStreamingId) {
      // A 流式恢复: 轮询续显期间没有活动流可 abort,
      // 改为请求服务端定格草稿行,并立即停止本地轮询
      const convId = conversationIdRef.current
      if (convId) {
        fetch(`/api/conversations/${convId}/finalize-draft`, { method: 'POST' }).catch(() => {})
      }
      setRemoteStreamingId(null)
      return
    }
    stop()
  }, [stop, messages, currentModel, setPendingContinuation, remoteStreamingId])

  /**
   * 「接着说」:把停下来的最后一段作为上下文,发送一条提示让模型接着输出。
   * 与 regenerate() 不同,这里不会替换已有内容,而是新增一轮对话。
   */
  const handleContinue = useCallback(() => {
    const pending = pendingContinuation
    if (!pending || !pending.text) {
      setPendingContinuation(null)
      return
    }
    const tail = pending.text.slice(-200).replace(/\s+/g, ' ').trim()
    const prompt = `接着你刚才未完成的内容继续输出，从"${tail.slice(-50)}"之后开始。不要重复之前已经写过的部分。`
    attachmentsRef.current = undefined
    sendMessage({ text: prompt })
    setPendingContinuation(null)
  }, [pendingContinuation, sendMessage, setPendingContinuation])

  const dismissContinuation = useCallback(() => {
    setPendingContinuation(null)
  }, [setPendingContinuation])

  const handleModelChange = useCallback((modelId: string) => {
    setCurrentModel(modelId)
    userToggledDeepThink.current = false // Reset on model change to allow auto-enable
    // Persist to localStorage for new chats to pick up
    localStorage.setItem(MODEL_STORAGE_KEY, modelId)
    // Persist to DB for existing conversations
    const convId = conversationIdRef.current
    if (convId) {
      fetch(`/api/conversations/${convId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId }),
      }).catch((err) => {
        console.error('Failed to persist model:', err)
        toast.error('模型选择保存失败,刷新后会重置', { title: '注意' })
      })
    }
  }, [])

  const handleDeepThinkChange = useCallback((enabled: boolean) => {
    setDeepThink(enabled)
    userToggledDeepThink.current = true // Mark as manually toggled
    localStorage.setItem(DEEP_THINK_STORAGE_KEY, String(enabled))
  }, [])

  const handleWebSearchChange = useCallback((enabled: boolean) => {
    setWebSearch(enabled)
    localStorage.setItem(WEB_SEARCH_STORAGE_KEY, String(enabled))
  }, [])

  const handleMcpEnabledChange = useCallback((enabled: boolean) => {
    setMcpEnabled(enabled)
    localStorage.setItem(MCP_ENABLED_STORAGE_KEY, String(enabled))
  }, [])

  const handleRetry = useCallback(() => {
    clearError()
    regenerate()
  }, [clearError, regenerate])

  // 切换/清除面具:同步 store + localStorage;已有会话时持久化到 DB
  const handleMaskChange = useCallback(
    (maskId: string | null) => {
      setConversationMaskId(maskId)
      if (maskId) {
        localStorage.setItem('chat:maskId', maskId)
      } else {
        localStorage.removeItem('chat:maskId')
      }
      setMaskPickerOpen(false)
      const convId = conversationIdRef.current
      if (convId) {
        fetch(`/api/conversations/${convId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maskId }),
        })
          .then(() => {
            // 面具已持久化,通知侧边栏刷新列表(尾随面具徽标同步更新)
            bumpConversationVersion()
          })
          .catch((err) => {
            console.error('Failed to persist mask:', err)
            toast.error('面具切换保存失败', { title: '提示' })
          })
      }
    },
    [setConversationMaskId, bumpConversationVersion]
  )

  const handleRegenerate = useCallback(() => {
    clearError()
    regenerate()
  }, [clearError, regenerate])

  const handleEditMessage = useCallback(
    async (messageId: string, newText: string) => {
      // C 分支轻量版: 刚发送的消息持有 AI SDK 本地临时 id(与服务端 cuid 不同),
      // 服务端按 id 查不到时会用旧文本回退定位,所以这里附带旧文本一起传
      const oldMessage = messages.find((m) => m.id === messageId)
      const oldText = oldMessage
        ? oldMessage.parts
            .filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join('')
        : ''

      // Delete the old message and all subsequent messages from the DB
      const convId = conversationIdRef.current
      // 服务端定位到的真实数据库 id(客户端传临时 id 时与本地 id 不同),
      // 回看链路(archivedRoot / editedFrom)必须用真实 id
      let editedFromId = messageId
      if (convId) {
        try {
          const res = await fetch(
            `/api/conversations/${convId}/messages?messageId=${encodeURIComponent(messageId)}&content=${encodeURIComponent(oldText)}`,
            { method: 'DELETE' }
          )
          const data = await res.json().catch(() => ({}))
          if (typeof data?.archivedRootId === 'string' && data.archivedRootId) {
            editedFromId = data.archivedRootId
          }
        } catch (err) {
          console.error('Failed to delete old messages:', err)
          toast.error('编辑失败:无法清理旧消息', { title: '编辑消息' })
        }
      }

      // Truncate local messages to before the edited message
      // 注意: 本地查找必须用原始本地 id(临时 id 或历史 cuid),不能用 editedFromId
      const editIndex = messages.findIndex((m) => m.id === messageId)
      if (editIndex === -1) return
      const truncated = messages.slice(0, editIndex)
      setMessages(truncated)

      // C 分支轻量版: 新消息带 editedFrom 指向被编辑消息(真实数据库 id),服务端落库后
      // MessageBubble 据此显示"查看历史版本"回看入口
      sendMessage({ text: newText, metadata: { editedFrom: editedFromId } })
    },
    [messages, setMessages, sendMessage]
  )

  const errorInfo = useMemo(
    () => (error ? getErrorMessage(error) : null),
    [error]
  )

  // 错误出现时同步弹一个 toast 通知用户
  // (红色横幅是持久 UI,toast 是瞬时提醒 —— 两者互补)
  const lastErrorRef = useRef<unknown>(null)
  useEffect(() => {
    if (error && error !== lastErrorRef.current) {
      lastErrorRef.current = error
      toast.error(errorInfo?.message ?? '请求失败,请重试', {
        title: errorInfo?.type === 'api_key' ? '缺少 API Key' : '请求失败',
        timeout: 6000,
      })
    } else if (!error) {
      lastErrorRef.current = null
    }
  }, [error, errorInfo])

  // 对比模式: 渲染并排泳道视图(key 确保模型列表变化时重建泳道)
  if (compareMode) {
    return (
      <ComparePanel
        key={compareModels.join('+')}
        conversationId={initialConversationId}
        initialLaneMessages={laneInitialMessages ?? compareModels.map(() => [])}
        initialCompareModels={compareModels}
        allModels={mergedModels}
        stylePreset={conversationStylePreset}
        maskId={conversationMaskId}
        deepThink={deepThink}
        onDeepThinkChange={handleDeepThinkChange}
        webSearch={webSearch}
        onWebSearchChange={handleWebSearchChange}
        webSearchAvailable={webSearchAvailable}
        onCompareModeChange={handleCompareModeChange}
        compareModeAvailable={!conversationId}
        onConversationCreated={handleCompareConversationCreated}
        initialVote={initialCompareVote ?? null}
      />
    )
  }

  return (
    <div className="flex flex-col h-full relative overflow-hidden">

      {/* Error banner */}
      {error && errorInfo && (
        <div className="mx-4 mt-3 mb-0 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-red-600 dark:text-red-400 font-medium">
              {errorInfo.message}
            </p>
            {process.env.NODE_ENV === 'development' && error.message && (
              <p className="mt-1 text-xs text-red-400/70 dark:text-red-400/60 font-mono truncate">
                {error.message}
              </p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={handleRetry}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                  bg-red-500 text-white
                  hover:bg-red-600 transition-colors
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-strong"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                重试
              </button>
              {errorInfo.type === 'api_key' && (
                <Link
                  href="/chat/settings"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                    bg-surface-muted text-content-secondary
                    hover:bg-surface-subtle transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-strong"
                >
                  <SettingsIcon className="w-3.5 h-3.5" />
                  前往设置
                </Link>
              )}
            </div>
          </div>
          <button
            onClick={() => clearError()}
            className="shrink-0 p-1 rounded-md text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
            aria-label="关闭错误提示"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Mask bar - 当前生效的面具 chip(仅对话态;欢迎态由输入框下方胶囊行承担入口),点击弹出切换面板 */}
      {activeMask && messages.length > 0 && (
        <div className="px-4 pt-2">
          <div className="relative inline-block">
            <button
              onClick={() => setMaskPickerOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs
                bg-surface-subtle text-content-secondary border border-line
                hover:bg-surface-muted transition-colors"
              title="当前面具,点击切换"
            >
              <span aria-hidden>{activeMask.avatar}</span>
              <span>{activeMask.name}</span>
            </button>
            {maskPickerOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMaskPickerOpen(false)} />
                <div
                  className="absolute left-0 top-full mt-1.5 z-50 w-64 max-h-80 overflow-y-auto
                    rounded-xl border border-line bg-surface shadow-lg py-1.5"
                  role="menu"
                >
                  <MaskPickerMenu
                    activeMaskId={activeMask.id}
                    userMasks={userMasks}
                    onSelect={handleMaskChange}
                    onManage={() => { setSettingsSection('masks'); setSettingsOpen(true); setMaskPickerOpen(false) }}
                    onClear={() => handleMaskChange(null)}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Messages area 或 欢迎态输入区(messages.length === 0 时由 ChatInput 自己居中渲染) */}
      {messages.length === 0 ? (
        <ChatInput
          variant="welcome"
          onSend={handleSend}
          onStop={handleStop}
          isLoading={isLoading}
          models={mergedModels}
          selectedModel={currentModel}
          onModelChange={handleModelChange}
          deepThink={deepThink}
          onDeepThinkChange={handleDeepThinkChange}
          webSearch={webSearch}
          onWebSearchChange={handleWebSearchChange}
          webSearchAvailable={webSearchAvailable}
          mcpEnabled={mcpEnabled}
          onMcpEnabledChange={handleMcpEnabledChange}
          mcpAvailable={mcpAvailable}
          compareMode={false}
          compareModeAvailable={!conversationId}
          onCompareModeChange={handleCompareModeChange}
          mask={activeMask}
          onMaskChange={handleMaskChange}
          userMasks={userMasks}
          onManageMasks={() => { setSettingsSection('masks'); setSettingsOpen(true) }}
          welcomeHeader={(
            <div className="text-center mb-8">
              <h2
                className="text-content-primary"
                style={{
                  fontFamily: "'PingFang SC', 'PingFang SC Sub', 'Microsoft YaHei UI', -apple-system, BlinkMacSystemFont, sans-serif",
                  fontWeight: 100,
                  fontSize: '32px',
                  lineHeight: 1.2,
                  letterSpacing: '0.02em',
                }}
              >
                {getGreeting()}，今天能为你做些什么？
              </h2>
              {/* 副标题: 日期 + 当前模型,给问候语增加层次 */}
              <p className="mt-3 text-xs text-content-muted tracking-wide">
                {getDateLine()}
                {currentModelName ? ` · ${currentModelName}` : ''}
              </p>
            </div>
          )}
        />
      ) : (
        <>
          {/* relative wrapper: "回到底部"按钮需要相对消息区(而非滚动内容)定位,
              absolute 元素放进滚动容器内会随内容滚走 */}
          <div className="relative flex-1 min-h-0">
            <div
              ref={setMessagesScrollEl}
              className="h-full overflow-y-auto overflow-x-hidden scroll-contain"
            >
              <div className="flex min-h-full">
                <MessageList
                  messages={messages}
                  isStreaming={isLoading}
                  isPending={status === 'submitted'}
                  className="min-h-full flex-1"
                  onRegenerate={handleRegenerate}
                  onEditMessage={handleEditMessage}
                  onClarifySubmit={handleSend}
                />
                <OutlineSidebar messages={messages} scrollContainer={messagesScrollEl} />
              </div>
            </div>
            {showScrollToBottom && (
              <button
                type="button"
                onClick={handleScrollToBottom}
                aria-label="回到底部"
                title="回到底部"
                className="absolute bottom-4 right-5 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-content-secondary shadow-sm transition-colors hover:bg-surface-subtle hover:text-content-primary"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* 输入区上方的辅助行: 左侧排队发送横幅(F),右侧上下文用量仪表(B)。
              与输入框同宽对齐(ChatInput 内层同为 max-w-2xl 居中),仪表贴在输入框右缘正上方 */}
          {(pendingSendQueue || (conversationId && currentContextWindow > 0)) && (
            <div className="px-3 pb-1">
              <div className="mx-auto flex w-full max-w-2xl items-end justify-between gap-2">
                {pendingSendQueue ? (
                  <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-surface-subtle/60 px-2.5 py-1 text-[11px] text-content-secondary">
                    <span className="truncate">
                      AI 回复后将自动发送
                      {pendingSendQueue.count > 1 ? `（排队 ${pendingSendQueue.count} 条）` : ''}：
                      {pendingSendQueue.preview}
                    </span>
                    <button
                      onClick={cancelPendingSendQueue}
                      className="shrink-0 rounded px-1 text-[10px] text-content-muted transition-colors hover:text-content-primary"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <span />
                )}
                {conversationId && currentContextWindow > 0 && (
                  <ContextMeter
                    conversationId={conversationId}
                    contextWindow={currentContextWindow}
                    refreshSignal={messages.length}
                  />
                )}
              </div>
            </div>
          )}

          {/* Input area - fixed at bottom */}
          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            isLoading={isLoading}
            models={mergedModels}
            selectedModel={currentModel}
            onModelChange={handleModelChange}
            deepThink={deepThink}
            onDeepThinkChange={handleDeepThinkChange}
            webSearch={webSearch}
            onWebSearchChange={handleWebSearchChange}
            webSearchAvailable={webSearchAvailable}
            mcpEnabled={mcpEnabled}
            onMcpEnabledChange={handleMcpEnabledChange}
            mcpAvailable={mcpAvailable}
            compareMode={false}
            compareModeAvailable={!conversationId}
            onCompareModeChange={handleCompareModeChange}
            pendingContinuationExists={!!pendingContinuation}
            onContinue={handleContinue}
            onDismissContinuation={dismissContinuation}
          />
        </>
      )}

      {/* Right preview panel (desktop) */}
      {previewCode && !isPreviewFullscreen && (
        <div className="hidden md:flex flex-col border-l border-line bg-code-bg min-w-[400px]">
          <MacHeaderForPreview code={previewCode} onClose={() => setPreviewCode(null)} />
        </div>
      )}
      
      {/* Fullscreen previews - absolute positioned overlays */}
      {(previewCode && isPreviewFullscreen) && (
        <>
          <div className="fixed inset-0 z-50 flex flex-col bg-code-bg md:hidden pointer-events-none">
            <div className="flex items-center justify-between px-4 py-2 bg-code-header border-b border-line shrink-0 pointer-events-auto">
              <button
                onClick={() => setIsPreviewFullscreen(false)}
                className="flex items-center justify-center w-3 h-3 rounded-full bg-[#ff5f57] border border-[#e0443e] hover:brightness-90 transition-all pointer-events-auto"
                aria-label="关闭"
              >
                <X className="w-2 h-2 text-[#820000] opacity-0 hover:opacity-100 transition-opacity" />
              </button>
              <span className="text-[11px] text-content-muted font-mono select-none pointer-events-auto">preview</span>
              <div className="w-3" />
            </div>
            <iframe
              src={`data:text/html;charset=utf-8,${encodeURIComponent(previewCode)}`}
              className="flex-1 w-full bg-white border-0 pointer-events-auto"
              style={{ height: 'calc(100vh - 50px)' }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
          
          <div className="hidden md:flex fixed inset-0 z-50 flex flex-col bg-code-bg pointer-events-none">
            <div className="flex items-center justify-between px-4 py-2 bg-code-header border-b border-line shrink-0 pointer-events-auto">
              <button
                onClick={() => setIsPreviewFullscreen(false)}
                className="flex items-center justify-center w-3 h-3 rounded-full bg-[#ff5f57] border border-[#e0443e] hover:brightness-90 transition-all pointer-events-auto"
                aria-label="关闭"
              >
                <X className="w-2 h-2 text-[#820000] opacity-0 hover:opacity-100 transition-opacity" />
              </button>
              <span className="text-[11px] text-content-muted font-mono select-none pointer-events-auto">preview</span>
              <div className="w-3" />
            </div>
            <iframe
              src={`data:text/html;charset=utf-8,${encodeURIComponent(previewCode)}`}
              className="flex-1 w-full bg-white border-0 pointer-events-auto"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        </>
      )}
    </div>
  )
}

// ── Mac-style header component for preview ───────────────────────────
function MacHeaderForPreview({ 
  code, 
  onClose 
}: { 
  code: string
  onClose: () => void
}) {
  const [zoom, setZoom] = useState(1)
  const zoomMin = 0.5
  const zoomMax = 2
  const zoomStep = 0.25

  return (
    <>
      <div className="flex items-center justify-between px-4 py-2 bg-code-header border-b border-line">
        <div className="flex items-center gap-1.5">
          <Eye className="w-3 h-3 text-content-secondary" />
          <span className="text-[11px] text-content-muted font-mono">HTML Preview</span>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 p-1 rounded-md text-content-muted hover:text-red-500 hover:bg-surface-subtle transition-colors"
          aria-label="关闭预览"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-hidden bg-white">
        <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }} className="origin-top-left">
          <iframe
            src={`data:text/html;charset=utf-8,${encodeURIComponent(code)}`}
            className="w-full origin-top-left"
            style={{ width: '100%', minHeight: '600px' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      </div>
      {/* Zoom controls */}
      <div className="flex items-center justify-center gap-3 py-3 bg-code-header border-t border-line shrink-0">
        <button
          onClick={() => setZoom((z) => Math.max(zoomMin, z - zoomStep))}
          disabled={zoom <= zoomMin}
          className="flex items-center justify-center w-7 h-7 rounded-full bg-surface border border-line-strong text-content-secondary hover:bg-surface-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
          aria-label="缩小"
        >
          <Minus className="w-3 h-3" />
        </button>
        <button
          onClick={() => setZoom(1)}
          className="text-[11px] text-content-secondary font-mono min-w-[3rem] text-center hover:text-content-primary transition-colors"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={() => setZoom((z) => Math.min(zoomMax, z + zoomStep))}
          disabled={zoom >= zoomMax}
          className="flex items-center justify-center w-7 h-7 rounded-full bg-surface border border-line-strong text-content-secondary hover:bg-surface-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
          aria-label="放大"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </>
  )
}
