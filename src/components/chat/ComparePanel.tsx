'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type { UIMessage } from 'ai'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat-store'
import type { ModelDefinition } from '@/lib/ai/types'
import type { Attachment } from './FileUpload'
import { CompareLane, type LaneApi } from './CompareLane'
import { ChatInput } from './ChatInput'
import { PROVIDER_DOT } from './ModelSelector'
import { toast } from '@/lib/toast'

const COMPARE_MODELS_STORAGE_KEY = 'chat:compareModels'

interface ComparePanelProps {
  conversationId?: string
  /** 每个泳道的初始消息(与 compareModels 对齐) */
  initialLaneMessages: UIMessage[][]
  /** 初始对比模型(来自 DB 或默认值) */
  initialCompareModels: string[]
  allModels: ModelDefinition[]
  stylePreset: string
  /** 面具 id(对比模式下所有泳道共享) */
  maskId: string | null
  deepThink: boolean
  onDeepThinkChange: (enabled: boolean) => void
  /** 联网搜索(对比模式下所有泳道共享一个开关) */
  webSearch: boolean
  onWebSearchChange: (enabled: boolean) => void
  webSearchAvailable: boolean
  /** 关闭对比模式(仅新对话时可关闭,由父级提供) */
  onCompareModeChange?: (enabled: boolean) => void
  compareModeAvailable?: boolean
  /** 会话创建后通知父级(用于隐藏切换开关) */
  onConversationCreated?: (convId: string) => void
}

