'use client'

import { useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useChatStore } from '@/store/chat-store'

/**
 * 统一的「开新对话」入口 —— Sidebar 与 TopBar 共用。
 *
 * 为什么不能只 router.push('/chat'):
 *
 * 1. 新对话发出首条消息后,ChatPanel 用 window.history.replaceState 把
 *    URL 改写成 /chat/c/{id}(React tree 仍是 chat/page.tsx)。此后点击
 *    「新对话」,Next.js 比较目标 page 与当前 page 是同一个组件引用,
 *    直接复用现有子树 —— ChatPanel 不重挂载,旧消息原样停留。
 *
 * 2. URL 已经是 /chat 时,push('/chat') 是 no-op,连复用都不触发,
 *    表现为「按钮按下没反应」。
 *
 * 因此用显式的重置信号兜底:
 * - 清掉 store 里的会话残留(currentConversationId / conversationTitle /
 *   引用回复 / 继续横幅 / 键盘选中),Sidebar 高亮与 TopBar 标题立即归位;
 * - bump newChatNonce 让 chat/page.tsx 的 ChatPanel key 变化强制重挂载;
 * - 仅当不在 /chat 时才真正 push,避免 no-op。
 */
export function useStartNewChat() {
  const router = useRouter()
  const pathname = usePathname()

  return useCallback(() => {
    const store = useChatStore.getState()
    store.setCurrentConversationId(null)
    store.setConversationTitle(null)
    store.setReplyingTo?.(null)
    store.setPendingContinuation?.(null)
    store.setFocusedMessageId?.(null)
    // ?. 防御 dev HMR 中间态:热更新后旧 store 实例可能没有新方法,
    // 抛错会中断 onClick 链,让按钮彻底无响应 —— 那正是本函数要消灭的症状
    store.bumpNewChatNonce?.()
    if (pathname !== '/chat') {
      router.push('/chat')
    }
  }, [router, pathname])
}
