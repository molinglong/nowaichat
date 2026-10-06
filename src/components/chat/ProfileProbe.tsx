'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSession } from 'next-auth/react'
import { Check, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import {
  PROBE_MAX_QUESTIONS,
  PROBE_SNOOZE_KEY_PREFIX,
  applicableProbeFields,
  buildProbeQuestion,
  describeHits,
  extractGeneralFields,
  pendingProbeFields,
  probeFieldLabel,
  probeHit,
  probeQueue,
  probeQuotaLeft,
  probeSnoozed,
  type ProbeHit,
  type ProbeQuestion,
} from '@/lib/profile/probe'
import type { GeneralFieldId, GeneralFields } from '@/lib/profile/general'

/**
 * 通用档案的对话式采集（波2）。形态定案：一问一气泡 + 快选可无视 + 打字也算回答 +
 * 「我记下了…」回显 + 就地改。
 *
 * 三条实现约束：
 * - 采集气泡只活在本组件里，不落库。写进会话历史会把填表问答混进搜索、统计和上下文预算，
 *   而这些话对后续对话没有价值。
 * - 在架快选由 currentId 派生，同一时刻只有一排，不存在"过期选项还能点"。
 * - 采集窗在架时主输入框被遮：想发正题先结束采集（✕ / 点遮罩 / ESC 任一）。
 *   此时若真有正题进来（另一个标签页等），立刻让位：抽得到就顺手落档，抽不到不猜，也不追问。
 */

interface ProfilePayload {
  profile: {
    exists: boolean
    enabled: boolean
    fields: GeneralFields
    displayName: string
    lastConfirmedAt: string | null
  }
  derived: { kind: string; stage: string | null; note: string } | null
  refresh: { due: boolean; reason: string | null }
}

interface Bubble {
  id: number
  from: 'ai' | 'me'
  text: string
  /** 已落档的维度：回显气泡带逐条「改」入口 */
  hits?: ProbeHit[]
}

interface ProfileProbeProps {
  /** 输入框里最近一条用户消息，用于「打字也算回答 + 一发正题立刻让位」 */
  lastUserText: string
  /** 学习模式等场景不弹采集 */
  disabled?: boolean
}

function hitsToFields(hits: ProbeHit[]): GeneralFields {
  const fields: GeneralFields = {}
  for (const hit of hits) fields[hit.fieldId] = hit.value
  return fields
}

export function ProfileProbe({ lastUserText, disabled }: ProfileProbeProps) {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const ephemeral = session?.ephemeral === true

  const [payload, setPayload] = useState<ProfilePayload | null>(null)
  const [snoozed, setSnoozed] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'probing' | 'done'>('idle')
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [asked, setAsked] = useState<GeneralFieldId[]>([])
  /** 到期复核/就地改：这几维虽已落档，但重新上架待确认 */
  const [reask, setReask] = useState<GeneralFieldId[]>([])
  const [currentId, setCurrentId] = useState<GeneralFieldId | null>(null)
  const [turns, setTurns] = useState(0)
  const [saving, setSaving] = useState(false)
  const [typed, setTyped] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const [customText, setCustomText] = useState('')
  const bubbleId = useRef(0)
  const streamRef = useRef<HTMLDivElement | null>(null)

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

  useEffect(() => {
    const el = streamRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [bubbles])

  /** 还剩哪些没问：按当前档案算适用性，所以就地改身份后队列会立刻分岔 */
  const openFor = useCallback(
    (nextFields: GeneralFields, nextAsked: GeneralFieldId[], nextReask = reask, only?: GeneralFieldId[]) =>
      probeQueue(nextFields, nextAsked, nextReask, only),
    [reask]
  )

  const push = useCallback((from: Bubble['from'], text: string, hits?: ProbeHit[]) => {
    bubbleId.current += 1
    // id 必须在调用时取定：写进更新函数里读 ref，同一 tick 连推两条会拿到同一个 id → React 重复 key
    const id = bubbleId.current
    setBubbles((prev) => [...prev, { id, from, text, hits }])
  }, [])

  const closeFlow = useCallback(() => {
    setPhase('done')
    setCurrentId(null)
    setAsked([])
    setReask([])
  }, [])

  // 弹窗出层到 body：首帧没有 document，所以要 mounted 闸门；shown 让 sheet 有位移动画
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  useEffect(() => {
    if (phase !== 'probing') {
      setShown(false)
      return
    }
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [phase])
  useEffect(() => {
    if (phase !== 'probing') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeFlow()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [phase, closeFlow])

  const commitFields = useCallback(
    async (patch: GeneralFields, enable: boolean): Promise<boolean> => {
      setSaving(true)
      try {
        const body: { fields: GeneralFields; enabled?: boolean } = { fields: patch }
        // 只有用户主动开始采集才顺带开启注入；正题让位时的顺手抽取不能擅自打开开关
        if (enable) body.enabled = true
        const res = await fetch('/api/profiles', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null
          toast.error(data?.error || '这条没存住', { title: '用户档案' })
          return false
        }
        const next = (await res.json()) as ProfilePayload['profile']
        setPayload((prev) => (prev ? { ...prev, profile: next } : prev))
        return true
      } catch {
        toast.error('网络不通，这条没存住', { title: '用户档案' })
        return false
      } finally {
        setSaving(false)
      }
    },
    []
  )

  /** 答完/跳完之后：还有配额就下一问，问满 9 句或无题可问就收口 */
  const advance = useCallback(
    (nextFields: GeneralFields, nextAsked: GeneralFieldId[], nextTurns: number) => {
      const q = openFor(nextFields, nextAsked)[0]
      if (!q || probeQuotaLeft(nextTurns) <= 0) {
        closeFlow()
        return
      }
      push('ai', q.ask)
      setCurrentId(q.fieldId)
      setAsked([...nextAsked, q.fieldId])
      setTurns(nextTurns + 1)
    },
    [openFor, push, closeFlow]
  )

  const beginFlow = useCallback(
    (intro: string, baseFields: GeneralFields, baseReask: GeneralFieldId[], only?: GeneralFieldId[]) => {
      setPhase('probing')
      setBubbles([])
      setAsked([])
      setTurns(0)
      setTyped('')
      setCustomOpen(false)
      setReask(baseReask)
      push('ai', intro)
      const q = openFor(baseFields, [], baseReask, only)[0]
      if (!q) {
        closeFlow()
        return
      }
      push('ai', q.ask)
      setCurrentId(q.fieldId)
      setAsked([q.fieldId])
      setTurns(1)
    },
    [openFor, push, closeFlow]
  )

  const startProbe = useCallback(() => {
    beginFlow(
      '好，我一句一句问。点着答就行，打字也行，不想答就跳过，我不追。答完我照着调讲解深浅，随时能在用户中心关掉。',
      fields,
      []
    )
  }, [beginFlow, fields])

  /** 到期复核：已答的几维重新上架，逐条过 */
  const reviewProbe = useCallback(() => {
    const reviewable = applicableProbeFields(fields).filter((id) => fields[id])
    beginFlow('那我们把这几条过一遍，哪条变了改哪条，其余不动。', fields, reviewable, reviewable)
  }, [beginFlow, fields])

  const answerOption = useCallback(
    async (q: ProbeQuestion, value: string, label: string) => {
      if (saving) return
      // 先回声再落库：这一问的确认感来自"我答了"，不该等一个 PUT 往返才出现
      push('me', label)
      const ok = await commitFields({ [q.fieldId]: value }, true)
      if (!ok) return
      const hit = probeHit(q.fieldId, value)
      push('ai', `我记下了：${describeHits([hit])}`, [hit])
      advance({ ...fields, [q.fieldId]: value }, asked, turns)
    },
    [saving, commitFields, fields, asked, turns, push, advance]
  )

  const skipCurrent = useCallback(() => {
    if (!currentId || saving) return
    push('me', '这条先跳过')
    push('ai', '行，不追。')
    advance(fields, asked, turns)
  }, [currentId, saving, fields, asked, turns, push, advance])

  const submitTyped = useCallback(async () => {
    const text = typed.trim()
    if (!text || saving) return
    setTyped('')
    push('me', text)
    const result = extractGeneralFields(text, fields)
    if (!result.hits.length) {
      push(
        'ai',
        result.kept.length
          ? `这 ${result.kept.length} 条已经记过了，没动。要改就点上一条的「改」。`
          : '这条我不猜，怕记错。你想说的时候再打一句，或者点下面的。'
      )
      return
    }
    const ok = await commitFields(hitsToFields(result.hits), true)
    if (!ok) return
    push('ai', `我记下了：${describeHits(result.hits)}`, result.hits)
    advance({ ...fields, ...hitsToFields(result.hits) }, asked, turns)
  }, [typed, saving, fields, asked, turns, push, commitFields, advance])

  /** 就地改：把这一维重新上架（reask 让它出「已答」，asked 让它不再被排到别处） */
  const editField = useCallback(
    (fieldId: GeneralFieldId) => {
      const q = buildProbeQuestion(fieldId)
      setPhase('probing')
      setReask((prev) => (prev.includes(fieldId) ? prev : [...prev, fieldId]))
      setAsked((prev) => (prev.includes(fieldId) ? prev : [...prev, fieldId]))
      setCurrentId(fieldId)
      push('me', `${probeFieldLabel(fieldId)}这条我想改`)
      push('ai', q.ask)
    },
    [push]
  )

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

  // 正题让位（兜底）：采集窗在架时主输入框已被遮，正常路径走不到这里；
  // 真有消息从别处进来时先停采集，能抽到的维度顺手落档，抽不到不猜
  const seenUserText = useRef<string | null>(null)
  useEffect(() => {
    if (seenUserText.current === null) {
      seenUserText.current = lastUserText
      return
    }
    if (lastUserText === seenUserText.current) return
    const said = lastUserText
    seenUserText.current = said
    if (phase !== 'probing') return
    const result = extractGeneralFields(said, fields)
    setPhase('idle')
    setBubbles([])
    setAsked([])
    setReask([])
    setCurrentId(null)
    if (result.hits.length) void commitFields(hitsToFields(result.hits), false)
  }, [lastUserText, phase, fields, commitFields])

  if (!payload || disabled || ephemeral) return null

  const current: ProbeQuestion | null =
    phase === 'probing' && currentId ? buildProbeQuestion(currentId) : null

  // ---- 采集进行中：弹窗（手机端底部 sheet / 桌面居中卡）----
  // 定案改弹窗：一问一气泡不再挤在输入框上方。聊天区祖先带 backdrop-blur，
  // fixed 遮罩在其内部会退化，所以必须 portal 出到 body。
  if (phase === 'probing' && mounted) {
    return createPortal(
      <>
        <div
          aria-hidden
          data-probe-scrim
          onClick={closeFlow}
          className={cn(
            'fixed inset-0 z-[57] bg-black/40 transition-opacity duration-300',
            shown ? 'opacity-100' : 'opacity-0'
          )}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="让 AI 认识你"
          data-probe-dialog
          className={cn(
            'fixed z-[58] border-line/60 bg-surface-muted text-xs',
            'inset-x-0 bottom-0 rounded-t-[28px] border-t pb-[max(var(--sab,0px),10px)]',
            'shadow-[0_18px_50px_rgba(0,0,0,0.28)] transition-transform duration-300 ease-out',
            shown ? 'translate-y-0' : 'translate-y-full',
            // 桌面端收成居中卡;translate-y 的基准从「贴底」换成「自身中点」，两档各自给值
            'md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:w-[440px] md:rounded-2xl md:border md:pb-0',
            shown ? 'md:translate-y-[-50%]' : 'md:translate-y-[-44%]'
          )}
        >
          <div aria-hidden className="mx-auto mt-2.5 h-2 w-[46px] rounded-full bg-line-strong/40 md:hidden" />
          <div className="pt-1.5" data-probe-panel>
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-line/40 text-content-secondary">
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                让 AI 认识你 · 第 {Math.min(turns, PROBE_MAX_QUESTIONS)} / {PROBE_MAX_QUESTIONS} 问
              </span>
              <button
                type="button"
                onClick={closeFlow}
                className="shrink-0 inline-flex items-center justify-center w-9 min-h-[36px] rounded text-content-muted/70 transition-colors hover:text-content-primary"
                aria-label="结束采集"
                title="先到这儿，不追了"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div
              ref={streamRef}
              className="max-h-[38vh] overflow-y-auto px-2.5 py-2 flex flex-col gap-2"
            >
              {bubbles.map((b) => (
                <div
                  key={b.id}
                  data-probe-bubble={b.from}
                  className={cn('flex', b.from === 'me' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-lg px-2.5 py-1.5 leading-relaxed',
                      b.from === 'me'
                        ? 'bg-accent text-white'
                        : 'bg-surface text-content-primary border border-line/40'
                    )}
                  >
                    <span>{b.text}</span>
                    {b.hits && b.hits.length > 0 && (
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {b.hits.map((h) => (
                          <button
                            key={h.fieldId}
                            type="button"
                            onClick={() => editField(h.fieldId)}
                            className="inline-flex items-center rounded border border-line/60 px-2 min-h-[36px] text-xs text-content-muted transition-colors hover:text-content-primary"
                          >
                            改 · {probeFieldLabel(h.fieldId)}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {current && (
              <div className="px-2.5 pb-2 flex flex-wrap gap-1.5" data-probe-chips>
                {current.options.map((opt) => (
                  <PickButton
                    key={opt.value}
                    onClick={() => void answerOption(current, opt.value, opt.label)}
                    disabled={saving}
                  >
                    {opt.label}
                  </PickButton>
                ))}
                <PickButton tone="ghost" onClick={() => void skipCurrent()} disabled={saving}>
                  跳过这条
                </PickButton>
              </div>
            )}

            <div className="px-2.5 pb-2.5 flex gap-1.5">
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void submitTyped()
                  }
                }}
                maxLength={current?.freeText ? current.max : 200}
                placeholder={
                  current?.freeText
                    ? '打字说也行，我照着你说的记'
                    : '不想点就打字，一句话里几个维度我一起抽'
                }
                className="min-w-0 flex-1 rounded-md border border-line/60 bg-surface px-2.5 py-2 text-xs text-content-primary placeholder:text-content-muted/70 focus:outline-none focus:border-accent/50"
              />
              <button
                type="button"
                onClick={() => void submitTyped()}
                disabled={saving || !typed.trim()}
                className="shrink-0 inline-flex items-center justify-center rounded-md px-3 min-h-[36px] bg-accent text-white disabled:opacity-40"
                aria-label="把这句记进档案"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </>,
      document.body
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
  const remaining = pendingProbeFields(fields)
  const firstRun = !payload.profile.exists || Object.keys(fields).length === 0
  // 用户在用户中心主动关掉注入 = 明确表态，不再拿首启提示打扰
  const optedOut = payload.profile.exists && !payload.profile.enabled
  const derived = payload.derived
  const stageAdvance =
    derived && (derived.kind === 'advance' || derived.kind === 'graduate') ? derived : null
  const remind = payload.refresh.due
  const showSchoolYear = !optedOut && remind && !!stageAdvance && payload.refresh.reason === 'school-year'
  const showFirstRun =
    !showSchoolYear && !snoozed && !optedOut && ((firstRun && remaining.length > 0) || remind)

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
              <PickButton
                onClick={() => void confirmStage(target ?? '')}
                disabled={saving}
              >
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

function PickButton({
  children,
  onClick,
  disabled,
  tone = 'solid',
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'solid' | 'ghost'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center rounded-md px-2.5 min-h-[36px] text-xs leading-none transition-colors disabled:opacity-40',
        tone === 'solid'
          ? 'border border-line/60 bg-surface text-content-primary hover:border-accent/50'
          : 'border border-dashed border-line/60 text-content-muted hover:text-content-primary'
      )}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {children}
    </button>
  )
}
