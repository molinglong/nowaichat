'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { RefreshCw, Sparkles, X } from 'lucide-react'
import {
  PROBE_SNOOZE_KEY_PREFIX,
  applicableProbeFields,
  pendingProbeFields,
  probeFieldLabel,
  probeHit,
  probeSnoozed,
  describeHits,
} from '@/lib/profile/probe'
import { toast } from '@/lib/toast'
import { PickButton, ProfileProbeDialog, type ProfileRow } from '@/components/profile/ProfileProbeDialog'

/**
 * 通用档案的对话式采集（波2）在聊天页的挂载层。
 *
 * 分工定案：填写/修改只有 ProfileProbeDialog 那一个弹窗，本组件不再复刻它的状态机，
 * 只负责三件事——首启横幅、换学年三选卡、采完之后那张收口卡。
 *
 * 采集气泡不落库：写进会话历史会把填表问答混进搜索、统计和上下文预算，
 * 而这些话对后续对话没有价值。
 */

interface ProfilePayload {
  profile: ProfileRow
  derived: { kind: string; stage: string | null; note: string } | null
  refresh: { due: boolean; reason: string | null }
}

interface ProfileProbeProps {
  /** 输入框里最近一条用户消息，用于「打字也算回答 + 一发正题立刻让位」 */
  lastUserText: string
  /** 学习模式等场景不弹采集 */
  disabled?: boolean
  /** 主动打扰（首启横幅 / 换学年三选卡）只在新对话页开；进了具体会话就闭嘴。
   *  会话内那份挂点仍要留，因为它跑着「正题进来先停采集 + 顺手抽取」的兜底逻辑。 */
  allowPromo?: boolean
}

