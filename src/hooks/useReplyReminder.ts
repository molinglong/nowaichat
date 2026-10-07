'use client'

import { useEffect, useRef } from 'react'
import { tauri } from '@/lib/tauri'

/**
 * 安卓壳的「预约式回复提醒」:生成开始挂闹钟,生成结束/人回来了撤闹钟。
 *
 * 为什么不是「完成时发通知」:切后台会同时 Rust.pause() + WebView.onPause(),
 * JS 被冻住 —— 人一走流就停在半路,前端永远等不到「完成」那一刻。所以只能在
 * 发信那一刻(此时 JS 必然还活着)先把定时通知预约给系统 AlarmManager。
 *
 * 三个收口:
 *   - 生成结束(在前台看着它跑完)→ 撤,不留一条催空话的闹钟
 *   - 回到前台且仍在生成 → 重新预约一整段时长,人刚回来就催一次太急;
 *     同 id 重排会覆盖旧闹钟(插件用 FLAG_CANCEL_CURRENT),不会攒出两条
 *   - 回到前台且已结束 → useBackgroundStreamWatcher 那条完成路径已经撤过,
 *     这里再撤一次是幂等的(cancel 对不存在的 id 是 no-op)
 *
 * 只在安卓壳生效:桌面端最小化不会冻 JS(现有 notifyReplyDone 就够用),
 * 挂上定时通知反而会重复催;浏览器页签里 isAndroidShell() 恒为 false。
 */
export function useReplyReminder(generating: boolean) {
  const generatingRef = useRef(generating)
  generatingRef.current = generating
  const prevGenerating = useRef(false)

  // 上升沿预约、下降沿撤销。用 isLoading 而不是 status:
  // 它把「远端仍在生成(轮询续显)」也算进来,那条路径同样要催。
  useEffect(() => {
    const prev = prevGenerating.current
    prevGenerating.current = generating
    if (generating && !prev) void tauri.armReplyReminder()
    if (!generating && prev) void tauri.cancelReplyReminder()
  }, [generating])

  // 回到前台:提醒的目的(把人叫回来)已经达成或需要重新计时
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (generatingRef.current) {
        void tauri.armReplyReminder()
      } else {
        void tauri.cancelReplyReminder()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
}
