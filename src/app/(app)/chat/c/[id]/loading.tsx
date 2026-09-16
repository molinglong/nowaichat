import { ChatPanelSkeleton } from '@/components/ui/Skeleton'

/**
 * /chat/c/[id] 路由的过渡占位。Next.js 14 会自动捕获这个 page.tsx 的数据
 * 加载阶段作为 Suspense fallback 渲染——即使 /chat/c/[id] 是 client component,
 * 也能用上路由级 streaming 友好的 loading 占位。
 */
export default function ConversationLoading() {
  return <ChatPanelSkeleton />
}
