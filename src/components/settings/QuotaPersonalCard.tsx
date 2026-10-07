'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, TicketPercent } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtTokens } from './quota-format'

type QuotaMe = {
  dayKey: string
  ephemeral: boolean
  unlimited: boolean
  todayTokens: number
  dailyLimit: number | null
  remaining: number | null
  bonusRemaining: number
}

/**
 * 设置→用量统计顶部的「今日公共额度」卡:本人当日已用/日限/剩余 + 激活码附加余额
 * 与兑换入口。附加余额跨天存续,日限触顶后自动续烧;临时访客不显示兑换行。
 */
export default function QuotaPersonalCard() {
  const [data, setData] = useState<QuotaMe | null>(null)
  const [failed, setFailed] = useState(false)
  const [code, setCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemMsg, setRedeemMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(() => {
    fetch('/api/quota/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: QuotaMe) => setData(d))
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const redeem = async () => {
    const c = code.trim()
    if (!c || redeeming) return
    setRedeeming(true)
    setRedeemMsg(null)
    try {
      const res = await fetch('/api/quota/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: c }),
      })
      const j = await res.json().catch(() => null)
      if (res.ok && j?.ok) {
        setRedeemMsg({ ok: true, text: `兑换成功，到账 ${fmtTokens(j.tokens)} 附加余额` })
        setCode('')
        load()
      } else {
        setRedeemMsg({ ok: false, text: j?.error || `兑换失败（${res.status}）` })
      }
    } catch {
      setRedeemMsg({ ok: false, text: '网络异常，请稍后重试' })
    } finally {
      setRedeeming(false)
    }
  }

  if (failed) return null
  if (!data) {
    return (
      <div className="flex items-center justify-center py-4 text-content-muted">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      </div>
    )
  }

  // 池未初始化(迁移未跑):无额度概念,整卡隐藏。管理员 unlimited 时 dailyLimit 也是
  // null,但卡要照常显示(已用量 + 管理员不限标识)
  if (data.dailyLimit === null && !data.unlimited) return null

  const usedPct = data.dailyLimit
    ? Math.min(100, Math.round((data.todayTokens / data.dailyLimit) * 100))
    : 0

  return (
    <div className="rounded-xl border border-line/60 bg-surface/60 px-4 py-3.5 space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-content-secondary">
          今日公共额度{data.ephemeral ? '（访客档）' : ''}
        </span>
        {!data.unlimited && (
          <span className="text-[12px] text-content-muted tabular-nums">
            剩余 {fmtTokens(data.remaining ?? 0)}
          </span>
        )}
      </div>
      {!data.unlimited && (
        <div className="h-1.5 rounded-full bg-surface-muted overflow-hidden">
          <div
            className={cn('h-full rounded-full bg-accent transition-all', usedPct >= 90 && 'bg-red-400')}
            style={{ width: `${Math.max(usedPct, 1)}%` }}
          />
        </div>
      )}
      <div className="flex justify-between text-[10.5px] text-content-muted tabular-nums">
        <span>已用 {fmtTokens(data.todayTokens)}</span>
        <span>
          {data.unlimited
            ? '管理员 · 日限不限'
            : data.dailyLimit === null
              ? '日限 不限'
              : `日限 ${fmtTokens(data.dailyLimit)}`}
        </span>
      </div>
      {data.bonusRemaining > 0 && (
        <p className="text-[10.5px] text-content-muted tabular-nums">
          附加余额 {fmtTokens(data.bonusRemaining)}（日限触顶后自动续烧，跨天有效）
        </p>
      )}
      {!data.ephemeral && (
        <div className="space-y-1.5 pt-0.5">
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void redeem()
              }}
              placeholder="输入激活码兑换更多额度"
              maxLength={20}
              className="min-w-0 flex-1 rounded-lg border border-line/60 bg-surface px-2.5 py-1.5 text-[12px] text-content-primary uppercase placeholder:text-content-muted placeholder:normal-case focus:outline-none focus:ring-1 focus:ring-accent/50"
              aria-label="激活码"
            />
            <button
              onClick={() => void redeem()}
              disabled={redeeming || !code.trim()}
              className={cn(
                'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors shrink-0',
                !redeeming && code.trim()
                  ? 'bg-accent text-accent-foreground hover:bg-accent-hover'
                  : 'bg-surface-muted text-content-muted cursor-not-allowed'
              )}
            >
              {redeeming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TicketPercent className="w-3.5 h-3.5" />}
              兑换
            </button>
          </div>
          {redeemMsg && (
            <p className={cn('text-[10.5px]', redeemMsg.ok ? 'text-emerald-600' : 'text-red-600')}>{redeemMsg.text}</p>
          )}
        </div>
      )}
    </div>
  )
}
