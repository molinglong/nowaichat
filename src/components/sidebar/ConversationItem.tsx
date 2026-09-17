'use client'

import { useState, useRef, useEffect, KeyboardEvent, memo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Trash2, Pencil, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat-store'
import { useSingleFlight } from '@/hooks/useSingleFlight'
import { isUnread } from '@/lib/last-read'

interface ConversationItemProps {
  id: string
  title: string
  mode?: string
  /** 会话面具徽标（头像 emoji）；无面具 / 面具已删时不传，不显示 */
  maskAvatar?: string | null
  /** 面具名，用于 hover 提示 */
  maskName?: string | null
  /** 列表中的索引,用于逐个淡入的错峰延迟 */
  index?: number
  /** 该会话最后一条消息时间(ms 数字).来自会话的 updatedAt. */
  lastMessageAt?: number
  onDelete?: (id: string) => void
  onRename?: (id: string, newTitle: string) => void
}

/** 逐个加载: 索引错峰延迟,超过 15 个后封顶 300ms 避免等待过久 */
const STAGGER_STEP_MS = 20
const STAGGER_MAX_INDEX = 15

function ConversationItemInner({ id, title, mode, maskAvatar, maskName, index = 0, lastMessageAt, onDelete, onRename }: ConversationItemProps) {
  const staggerDelay = Math.min(index, STAGGER_MAX_INDEX) * STAGGER_STEP_MS
  const pathname = usePathname()
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const lastReadAt = useChatStore((s) => s.lastReadAt)
  // Fall back to the store because after the first message of a new chat the URL
  // is rewritten via history.replaceState, so usePathname() still returns /chat
  const isActive = pathname === `/chat/c/${id}` || currentConversationId === id
  // 未读判断:活跃会话不显示蓝点,否则按 lastMessageAt vs lastReadAt
  const showUnreadDot =
    !isActive &&
    typeof lastMessageAt === 'number' &&
    isUnread(id, lastMessageAt, lastReadAt)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus and select all text when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // Reset edit value when title changes externally
  useEffect(() => {
    setEditValue(title)
  }, [title])

  function startEditing(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setEditValue(title)
    setIsEditing(true)
  }

  const startEditingDebounced = useSingleFlight(startEditing, [title])

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (onDelete) {
      onDelete(id)
    }
  }

  const handleDeleteDebounced = useSingleFlight(handleDelete, [id, onDelete])

  function cancelEditing() {
    setEditValue(title)
    setIsEditing(false)
  }

  function commitRename() {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== title && onRename) {
      onRename(id, trimmed)
    } else {
      setEditValue(title)
    }
    setIsEditing(false)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEditing()
    }
  }

  // Edit mode: inline input
  if (isEditing) {
    return (
      <div className="flex items-center gap-1 px-1 py-0.5 rounded-lg bg-accent-soft">
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitRename}
          className="flex-1 min-w-0 bg-transparent text-sm text-content-primary outline-none px-1.5 py-1"
          placeholder="对话标题"
          maxLength={200}
        />
        <button
          onMouseDown={(e) => { e.preventDefault(); commitRename() }}
          className="p-0.5 rounded-md hover:bg-surface-subtle text-green-500 transition-colors"
          aria-label="确认"
        >
          <Check className="w-3 h-3" />
        </button>
        <button
          onMouseDown={(e) => { e.preventDefault(); cancelEditing() }}
          className="p-0.5 rounded-md hover:bg-surface-subtle text-red-500 transition-colors"
          aria-label="取消"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    )
  }

  // Normal mode: link with title + action buttons
  return (
    <Link
      href={`/chat/c/${id}`}
      style={{ animationDelay: `${staggerDelay}ms` }}
      className={cn(
        'sidebar-item-enter group flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors',
        isActive
          ? 'bg-accent-soft text-content-primary font-medium'
          : 'text-content-secondary hover:bg-surface-subtle/60 hover:text-content-primary'
      )}
    >
      {showUnreadDot && (
        <span
          aria-label="未读"
          title="有未读消息"
          className="shrink-0 w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400
            shadow-[0_0_8px_rgba(59,130,246,0.75)] animate-pulse"
          style={{ animationDuration: '2.4s' }}
        />
      )}
      <span className="flex-1 truncate">{title}</span>
      {maskAvatar && (
        <span
          className="shrink-0 text-xs leading-none"
          title={maskName ? `面具：${maskName}` : undefined}
          aria-label={maskName ? `面具：${maskName}` : undefined}
        >
          {maskAvatar}
        </span>
      )}
      {mode === 'compare' && (
        <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-accent-soft text-content-secondary font-medium">
          对比
        </span>
      )}
      {onRename && (
        <button
          onClick={startEditingDebounced}
          className="opacity-0 show-on-touch group-hover:opacity-100 p-0.5 rounded-md hover:bg-surface-subtle hover:text-content-primary transition-opacity active:scale-95 touch-manipulation"
          aria-label="重命名"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
      {onDelete && (
        <button
          onClick={handleDeleteDebounced}
          className="opacity-0 show-on-touch group-hover:opacity-100 p-0.5 rounded-md hover:bg-surface-subtle hover:text-red-500 dark:hover:text-red-400 transition-opacity active:scale-95 touch-manipulation"
          aria-label="删除对话"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </Link>
  )
}

/**
 * 对比函数: id / title / mode / 回调引用相同则跳过重渲
 * - pathname 在父级触发 ConversationItem 列表重渲时也会变(来自 usePathname),
 *   但 active 状态是派生,只要父级 currentConversationId 不变即可
 * - currentConversationId 来自 store,但 memo 不会订阅 store —— 这里只比较自身 props
 */
function areConversationItemPropsEqual(
  prev: Readonly<ConversationItemProps>,
  next: Readonly<ConversationItemProps>
): boolean {
  if (prev.id !== next.id) return false
  if (prev.title !== next.title) return false
  if (prev.mode !== next.mode) return false
  if (prev.maskAvatar !== next.maskAvatar) return false
  if (prev.maskName !== next.maskName) return false
  if (prev.index !== next.index) return false
  if (prev.lastMessageAt !== next.lastMessageAt) return false
  if (prev.onDelete !== next.onDelete) return false
  if (prev.onRename !== next.onRename) return false
  return true
}

/**
 * Memoized ConversationItem —— 会话列表 100+ 项时,
 * 切换一个会话不会让其他 99 项重渲(它们只是 props 引用相同)。
 */
export const ConversationItem = memo(ConversationItemInner, areConversationItemPropsEqual)