export function ComparePanel({
  conversationId: initialConversationId,
  initialLaneMessages,
  initialCompareModels,
  allModels,
  stylePreset,
  maskId,
  deepThink,
  onDeepThinkChange,
  webSearch,
  onWebSearchChange,
  webSearchAvailable,
  onCompareModeChange,
  compareModeAvailable,
  onConversationCreated,
}: ComparePanelProps) {
  const [compareModels, setCompareModels] = useState<string[]>(initialCompareModels)
  const [anyLoading, setAnyLoading] = useState(false)
  // 单独继续聊天: 弹窗选中的泳道模型,确认后转换/克隆
  const [soloModelId, setSoloModelId] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)

  // 共享 ref
  const conversationIdRef = useRef<string | null>(initialConversationId ?? null)
  const groupIdRef = useRef<string>('')
  const laneApis = useRef<Map<string, LaneApi>>(new Map())
  const loadingStates = useRef<Map<string, boolean>>(new Map())
  const compareModelsRef = useRef(compareModels)

  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId)
  const setConversationTitle = useChatStore((s) => s.setConversationTitle)
  const bumpConversationVersion = useChatStore((s) => s.bumpConversationVersion)

  // 同步模型列表 ref —— 必须在 useEffect 里写,不能在 render 体直接写 .current,
  // 否则 React 18 并发渲染下会触发 Maximum update depth exceeded 错误。
  useEffect(() => {
    compareModelsRef.current = compareModels
  }, [compareModels])

  // 同步会话到全局 store(侧边栏)
  useEffect(() => {
    setCurrentConversationId(initialConversationId ?? null)
  }, [initialConversationId, setCurrentConversationId])

  const handleConvIdFromHeader = useCallback(
    (newConvId: string, newConvTitle?: string | null) => {
      if (newConvId && newConvId !== conversationIdRef.current) {
        const isNew = conversationIdRef.current === null
        conversationIdRef.current = newConvId
        setCurrentConversationId(newConvId)
        if (isNew) bumpConversationVersion() // 服务端兜底建会话,通知侧边栏刷新
        if (newConvTitle) {
          setConversationTitle(decodeURIComponent(newConvTitle))
        }
        window.history.replaceState(null, '', `/chat/c/${newConvId}`)
        if (isNew) onConversationCreated?.(newConvId)
      }
    },
    [setCurrentConversationId, setConversationTitle, bumpConversationVersion, onConversationCreated]
  )

  const registerApi = useCallback((modelId: string, api: LaneApi | null) => {
    if (api) {
      laneApis.current.set(modelId, api)
    } else {
      laneApis.current.delete(modelId)
    }
  }, [])

  const handleLoadingChange = useCallback((modelId: string, isLoading: boolean) => {
    loadingStates.current.set(modelId, isLoading)
    setAnyLoading(Array.from(loadingStates.current.values()).some(Boolean))
  }, [])

  // 首轮发送前先创建对比会话,规避 N 个并发请求各自建会话的竞态
  const handleSend = useCallback(
    async (text: string, attachments?: Attachment[]) => {
      let convId = conversationIdRef.current
      if (!convId) {
        try {
          const res = await fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: text.slice(0, 40) || '新对话',
              model: compareModelsRef.current[0],
              stylePreset,
              maskId,
              mode: 'compare',
              compareModels: compareModelsRef.current,
            }),
          })
          if (res.ok) {
            const conv = await res.json()
            convId = conv.id
            conversationIdRef.current = conv.id
            setCurrentConversationId(conv.id)
            bumpConversationVersion() // 预创建成功,通知侧边栏刷新
            if (conv.title) {
              setConversationTitle(conv.title)
            }
            window.history.replaceState(null, '', `/chat/c/${conv.id}`)
            onConversationCreated?.(conv.id)
          }
        } catch (err) {
          // 预创建失败时由服务端兜底创建(响应头回调会同步 id)
          console.error('Failed to pre-create compare conversation:', err)
        }
      }
      groupIdRef.current = crypto.randomUUID()
      // 把 attachments 直接传给每个泳道 —— 不再用共享 ref,避免后调用的泳道读到的已被清空
      for (const modelId of compareModelsRef.current) {
        laneApis.current.get(modelId)?.send(text, attachments)
      }
    },
    [stylePreset, maskId, setCurrentConversationId, setConversationTitle, bumpConversationVersion, onConversationCreated]
  )

  const handleStop = useCallback(() => {
    laneApis.current.forEach((api) => api.stop())
  }, [])

  const handleCompareModelsChange = useCallback(
    (models: string[]) => {
      setCompareModels(models)
      localStorage.setItem(COMPARE_MODELS_STORAGE_KEY, JSON.stringify(models))
      // 已有会话时同步到 DB
      const convId = conversationIdRef.current
      if (convId) {
        fetch(`/api/conversations/${convId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ compareModels: models }),
        }).catch((err) => console.error('Failed to persist compare models:', err))
      }
    },
    []
  )

  // 原地转换: 当前会话转为与所选模型的单聊,刷新后由服务端渲染单聊视图
  const handleConvertInPlace = useCallback(async () => {
    const convId = conversationIdRef.current
    if (!soloModelId || !convId) return
    setConverting(true)
    try {
      const res = await fetch(`/api/conversations/${convId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'single', model: soloModelId }),
      })
      if (!res.ok) throw new Error('Convert failed')
      window.location.href = `/chat/c/${convId}`
    } catch (err) {
      console.error('Failed to convert to single chat:', err)
      toast.error('转换失败，请重试')
      setConverting(false)
    }
  }, [soloModelId])

  // 另存为新对话: 克隆用户消息 + 所选模型回答到新会话,保留原对比会话
  const handleCloneAsNew = useCallback(async () => {
    const convId = conversationIdRef.current
    if (!soloModelId || !convId) return
    setConverting(true)
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloneFrom: convId, model: soloModelId }),
      })
      if (!res.ok) throw new Error('Clone failed')
      const conv = await res.json()
      window.location.href = `/chat/c/${conv.id}`
    } catch (err) {
      console.error('Failed to clone conversation:', err)
      toast.error('创建新会话失败，请重试')
      setConverting(false)
    }
  }, [soloModelId])

  const soloModelDef = soloModelId ? allModels.find((m) => m.id === soloModelId) : undefined

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      {/* Messages area: N lanes side by side */}
      {/* 显式行 minmax(0,1fr) 让泳道高度撑满容器,否则隐式 auto 行高会按内容撑开导致内部无法滚动 */}
      <div className="flex-1 min-h-0 overflow-hidden grid grid-flow-col auto-cols-fr grid-rows-[minmax(0,1fr)]">
        {compareModels.map((modelId, index) => {
          const modelDef = allModels.find((m) => m.id === modelId)
          return (
            <div
              key={modelId}
              className={cn(
                'h-full min-w-0 border-line/60',
                index < compareModels.length - 1 && 'border-r'
              )}
            >
              {modelDef ? (
                <CompareLane
                  modelId={modelId}
                  modelDef={modelDef}
                  initialMessages={initialLaneMessages[index] ?? []}
                  conversationIdRef={conversationIdRef}
                  groupIdRef={groupIdRef}
                  stylePreset={stylePreset}
                  maskId={maskId}
                  deepThink={deepThink}
                  webSearch={webSearch}
                  onConvIdFromHeader={handleConvIdFromHeader}
                  registerApi={(api) => registerApi(modelId, api)}
                  onLoadingChange={(loading) => handleLoadingChange(modelId, loading)}
                  onRequestSolo={setSoloModelId}
                />
              ) : (
                <div className="h-full flex items-center justify-center px-4">
                  <p className="text-xs text-content-muted text-center">模型不可用</p>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Input area - fixed at bottom */}
      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        isLoading={anyLoading}
        models={allModels}
        selectedModel={compareModels[0] ?? ''}
        onModelChange={() => {}}
        deepThink={deepThink}
        onDeepThinkChange={onDeepThinkChange}
        webSearch={webSearch}
        onWebSearchChange={onWebSearchChange}
        webSearchAvailable={webSearchAvailable}
        compareMode
        compareModeAvailable={compareModeAvailable}
        onCompareModeChange={onCompareModeChange}
        compareModels={compareModels}
        onCompareModelsChange={handleCompareModelsChange}
      />

      {/* 单独继续聊天弹窗: 原地转换 / 另存为新对话 */}
      {soloModelId && soloModelDef && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/20 backdrop-blur-[12px] saturate-150 dark:bg-white/15 dark:saturate-150"
            onClick={() => !converting && setSoloModelId(null)}
          />
          <div className="relative w-[360px] max-w-[90vw] rounded-2xl border border-line/60 bg-surface p-5 shadow-2xl">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  PROVIDER_DOT[soloModelDef.provider] ?? 'bg-content-muted'
                )}
              />
              <h3 className="text-sm font-semibold text-content-primary truncate">
                与 {soloModelDef.name} 单独继续聊天
              </h3>
            </div>
            <p className="mt-2 text-xs text-content-secondary leading-relaxed">
              将带着当前对话上下文与该模型继续，请选择方式：
            </p>
            <div className="mt-4 space-y-2">
              <button
                onClick={handleConvertInPlace}
                disabled={converting}
                className="w-full text-left rounded-xl border border-line/60 bg-surface/60 hover:bg-surface-subtle hover:border-accent/50 px-3.5 py-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="block text-xs font-semibold text-content-primary">原地转换</span>
                <span className="block mt-0.5 text-[11px] text-content-secondary leading-relaxed">
                  当前会话直接转为单聊，其他模型的回答将被隐藏（数据仍保留在库中）
                </span>
              </button>
              <button
                onClick={handleCloneAsNew}
                disabled={converting}
                className="w-full text-left rounded-xl border border-line/60 bg-surface/60 hover:bg-surface-subtle hover:border-accent/50 px-3.5 py-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="block text-xs font-semibold text-content-primary">另存为新对话</span>
                <span className="block mt-0.5 text-[11px] text-content-secondary leading-relaxed">
                  保留原对比会话，复制「用户消息 + 该模型回答」到新会话继续
                </span>
              </button>
            </div>
            <button
              onClick={() => setSoloModelId(null)}
              disabled={converting}
              className="mt-3 w-full py-2 rounded-lg text-xs text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
