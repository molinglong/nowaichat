import { ChatPanelSkeleton } from '@/components/ui/Skeleton'

/**
 * /chat 和 /chat/c/[id] 共用 loading 占位。
 *
 * Next.js 14 App Router 里,当用户的导航涉及到 Server Component 重新执行时
 * (例如冷启 /chat),这个文件会在 server 端被渲染;当导航只涉及 Client Component
 * (例如切换会话 /chat/c/<id>),Next.js 也会自动展示它来填入过渡阶段。
 *
 * 现在切会话时不再直接显示空白 → 显示 ChatPanelSkeleton,再等客户端数据 hydrate
 * (最常见的场景是缓存命中秒开,根本看不到这个骨架屏)。
 */
export default function ChatLoading() {
  return <ChatPanelSkeleton />
}
