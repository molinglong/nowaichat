'use client'

import { useState, useRef, useCallback, useEffect, KeyboardEvent, ChangeEvent } from 'react'
import { Send, Square, X, Plus, AlertCircle, FileText, Play, ArrowUp, Columns2, Drama, Settings as SettingsIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FileUpload, deleteUploadedFile, type Attachment } from './FileUpload'
import { ModelSelector } from './ModelSelector'
import { MaskPickerMenu } from './MaskPickerMenu'
import type { MaskDTO } from '@/lib/ai/mask-types'
import { useSingleFlight } from '@/hooks/useSingleFlight'
import { useChatStore } from '@/store/chat-store'
import { draftKeyFor, setDraft as persistDraft } from '@/lib/draft-storage'
import type { ModelDefinition } from '@/lib/ai/types'

export interface ChatInputProps {
  onSend: (text: string, attachments?: Attachment[]) => void
  onStop: () => void
  isLoading: boolean
  className?: string
  models: ModelDefinition[]
  selectedModel: string
  onModelChange: (modelId: string) => void
  deepThink: boolean
  onDeepThinkChange: (enabled: boolean) => void
  /** 联网搜索。需要在设置中配置 SearchApiKey。 */
  webSearch?: boolean
  onWebSearchChange?: (enabled: boolean) => void
  webSearchAvailable?: boolean
  // 对比模式
  compareMode?: boolean
  compareModeAvailable?: boolean
  onCompareModeChange?: (enabled: boolean) => void
  compareModels?: string[]
  onCompareModelsChange?: (models: string[]) => void
  /** 当前生效面具(欢迎页胶囊显示);空表示未使用面具 */
  mask?: { id: string; name: string; avatar: string } | null
  /** 切换/清除面具(欢迎页胶囊菜单) */
  onMaskChange?: (maskId: string | null) => void
  /** 自定义面具列表(欢迎页胶囊菜单「我的面具」分组) */
  userMasks?: MaskDTO[]
  /** 打开面具管理(设置页 masks 分区) */
  onManageMasks?: () => void
  /** 「接着说」横幅:存在时显示在输入框上方 */
  pendingContinuationExists?: boolean
  onContinue?: () => void
  onDismissContinuation?: () => void
  /**
   * 视觉变体:
   * - 'standard'(默认): 聊天页底部玻璃态卡片,支持附件 / 对比 / 接着说
   * - 'welcome': 新对话页简洁卡片(中间偏上),附件/对比入口在输入框下方胶囊行
   */
  variant?: 'standard' | 'welcome'
  /** welcome 变体顶部可选问候语/引导(slot) */
  welcomeHeader?: React.ReactNode
}

