'use client'

import { cn } from '@/lib/utils'

/**
 * 通用骨架屏原子组件。
 * 复用 Tailwind 的 animate-pulse + 圆角色块,匹配应用实际配色。
 * 用 div 而非 span 是为了能用任意宽高组合。
 */

type SkeletonProps = {
  className?: string
  /** 是否用圆形(消息头像等) */
  rounded?: 'full' | 'md' | 'lg' | 'sm'
}

export function Skeleton({ className, rounded = 'md' }: SkeletonProps) {
  const r =
    rounded === 'full'
      ? 'rounded-full'
      : rounded === 'lg'
        ? 'rounded-lg'
        : rounded === 'sm'
          ? 'rounded-sm'
          : 'rounded-md'
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse bg-surface-muted', r, className)}
    />
  )
}

/**
 * 单条消息气泡骨架——消息头部 + 多行内容占位。
 */
export function MessageBubbleSkeleton({ align = 'left' }: { align?: 'left' | 'right' }) {
  const isUser = align === 'right'
  return (
    <div className={cn('flex gap-3 px-4 py-3', isUser && 'flex-row-reverse')}>
      <Skeleton rounded="full" className="w-8 h-8 shrink-0" />
      <div className={cn('flex flex-col gap-1.5 max-w-[80%]', isUser && 'items-end')}>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  )
}

/**
 * 完整聊天区骨架:顶部一条占位 + 5 条消息占位 + 底部输入框占位。
 * 用于 /chat 和 /chat/c/[id] 的路由级 loading。
 */
export function ChatPanelSkeleton() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar 占位(模仿 TopBar 的布局) */}
      <div className="px-4 py-3 border-b border-line/40 flex items-center gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-40 ml-2" />
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto py-4">
          {/* 头几条交替的左右气泡(模拟首屏) */}
          <MessageBubbleSkeleton align="left" />
          <MessageBubbleSkeleton align="right" />
          <MessageBubbleSkeleton align="left" />
          <MessageBubbleSkeleton align="right" />
          <MessageBubbleSkeleton align="left" />
          <MessageBubbleSkeleton align="right" />
        </div>
      </div>
      {/* 输入区 */}
      <div className="border-t border-line/40 px-4 py-3">
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  )
}

/**
 * 列表网格骨架:用于 /images 的画廊视图加载占位。
 */
export function GridSkeleton({ cols = 4, rows = 3 }: { cols?: number; rows?: number }) {
  return (
    <div
      className="grid gap-3"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: cols * rows }).map((_, i) => (
        <Skeleton key={i} rounded="lg" className="aspect-square w-full" />
      ))}
    </div>
  )
}

/**
 * 探索页骨架:左侧辩题区 + 右侧泳道占位。
 */
export function ExploreSkeleton() {
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-line/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton rounded="full" className="w-4 h-4" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-16" />
        </div>
      </div>
      <div className="flex-1 grid md:grid-cols-[40%_1fr] min-h-0">
        <div className="border-r border-line/40 p-4 space-y-3">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="p-4 space-y-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  )
}
