'use client'

import type { LucideIcon } from 'lucide-react'

/**
 * 方案 C 功能页页头(≤md,md:hidden):毛玻璃徽章 + 22px 标题 + 副标题,
 * 顶部留白 92px 让开悬浮圆钮(圆钮 y≈56-96)。壁纸在场上时标题走白字
 * (见 globals.css 的 .m-work-title/.m-work-sub 门控)。
 */
export function MobileWorkHead({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon
  title: string
  subtitle: string
}) {
  return (
    <div className="md:hidden shrink-0 px-6 pt-[92px]">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-10 w-10 flex-none items-center justify-center rounded-[13px] border border-white/50"
          style={{ background: 'rgb(255 255 255 / 0.30)', WebkitBackdropFilter: 'blur(14px)', backdropFilter: 'blur(14px)' }}
        >
          <Icon className="h-5 w-5 text-white" />
        </span>
        <h2 className="m-work-title text-[22px] font-semibold tracking-[0.02em]">{title}</h2>
      </div>
      <p className="m-work-sub mt-1.5 text-xs">{subtitle}</p>
    </div>
  )
}