export function ChatInput({
  onSend,
  onStop,
  isLoading,
  className,
  models,
  selectedModel,
  onModelChange,
  deepThink,
  onDeepThinkChange,
  webSearch = false,
  onWebSearchChange,
  webSearchAvailable = false,
  compareMode = false,
  compareModeAvailable = false,
  onCompareModeChange,
  compareModels,
  onCompareModelsChange,
  mask,
  onMaskChange,
  userMasks,
  onManageMasks,
  pendingContinuationExists,
  onContinue,
  onDismissContinuation,
  variant = 'standard',
  welcomeHeader,
}: ChatInputProps) {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sendError, setSendError] = useState<string | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  // 仅 welcome 变体使用:控制单行 / 多行 UI 切换
  const [isMultiline, setIsMultiline] = useState(false)
  // 仅 welcome 变体使用:面具胶囊菜单开合
  const [maskMenuOpen, setMaskMenuOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 引用回复状态
  const replyingTo = useChatStore((s) => s.replyingTo)
  const setReplyingTo = useChatStore((s) => s.setReplyingTo)

  // ── 草稿自动保存 ──────────────────────────────────────────────────────────
  // 用 store 里的 currentConversationId 作为 key 维度;空会话用 '__new__'
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const draftKey = draftKeyFor(currentConversationId)
  const draftsMap = useChatStore((s) => s.drafts)
  const storeSetDraft = useChatStore((s) => s.setDraft)
  // 跟踪上一次挂载的 key:key 变化时重新加载草稿(防止跨会话串台)
  const lastLoadedKeyRef = useRef<string | null>(null)

  // key 切换 → 加载对应草稿(SSR 期间 drafts 为空,客户端 hydrate 后再加载)
  useEffect(() => {
    if (lastLoadedKeyRef.current === draftKey) return
    lastLoadedKeyRef.current = draftKey
    const draft = draftsMap[draftKey]
    if (draft && draft.text) {
      setInput(draft.text)
      setDraftRestored(true)
      // 3 秒后自动隐藏"已恢复"提示
      const t = setTimeout(() => setDraftRestored(false), 3000)
      return () => clearTimeout(t)
    } else {
      setInput('')
    }
    // 仅依赖 key;draftsMap 变化不触发(避免用户输入时被覆盖)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  // 切换会话时清空引用回复(避免跨会话残留)
  useEffect(() => {
    return () => setReplyingTo(null)
  }, [currentConversationId, setReplyingTo])

  // 输入变化 → 写入 store + localStorage(节流 400ms)
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = input.trim()
      if (trimmed) {
        storeSetDraft(draftKey, { text: input, savedAt: Date.now() })
        persistDraft(draftKey, { text: input, savedAt: Date.now() })
      } else {
        // 空文本 → 清掉草稿,避免残留旧内容
        storeSetDraft(draftKey, null)
        persistDraft(draftKey, null)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [input, draftKey, storeSetDraft])

  // Auto-resize textarea (standard 变体专用)
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }, [])

  useEffect(() => {
    if (variant !== 'standard') return
    adjustHeight()
  }, [input, adjustHeight, variant])

  // Reset height when loading finishes
  useEffect(() => {
    if (!isLoading) {
      textareaRef.current?.focus()
    }
  }, [isLoading])

  // welcome 变体:文本和附件都清空时回到单行态
  useEffect(() => {
    if (variant !== 'welcome') return
    if (input === '' && attachments.length === 0 && isMultiline) {
      const ta = textareaRef.current
      if (ta) {
        ta.style.height = '56px'
      }
      setIsMultiline(false)
    }
  }, [input, attachments.length, isMultiline, variant])

  // welcome 变体:首次上传附件后自动展开到多行态(让预览可见)
  useEffect(() => {
    if (variant !== 'welcome') return
    if (attachments.length > 0 && !isMultiline) {
      setIsMultiline(true)
    }
  }, [attachments.length, isMultiline, variant])

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendDebounced()
    }
  }

  function handleSendInternal() {
    const trimmed = input.trim()
    if ((!trimmed && attachments.length === 0) || isLoading) return

    // 图片附件需要视觉模型:拦截不支持视觉的模型,给出明确指引
    if (attachments.some((a) => a.type.startsWith('image/'))) {
      const visionModels = models.filter((m) => m.supportsVision)
      if (compareMode && compareModels) {
        const blind = compareModels.filter(
          (id) => !models.find((m) => m.id === id)?.supportsVision
        )
        if (blind.length > 0) {
          const blindNames = blind
            .map((id) => models.find((m) => m.id === id)?.name ?? id)
            .join('、')
          setSendError(
            `对比模式中的 ${blindNames} 不支持图片识别` +
              (visionModels.length > 0
                ? `，请换成支持视觉的模型（如 ${visionModels.slice(0, 2).map((m) => m.name).join('、')}）`
                : '')
          )
          return
        }
      } else {
        const current = models.find((m) => m.id === selectedModel)
        if (current && !current.supportsVision) {
          setSendError(
            `当前模型 ${current.name} 不支持图片识别` +
              (visionModels.length > 0
                ? `，请切换到 ${visionModels.slice(0, 2).map((m) => m.name).join(' 或 ')} 后重试`
                : '，请先选择支持视觉的模型')
          )
          return
        }
      }
    }

    setSendError(null)
    // 如果有引用,拼接到消息前面
    let finalText = trimmed
    if (replyingTo) {
      const prefix = `> 回复 ${replyingTo.role === 'user' ? '用户' : 'AI'}: ${replyingTo.text}\n\n`
      finalText = prefix + trimmed
      // 清空引用状态
      setReplyingTo(null)
    }
    onSend(finalText, attachments.length > 0 ? attachments : undefined)
    setInput('')
    setAttachments([])
    // 发送后立即清掉本会话的草稿(避免下次再误加载)
    storeSetDraft(draftKey, null)
    persistDraft(draftKey, null)
    // welcome 变体: 重置多行态
    if (variant === 'welcome') {
      setIsMultiline(false)
      const ta = textareaRef.current
      if (ta) ta.style.height = '56px'
    } else {
      // Reset height after send (standard)
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
        }
      }, 0)
    }
  }

  // Single-flight 锁:发送期间屏蔽重复点击,发送完成后解锁
  const handleSendDebounced = useSingleFlight(handleSendInternal, [
    input,
    attachments,
    isLoading,
    compareMode,
    compareModels,
    models,
    selectedModel,
    onSend,
    variant,
  ])

  // 对比模式: 更换某个位置的模型(若与列表内其他位置重复则交换)
  function handleCompareModelChange(index: number, modelId: string) {
    if (!compareModels || !onCompareModelsChange) return
    const next = [...compareModels]
    const existingIdx = next.indexOf(modelId)
    if (existingIdx !== -1 && existingIdx !== index) {
      next[existingIdx] = next[index]
    }
    next[index] = modelId
    onCompareModelsChange(next)
  }

  function handleAddCompareModel() {
    if (!compareModels || !onCompareModelsChange || compareModels.length >= 3) return
    const next = models.find((m) => !compareModels.includes(m.id))
    if (next) onCompareModelsChange([...compareModels, next.id])
  }

  function handleRemoveCompareModel(index: number) {
    if (!compareModels || !onCompareModelsChange || compareModels.length <= 2) return
    onCompareModelsChange(compareModels.filter((_, i) => i !== index))
  }

  // ============= WELCOME VARIANT =============
  if (variant === 'welcome') {
    return (
      <div
        className={cn('relative flex-1 w-full flex flex-col md:justify-center px-4', className)}
        style={{
          // 键盘弹出时让内容贴底(否则依旧被键盘遮住);
          // 没键盘时桌面垂直居中、移动也保持居中(只加 paddingBottom 占键盘)。
          paddingBottom: 'var(--keyboard-height, 0px)',
        }}
      >
        {/* 点阵背景: 中心(内容区)淡出、四周渐显,纯装饰 */}
        <div className="dot-grid" aria-hidden="true" />

        <div className="relative w-full max-w-2xl mx-auto md:-translate-y-[8vh]">
          {/* 可选问候语(slot); md 以上整体上移 8vh,视觉重心中间偏上 */}
          {welcomeHeader}

          {/* 草稿已恢复提示 —— 仅在有草稿时短暂出现 */}
          {draftRestored && input.trim() && (
            <div className="flex items-center gap-1.5 mb-2 mx-2 text-content-muted">
              <FileText className="w-3.5 h-3.5 shrink-0" />
              <span className="text-[11px] flex-1 min-w-0">已恢复上次未发送的内容</span>
              <button
                onClick={() => {
                  setInput('')
                  setDraftRestored(false)
                }}
                className="shrink-0 text-[11px] text-content-secondary hover:text-content-primary underline-offset-2 hover:underline"
                aria-label="清除草稿"
              >
                清除
              </button>
            </div>
          )}

          {/* 发送前校验错误(例如:图片附件 + 当前模型不支持视觉) */}
          {sendError && (
            <div className="flex items-start gap-1.5 mb-2 mx-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-500 leading-relaxed flex-1 min-w-0">{sendError}</p>
              <button
                onClick={() => setSendError(null)}
                className="shrink-0 p-0.5 rounded text-content-muted hover:text-content-primary transition-colors"
                aria-label="关闭提示"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* 输入框容器: 单行 / 多行自动扩展 + 按钮沉底 */}
          <div
            className="rounded-xl border border-line bg-surface shadow-sm overflow-hidden
              focus-within:border-line-strong focus-within:shadow-md
              transition-[border-color,box-shadow] duration-200"
            style={{
              position: 'relative',
              height: isMultiline ? undefined : '56px',
            }}
          >
            {/* 顶栏: 单行时内联 flex 居中, 多行时隐藏。
                附件/对比入口已统一下沉到输入框下方胶囊行 */}
            <div
              className="flex items-center gap-2 px-3"
              style={{
                height: '56px',
                display: isMultiline ? 'none' : 'flex',
              }}
            >
              <ModelSelector
                models={models}
                selectedModel={selectedModel}
                onModelChange={onModelChange}
                deepThink={deepThink}
                onDeepThinkChange={onDeepThinkChange}
                webSearch={webSearch}
                onWebSearchChange={onWebSearchChange}
                webSearchAvailable={webSearchAvailable}
              />
              <div className="w-px h-7 bg-line shrink-0" />
              <textarea
                key="welcome-single"
                ref={textareaRef}
                value={input}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="输入问题..."
                rows={1}
                disabled={isLoading}
                className="flex-1 bg-transparent text-sm text-content-primary placeholder:text-content-muted
                  resize-none focus:outline-none border-0 m-0 disabled:opacity-50"
                style={{
                  height: '56px',
                  padding: '0',
                  lineHeight: '56px',
                  verticalAlign: 'middle',
                }}
                onInput={(e) => {
                  const target = e.currentTarget
                  target.style.height = 'auto'
                  target.style.height = `${target.scrollHeight}px`
                  setIsMultiline(target.scrollHeight > 58)
                }}
              />
              <button
                onClick={handleSendDebounced}
                disabled={(!input.trim() && attachments.length === 0) || isLoading}
                aria-label="发送"
                className={cn(
                  // 移动端 ≥44px;桌面 36px
                  'shrink-0 flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-full transition-colors',
                  'active:scale-95 touch-manipulation',
                  (input.trim() || attachments.length > 0) && !isLoading
                    ? 'bg-accent text-white hover:bg-accent/90 animate-pop-in'
                    : 'bg-surface-subtle text-content-muted cursor-not-allowed'
                )}
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <ArrowUp className="w-[18px] h-[18px]" />
              </button>
            </div>

            {/* 多行态: textarea 自扩展 + 底部工具栏(flex 布局,不用 absolute) */}
            <div
              className="flex flex-col"
              style={{
                // 用 max-height + opacity 过渡代替 display:none 硬切,
                // 让单行 ↔ 多行切换时有平滑动画
                display: 'flex',
                maxHeight: isMultiline ? '500px' : '0px',
                opacity: isMultiline ? 1 : 0,
                overflow: 'hidden',
                transition: 'max-height 200ms ease-out, opacity 150ms ease-out',
              }}
            >
              {/* 附件预览(放在 textarea 上方,与 standard 变体一致) */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 pt-3">
                  {attachments.map((att, idx) => (
                    <div
                      key={att.url + idx}
                      className={cn(
                        'group flex items-center gap-2 rounded-lg border',
                        'border-line bg-surface-muted',
                        'px-2 py-1.5 w-full sm:max-w-[200px] sm:w-auto'
                      )}
                    >
                      {att.type.startsWith('image/') ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={att.url}
                          alt={att.name}
                          className="w-5 h-5 rounded object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded bg-surface-subtle flex items-center justify-center shrink-0 text-[8px] text-content-secondary">
                          {att.type.split('/')[1]?.toUpperCase().slice(0, 3) || 'FILE'}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-content-primary truncate">
                          {att.name}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          const removed = attachments[idx]
                          setAttachments((prev) => prev.filter((_, i) => i !== idx))
                          // 移除未发送的附件时同步删除服务端文件
                          if (removed) deleteUploadedFile(removed.url)
                        }}
                        className="shrink-0 p-0.5 rounded-md opacity-0 show-on-touch group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500 transition-opacity"
                        aria-label="移除"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                key="welcome-multi"
                ref={textareaRef}
                value={input}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="输入问题..."
                rows={1}
                disabled={isLoading}
                className="block w-full bg-transparent text-sm text-content-primary placeholder:text-content-muted
                  resize-none focus:outline-none border-0 m-0 px-4 pt-4 pb-16 disabled:opacity-50"
                style={{
                  minHeight: '36px',
                  lineHeight: '24px',
                }}
                onInput={(e) => {
                  const target = e.currentTarget
                  target.style.height = 'auto'
                  target.style.height = `${target.scrollHeight}px`
                  setIsMultiline(target.scrollHeight > 38)
                }}
              />
              <div className="shrink-0 flex items-center justify-end px-3 py-2.5">
                <div className="flex items-center gap-1">
                  <ModelSelector
                    models={models}
                    selectedModel={selectedModel}
                    onModelChange={onModelChange}
                    deepThink={deepThink}
                    onDeepThinkChange={onDeepThinkChange}
                    webSearch={webSearch}
                    onWebSearchChange={onWebSearchChange}
                    webSearchAvailable={webSearchAvailable}
                  />
                  <button
                    onClick={handleSendDebounced}
                    disabled={(!input.trim() && attachments.length === 0) || isLoading}
                    aria-label="发送"
                    className={cn(
                      'shrink-0 flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-full transition-colors',
                      'active:scale-95 touch-manipulation',
                      (input.trim() || attachments.length > 0) && !isLoading
                        ? 'bg-accent text-white hover:bg-accent/90 animate-pop-in'
                        : 'bg-surface-subtle text-content-muted cursor-not-allowed'
                    )}
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    <ArrowUp className="w-[18px] h-[18px]" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 输入框下方胶囊行: 上传 / 对比统一入口(单行、多行态均可见) */}
          <div className="flex items-center justify-center gap-2 mt-3">
            <FileUpload
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              disabled={isLoading}
              hideAttachmentsPreview
              variant="pill"
            />
            {compareModeAvailable && onCompareModeChange && (
              <button
                onClick={() => onCompareModeChange(!compareMode)}
                disabled={isLoading}
                className={cn(
                  'hidden md:inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full border text-xs font-medium transition-colors shrink-0',
                  compareMode
                    ? 'bg-accent text-accent-foreground border-transparent'
                    : 'border-line bg-surface text-content-secondary hover:bg-surface-subtle hover:text-content-primary hover:border-line-strong',
                  isLoading && 'opacity-50 cursor-not-allowed'
                )}
                title="对比模式"
                aria-label="对比模式"
                aria-pressed={compareMode}
              >
                <Columns2 className="w-3.5 h-3.5" />
                对比
              </button>
            )}
            {/* 面具胶囊: 未使用时显示入口,使用中反色显示 avatar + 名称 */}
            {onMaskChange && (
              <div className="relative">
                <button
                  onClick={() => setMaskMenuOpen((v) => !v)}
                  className={cn(
                    'inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-medium transition-colors shrink-0',
                    mask
                      ? 'bg-accent text-accent-foreground border border-transparent'
                      : 'border border-line bg-surface text-content-secondary hover:bg-surface-subtle hover:text-content-primary hover:border-line-strong'
                  )}
                  title={mask ? '当前面具,点击切换' : '选择面具'}
                  aria-label="选择面具"
                  aria-haspopup="menu"
                  aria-expanded={maskMenuOpen}
                >
                  {mask ? (
                    <>
                      <span aria-hidden>{mask.avatar}</span>
                      <span className="max-w-[96px] truncate">{mask.name}</span>
                    </>
                  ) : (
                    <>
                      <Drama className="w-3.5 h-3.5" aria-hidden />
                      面具
                    </>
                  )}
                </button>
                {maskMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMaskMenuOpen(false)} />
                    <div
                      className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 w-64 max-h-80 overflow-y-auto
                        rounded-xl border border-line bg-surface shadow-lg py-1.5"
                      role="menu"
                    >
                      <MaskPickerMenu
                        activeMaskId={mask?.id ?? null}
                        userMasks={userMasks}
                        onSelect={(id) => { onMaskChange(id); setMaskMenuOpen(false) }}
                        onManage={() => { onManageMasks?.(); setMaskMenuOpen(false) }}
                        onClear={() => { onMaskChange(null); setMaskMenuOpen(false) }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ============= STANDARD VARIANT =============
  return (
    // 底部 padding = 0.5rem 基础间距 + 软键盘高度。
    // useVisualViewport hook 会把键盘高度写入 --keyboard-height(桌面上始终 0px)。
    <div
      className={cn('relative z-20 px-3 pt-1', className)}
      style={{
        paddingBottom: 'calc(0.5rem + var(--keyboard-height, 0px))',
      }}
    >
      <div className="max-w-2xl mx-auto">
      {/* 「接着说」横幅 —— 在输入框正上方 */}
      {pendingContinuationExists && onContinue && onDismissContinuation && (
        <div className="mb-1.5">
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 px-3 py-2 rounded-lg
              bg-amber-50/80 dark:bg-amber-950/30
              border border-amber-200/70 dark:border-amber-800/50
              backdrop-blur-sm shadow-sm"
          >
            <Play className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-xs text-amber-700 dark:text-amber-300 flex-1 min-w-0 truncate">
              模型在上次中断的位置停了下来
            </span>
            <button
              onClick={onContinue}
              className="shrink-0 px-2.5 py-1 rounded-md text-xs font-medium
                bg-amber-500 text-white hover:bg-amber-600
                active:scale-95 transition-all"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              接着说
            </button>
            <button
              onClick={onDismissContinuation}
              className="shrink-0 p-0.5 rounded text-amber-600/70 dark:text-amber-400/70 hover:text-amber-700 hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors"
              aria-label="关闭提示"
              title="不再提示"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 引用回复横幅 */}
      {replyingTo && (
        <div className="mb-1.5">
          <div
            role="status"
            className="flex items-center gap-2 px-3 py-2 rounded-lg
              bg-blue-50/80 dark:bg-blue-950/30
              border border-blue-200/70 dark:border-blue-800/50
              backdrop-blur-sm shadow-sm"
          >
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-blue-600/70 dark:text-blue-400/70 font-medium mb-0.5">
                回复 {replyingTo.role === 'user' ? '用户' : 'AI'}
              </div>
              <div className="text-xs text-blue-700 dark:text-blue-300 truncate">
                {replyingTo.text}
              </div>
            </div>
            <button
              onClick={() => setReplyingTo(null)}
              className="shrink-0 p-0.5 rounded text-blue-600/70 dark:text-blue-400/70 hover:text-blue-700 hover:bg-blue-100/50 dark:hover:bg-blue-900/30 transition-colors"
              aria-label="取消引用"
              title="取消引用"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div
        className={cn(
          'relative flex flex-col rounded-xl border z-20',
          'border-line/60',
          'bg-surface-glass backdrop-blur-xl',
          'shadow-lg focus-within:border-line-strong',
          'transition-all'
        )}
      >
          {/* Attachments preview row */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              {attachments.map((att, idx) => (
                <div
                  key={att.url + idx}
                  className={cn(
                    'group flex items-center gap-2 rounded-lg border',
                    'border-line bg-surface-muted',
                    'px-2 py-1.5 w-full sm:max-w-[200px] sm:w-auto'
                  )}
                >
                  {att.type.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={att.url} alt={att.name} className="w-5 h-5 rounded object-cover shrink-0" />
                  ) : (
                    <div className="w-5 h-5 rounded bg-surface-subtle flex items-center justify-center shrink-0 text-[8px] text-content-secondary">
                      {att.type.split('/')[1]?.toUpperCase().slice(0, 3) || 'FILE'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-content-primary truncate">{att.name}</p>
                  </div>
                  <button
                    onClick={() => {
                      const removed = attachments[idx]
                      setAttachments((prev) => prev.filter((_, i) => i !== idx))
                      // 移除未发送的附件时同步删除服务端文件
                      if (removed) deleteUploadedFile(removed.url)
                    }}
                    className="shrink-0 p-0.5 rounded-md opacity-0 show-on-touch group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500 transition-opacity"
                    aria-label="移除"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 发送前校验错误提示 */}
          {sendError && (
            <div className="flex items-start gap-1.5 px-4 pt-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-500 leading-relaxed flex-1 min-w-0">{sendError}</p>
              <button
                onClick={() => setSendError(null)}
                className="shrink-0 p-0.5 rounded text-content-muted hover:text-content-primary transition-colors"
                aria-label="关闭提示"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* 草稿已恢复提示 —— 进入会话时短暂浮现,可手动关闭 */}
          {draftRestored && input.trim() && (
            <div className="flex items-center gap-1.5 px-4 pt-2 text-content-muted">
              <FileText className="w-3.5 h-3.5 shrink-0" />
              <span className="text-[11px] flex-1 min-w-0">已恢复上次未发送的内容</span>
              <button
                onClick={() => {
                  setInput('')
                  setDraftRestored(false)
                }}
                className="shrink-0 text-[11px] text-content-secondary hover:text-content-primary underline-offset-2 hover:underline"
                aria-label="清除草稿"
              >
                清除
              </button>
            </div>
          )}

          {/* Textarea */}
          <div className="px-4 pt-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="输入消息..."
              disabled={isLoading}
              rows={1}
              className={cn(
                'w-full resize-none bg-transparent text-sm',
                'text-content-primary',
                'placeholder:text-content-muted',
                'focus:outline-none disabled:opacity-50',
                'min-h-[24px] max-h-[200px]'
              )}
            />
          </div>

          {/* 对比模式: 多模型选择行(移动端隐藏) */}
          {compareMode && compareModels && onCompareModelsChange && (
            <div className="hidden md:flex items-center justify-end gap-1 px-3 pt-1.5">
              {compareModels.map((modelId, index) => (
                <div key={modelId} className="flex items-center gap-0.5">
                  <ModelSelector
                    models={models}
                    selectedModel={modelId}
                    onModelChange={(id) => handleCompareModelChange(index, id)}
                    compact
                    deepThink={deepThink}
                    onDeepThinkChange={onDeepThinkChange}
                    webSearch={webSearch}
                    onWebSearchChange={onWebSearchChange}
                    webSearchAvailable={webSearchAvailable}
                  />
                  {compareModels.length > 2 && (
                    <button
                      onClick={() => handleRemoveCompareModel(index)}
                      className="shrink-0 p-1 rounded-md text-content-muted hover:text-red-500 hover:bg-surface-subtle transition-colors"
                      aria-label="移除模型"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              ))}
              {compareModels.length < 3 && (
                <button
                  onClick={handleAddCompareModel}
                  className="flex items-center gap-0.5 h-7 px-2 rounded-full text-[11px] font-medium
                    border border-dashed border-line text-content-secondary
                    hover:bg-surface-subtle transition-colors shrink-0"
                  title="添加对比模型"
                  aria-label="添加对比模型"
                >
                  <Plus className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Bottom controls row */}
          <div className="flex items-center justify-between px-3 pb-2 pt-1.5">
            {/* Left: attachment + compare mode toggle */}
            <div className="flex items-center gap-1">
              <FileUpload
                attachments={attachments}
                onAttachmentsChange={setAttachments}
                disabled={isLoading}
                hideAttachmentsPreview
              />
              {compareModeAvailable && onCompareModeChange && (
                <button
                  onClick={() => onCompareModeChange(!compareMode)}
                  disabled={isLoading}
                  className={cn(
                    'hidden md:inline-flex items-center h-7 px-2.5 rounded-full text-[11px] font-medium transition-colors',
                    compareMode
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-surface-muted hover:bg-surface-subtle text-content-secondary',
                    isLoading && 'opacity-50 cursor-not-allowed'
                  )}
                  title="对比模式"
                  aria-label="对比模式"
                  aria-pressed={compareMode}
                >
                  对比
                </button>
              )}
            </div>

            {/* Right: model selector + send button */}
            <div className="flex items-center gap-1">
              {!compareMode && (
                <ModelSelector
                  models={models}
                  selectedModel={selectedModel}
                  onModelChange={onModelChange}
                  compact
                  deepThink={deepThink}
                  onDeepThinkChange={onDeepThinkChange}
                  webSearch={webSearch}
                  onWebSearchChange={onWebSearchChange}
                  webSearchAvailable={webSearchAvailable}
                />
              )}
              {isLoading ? (
                <button
                  onClick={onStop}
                  className={cn(
                    // 移动端 ≥44px 触控,桌面端 28px
                    'h-7 w-7 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center rounded-full transition-colors shrink-0',
                    'bg-accent text-accent-foreground hover:bg-accent-hover'
                  )}
                  aria-label="停止生成"
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={handleSendDebounced}
                  disabled={!input.trim() && attachments.length === 0}
                  className={cn(
                    'h-7 w-7 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center rounded-full transition-colors shrink-0',
                    'active:scale-95 touch-manipulation',
                    (input.trim() || attachments.length > 0)
                      ? 'bg-accent text-accent-foreground hover:bg-accent-hover'
                      : 'bg-surface-muted text-content-muted cursor-not-allowed'
                  )}
                  aria-label="发送消息"
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