export function ProfileProbe({ lastUserText, disabled, allowPromo = true }: ProfileProbeProps) {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const ephemeral = session?.ephemeral === true

  const [payload, setPayload] = useState<ProfilePayload | null>(null)
  const [snoozed, setSnoozed] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'probing' | 'done'>('idle')
  const [review, setReview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [customText, setCustomText] = useState('')

  const fields = payload?.profile.fields ?? {}

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/profiles', { cache: 'no-store' })
      // 401/403（未登录、临时模式）都让 payload 为空，整套 UI 自然不出现
      setPayload(res.ok ? ((await res.json()) as ProfilePayload) : null)
    } catch {
      setPayload(null)
    }
  }, [])

  useEffect(() => {
    if (!userId || ephemeral || disabled) {
      setPayload(null)
      return
    }
    void reload()
  }, [userId, ephemeral, disabled, reload])

  useEffect(() => {
    if (!userId) return
    const raw = Number(window.localStorage.getItem(`${PROBE_SNOOZE_KEY_PREFIX}${userId}`) || '0')
    setSnoozed(probeSnoozed(raw || null, Date.now()))
  }, [userId])

  /** 弹窗每落一次库回传档案行：横幅/收口卡的档位计数才不会是改之前的 */
  const mergeProfile = useCallback(
    (row: ProfileRow) => setPayload((prev) => (prev ? { ...prev, profile: row } : prev)),
    []
  )

  const startProbe = useCallback(() => {
    setReview(false)
    setPhase('probing')
  }, [])

  /** 到期复核：已答的几维重新上架，逐条过 */
  const reviewProbe = useCallback(() => {
    setReview(true)
    setPhase('probing')
  }, [])

  const confirmStage = useCallback(
    async (stage: string) => {
      setSaving(true)
      try {
        const res = await fetch('/api/profiles', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'confirm', stage }),
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null
          toast.error(data?.error || '没存住，稍后再试', { title: '用户档案' })
          return false
        }
        await reload()
        return true
      } finally {
        setSaving(false)
      }
    },
    [reload]
  )

  /** 「情况不一样，我自己说」：档案只存档位，特殊情况进记忆流每轮注入，学段不动 */
  const keepAside = useCallback(async () => {
    const text = customText.trim()
    if (text.length < 4) return
    const kept = await confirmStage(fields.stage ?? '')
    if (!kept) return
    if (text) {
      await fetch('/api/memories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: 'user_info', content: text.slice(0, 200) }),
      }).catch(() => null)
    }
    setCustomOpen(false)
    setCustomText('')
    toast.success('这句记进记忆里了，档案的学段没动', { title: '用户档案' })
  }, [customText, confirmStage, fields.stage])

  const snooze = useCallback(() => {
    if (!userId) return
    window.localStorage.setItem(`${PROBE_SNOOZE_KEY_PREFIX}${userId}`, String(Date.now()))
    setSnoozed(true)
  }, [userId])

  if (!payload || disabled || ephemeral) return null

  // ---- 采集进行中：唯一的那个弹窗 ----
  if (phase === 'probing') {
    return (
      <ProfileProbeDialog
        initial={payload.profile}
        mode={review ? 'review' : 'fill'}
        lastUserText={lastUserText}
        onChange={mergeProfile}
        onClose={() => setPhase('done')}
      />
    )
  }

  // ---- 收口卡 ----
  if (phase === 'done') {
    const dims = applicableProbeFields(fields)
    const savedCount = dims.filter((id) => fields[id]).length
    return (
      <div className="px-3 pb-1.5" data-probe-done>
        <div className="mx-auto w-full max-w-2xl rounded-lg border border-line/60 bg-surface-muted text-xs">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-line/40 text-content-secondary">
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              先记到这儿，{savedCount} 条有了。剩下的聊到再说，我不追。
            </span>
            <button
              type="button"
              onClick={() => setPhase('idle')}
              className="shrink-0 inline-flex items-center justify-center w-9 min-h-[36px] rounded text-content-muted/70 transition-colors hover:text-content-primary"
              aria-label="收起"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-2.5 py-2 flex flex-col gap-1">
            {dims.map((id) => (
              <div key={id} className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-content-muted">{probeFieldLabel(id)}</span>
                <span className="min-w-0 truncate text-content-primary">
                  {fields[id] ? describeHits([probeHit(id, fields[id]!)]) : '没采'}
                </span>
              </div>
            ))}
          </div>
          <div className="px-2.5 pb-2.5 flex flex-wrap gap-1.5">
            {pendingProbeFields(fields).length > 0 && (
              <PickButton onClick={startProbe}>接着补 {pendingProbeFields(fields).length} 条</PickButton>
            )}
            <PickButton tone="ghost" onClick={() => setPhase('idle')}>
              收好，去聊天
            </PickButton>
          </div>
        </div>
      </div>
    )
  }

  // ---- 横幅 ----
  // allowPromo=false（会话内那一个挂载点）时整段静默：主动打扰只发生在欢迎页。
  // 上面 probing / done 两个分支已经提前 return，所以采集弹窗和收口卡不受影响。
  const remaining = pendingProbeFields(fields)
  const firstRun = !payload.profile.exists || Object.keys(fields).length === 0
  // 用户在用户中心主动关掉注入 = 明确表态，不再拿首启提示打扰
  const optedOut = payload.profile.exists && !payload.profile.enabled
  const derived = payload.derived
  const stageAdvance =
    derived && (derived.kind === 'advance' || derived.kind === 'graduate') ? derived : null
  const remind = payload.refresh.due
  const showSchoolYear =
    allowPromo && !optedOut && remind && !!stageAdvance && payload.refresh.reason === 'school-year'
  const showFirstRun =
    allowPromo &&
    !showSchoolYear &&
    !snoozed &&
    !optedOut &&
    ((firstRun && remaining.length > 0) || remind)

  if (showSchoolYear && stageAdvance) {
    const target = stageAdvance.stage
    const saved = fields.stage ?? null
    return (
      <div className="px-3 pb-1.5" data-probe-confirm>
        <div className="mx-auto w-full max-w-2xl rounded-lg border border-line/60 bg-surface-muted text-xs">
          <div className="px-2.5 py-2 flex flex-col gap-2">
            <p className="font-medium text-content-primary leading-relaxed">
              {target
                ? `新学年开始了，你现在${target}对吗？`
                : `按档案你${saved ?? '这个学段'}该读完了，现在是什么情况？`}
            </p>
            <p className="text-xs text-content-muted leading-relaxed">
              这条是系统按学年推算的，不是你亲口说的，所以得你点头我才改。
            </p>
            <div className="flex flex-wrap gap-1.5">
              <PickButton onClick={() => void confirmStage(target ?? '')} disabled={saving}>
                {target ? `对，我${target}了` : '已经毕业了'}
              </PickButton>
              <PickButton onClick={() => void confirmStage(saved ?? '')} disabled={saving || !saved}>
                {target ? `还在${saved ?? '这个学段'}` : `还在读${saved ?? '这个学段'}`}
              </PickButton>
              <PickButton tone="ghost" onClick={() => setCustomOpen((v) => !v)} disabled={saving}>
                情况不一样，我自己说
              </PickButton>
            </div>
            {customOpen && (
              <div className="flex gap-1.5">
                <input
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      void keepAside()
                    }
                  }}
                  placeholder="比如：我高二但已经在学高三内容"
                  className="min-w-0 flex-1 rounded-md border border-line/60 bg-surface px-2 py-2 text-xs text-content-primary placeholder:text-content-muted/70 focus:outline-none focus:border-accent/50"
                />
                <PickButton onClick={() => void keepAside()} disabled={saving || customText.trim().length < 4}>
                  记下
                </PickButton>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (!showFirstRun) return null

  return (
    <div className="px-3 pb-1.5" data-probe-banner>
      <div className="mx-auto w-full max-w-2xl">
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 px-3 py-2 rounded-lg
            bg-surface-subtle/70 border border-line/50 backdrop-blur-sm"
        >
          <Sparkles className="w-3.5 h-3.5 shrink-0 text-content-muted" />
          <span className="text-xs text-content-secondary flex-1 min-w-0 truncate">
            {remind ? '有一阵没确认了，这几条还准吗？' : '花 30 秒让 AI 了解你，只影响讲解深浅'}
          </span>
          {remind && !firstRun ? (
            <button
              type="button"
              onClick={reviewProbe}
              className="shrink-0 inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-md text-xs font-medium
                bg-accent text-white transition-transform active:scale-95"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <RefreshCw className="w-3 h-3" />
              过一遍
            </button>
          ) : (
            <button
              type="button"
              onClick={startProbe}
              className="shrink-0 inline-flex items-center min-h-[36px] px-2.5 rounded-md text-xs font-medium
                bg-accent text-white transition-transform active:scale-95"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              开始
            </button>
          )}
          <button
            type="button"
            onClick={snooze}
            className="shrink-0 inline-flex items-center justify-center w-9 min-h-[36px] rounded text-content-muted/70 transition-colors hover:text-content-primary"
            aria-label="关闭提示"
            title="一周内不再提示"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
