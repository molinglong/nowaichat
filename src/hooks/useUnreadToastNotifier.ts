'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useChatStore } from '@/store/chat-store'
import { toast } from '@/lib/toast'

export interface UnreadNotifierConversation {
  id: string
  title: string
  updatedAt: string
}

/**
 * 监听会话列表 + lastReadAt,在某个会话从"已读"变"未读"时弹一个可点击的 toast。
 *
 * 触发条件:
 *  - lastMessageAt > lastReadAt[id]  (语义"未读")
 *  - 当前不在那个会话 (用户在别处)
 *  - 这条消息之前没通知过 (用 notifiedRef 记录上次已通知的 lastMessageAt)
 *  - 该会话已被 markConversationRead 过至少一次 (否则进入保护期,首启一片蓝)
 */
export function useUnreadToastNotifier(
  conversations: UnreadNotifierConversation[]
) {
  const router = useRouter()
  const lastReadAt = useChatStore((s) => s.lastReadAt)
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  // lastNotifiedAt[id] = 上一次 toast 时该会话的 lastMessageAt
  const lastNotifiedAtRef = useRef<Record<string, number>>({})

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (conversations.length === 0) return

    for (const conv of conversations) {
      const id = conv.id
      // 当前正在看的会话不发 toast,避免自弹自
      if (id === currentConversationId) continue

      const lastMessageAt = new Date(conv.updatedAt).getTime()
      const readAt = lastReadAt[id]

      // 未读过(保护期)或不是未读: 跳过
      if (typeof readAt !== 'number') continue
      if (lastMessageAt <= readAt) continue

      // 已经对这条消息通知过: 跳过
      const alreadyNotified = lastNotifiedAtRef.current[id]
      if (alreadyNotified === lastMessageAt) continue

      // 标记并 toast
      lastNotifiedAtRef.current[id] = lastMessageAt

      const title = conv.title?.trim() || '新对话'
      void toast.info(`「${title}」有新回复,点击查看`, {
        title: '新消息',
        position: 'bottomRight',
        timeout: 6000,
        onClick: (hide) => {
          hide()
          router.push(`/chat/c/${id}`)
        },
      })
    }
  }, [conversations, lastReadAt, currentConversationId, router])
}
