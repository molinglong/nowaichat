import { Skeleton } from '@/components/ui/Skeleton'

/**
 * (app) 路由组顶层过渡占位。
 *
 * 跨 tab 导航(如 /chat → /images)时,此前各 tab 的 loading.tsx 被
 * 埋在各自 async layout 的内部边界里,新 layout resolve 完成前
 * 没有任何 fallback 可显示,表现为"点击后旧页面原样停留、无反馈"。
 * 现在共享 layout 常驻挂载,这个边界在 children 替换的瞬间就生效:
 * 目标页 chunk/RSC 未就绪时立刻给出骨架反馈。
 */
export default function AppLoading() {
  return (
    <div className="h-full flex flex-col px-4 py-3">
      {/* 模拟顶栏标题区 */}
      <div className="flex items-center gap-2 shrink-0 h-6">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3.5 w-14 ml-auto" />
      </div>
      {/* 模拟内容区 */}
      <div className="flex-1 min-h-0 pt-3 space-y-3 overflow-hidden">
        <Skeleton className="h-9 w-full" rounded="lg" />
        <Skeleton className="h-9 w-4/5" rounded="lg" />
        <Skeleton className="h-9 w-3/5" rounded="lg" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} rounded="lg" className="h-16" />
          ))}
        </div>
      </div>
    </div>
  )
}
