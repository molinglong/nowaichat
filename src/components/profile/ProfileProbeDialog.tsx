'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Loader2, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import {
  PROBE_MAX_QUESTIONS,
  applicableProbeFields,
  buildProbeQuestion,
  describeHits,
  extractGeneralFields,
  probeFieldLabel,
  probeHit,
  probeQueue,
  probeQuotaLeft,
  type ProbeHit,
  type ProbeQuestion,
} from '@/lib/profile/probe'
import type { GeneralFieldId, GeneralFields } from '@/lib/profile/general'

/**
 * 通用档案的对话式采集弹窗——**唯一**的填写/修改入口。
 * 聊天页的首启横幅（ProfileProbe）与用户中心的只读档案卡都挂这一个组件，
 * 所以档位口径、抽取规则、队列分岔不会在两处漂移。
 *
 * 三条实现约束：
 * - 采集气泡只活在组件里，不落库。写进会话历史会把填表问答混进搜索、统计和上下文预算。
 * - 在架快选由 currentId 派生，同一时刻只有一排，不存在「过期选项还能点」。
 * - 弹窗在架时主输入框被遮：想发正题先结束采集（✕ / 点遮罩 / ESC 任一）。
 *   聊天页会传 lastUserText，此时若真有正题进来（另一个标签页等），立刻让位：
 *   抽得到就顺手落档，抽不到不猜，也不追问。
 *
 * 出层：宿主（聊天区）祖先带 backdrop-blur，fixed 遮罩在其内部会退化，所以 portal 到 body。
 * 档位定在 z-[101]/z-[102]：必须压过设置页（z-[100]），因为用户中心那张只读卡也开这个窗。
 */

/** /api/profiles 的档案行（PUT 的回体也是它） */
export interface ProfileRow {
  exists: boolean
  enabled: boolean
  fields: GeneralFields
  displayName: string
  lastConfirmedAt: string | null
}

interface Bubble {
  id: number
  from: 'ai' | 'me'
  text: string
  /** 已落档的维度：回显气泡带逐条「改」入口 */
  hits?: ProbeHit[]
}

interface ProfileProbeDialogProps {
  /** 开窗时的档案：队列按它算，就地改身份后立刻分岔 */
  initial: ProfileRow
  /** review = 到期复核，只过已答的几维，不顺带问没答过的 */
  mode?: 'fill' | 'review'
  /** 聊天页才传：采集在架时若有正题进来，停采集并顺手抽取 */
  lastUserText?: string
  /** 每落一次库回传最新档案行，父层用它刷新横幅 / 收口卡 / 只读卡 */
  onChange: (row: ProfileRow) => void
  /** ✕ / 遮罩 / ESC / 问满 / 正题让位 都走这里 */
  onClose: () => void
}

const FILL_INTRO =
  '好，我一句一句问。点着答就行，打字也行，不想答就跳过，我不追。答完我照着调讲解深浅，随时能在用户中心关掉。'
const REVIEW_INTRO = '那我们把这几条过一遍，哪条变了改哪条，其余不动。'

function hitsToFields(hits: ProbeHit[]): GeneralFields {
  const fields: GeneralFields = {}
  for (const hit of hits) fields[hit.fieldId] = hit.value
  return fields
}

export function ProfileProbeDialog({
  initial,
  mode = 'fill',
  lastUserText,
  onChange,
  onClose,
}: ProfileProbeDialogProps) {
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [asked, setAsked] = useState<GeneralFieldId[]>([])
  /** 到期复核/就地改：这几维虽已落档，但重新上架待确认 */
  const [reask, setReask] = useState<GeneralFieldId[]>([])
  const [currentId, setCurrentId] = useState<GeneralFieldId | null>(null)
  const [turns, setTurns] = useState(0)
  const [saving, setSaving] = useState(false)
  const [typed, setTyped] = useState('')
  /** 落库后的最新档位（服务端回读为准），队列与抽取都以它算 */
  const [live, setLive] = useState<GeneralFields>(initial.fields)
  const bubbleId = useRef(0)
  const streamRef = useRef<HTMLDivElement | null>(null)

  const push = useCallback((from: Bubble['from'], text: string, hits?: ProbeHit[]) => {
    bubbleId.current += 1
    // id 必须在调用时取定：写进更新函数里读 ref，同一 tick 连推两条会拿到同一个 id → React 重复 key
    const id = bubbleId.current
    setBubbles((prev) => [...prev, { id, from, text, hits }])
  }, [])

  /** 还剩哪些没问：按当前档案算适用性，所以就地改身份后队列会立刻分岔 */
  const openFor = useCallback(
    (nextFields: GeneralFields, nextAsked: GeneralFieldId[], nextReask = reask, only?: GeneralFieldId[]) =>
      probeQueue(nextFields, nextAsked, nextReask, only),
    [reask]
  )

  // 弹窗出架：首帧没有 document 故需 mounted 闸门；shown 让 sheet 有位移动画
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const el = streamRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [bubbles])

  const commitFields = useCallback(
    async (patch: GeneralFields, enable: boolean): Promise<GeneralFields | null> => {
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
          return null
        }
        const row = (await res.json()) as ProfileRow
        setLive(row.fields ?? {})
        onChange(row)
        return row.fields ?? {}
      } catch {
        toast.error('网络不通，这条没存住', { title: '用户档案' })
        return null
      } finally {
        setSaving(false)
      }
    },
    [onChange]
  )

  /** 答完/跳完之后：还有配额就下一问，问满 9 句或无题可问就收口 */
  const advance = useCallback(
    (nextFields: GeneralFields, nextAsked: GeneralFieldId[], nextTurns: number) => {
      const q = openFor(nextFields, nextAsked)[0]
      if (!q || probeQuotaLeft(nextTurns) <= 0) {
        onClose()
        return
      }
      push('ai', q.ask)
      setCurrentId(q.fieldId)
      setAsked([...nextAsked, q.fieldId])
      setTurns(nextTurns + 1)
    },
    [openFor, push, onClose]
  )

  // 开窗即开场白 + 第一问（只跑一次：StrictMode 双挂载用 ref 兜住）
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    const reviewable =
      mode === 'review' ? applicableProbeFields(initial.fields).filter((id) => initial.fields[id]) : []
    push('ai', mode === 'review' ? REVIEW_INTRO : FILL_INTRO)
    setReask(reviewable)
    const q = openFor(initial.fields, [], reviewable, mode === 'review' ? reviewable : undefined)[0]
    if (!q) {
      onClose()
      return
    }
    push('ai', q.ask)
    setCurrentId(q.fieldId)
    setAsked([q.fieldId])
    setTurns(1)
    // 只在挂载时跑一次，故刻意不列依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const answerOption = useCallback(
    async (q: ProbeQuestion, value: string, label: string) => {
      if (saving) return
      // 先回声再落库：这一问的确认感来自「我答了」，不该等一个 PUT 往返才出现
      push('me', label)
      const next = await commitFields({ [q.fieldId]: value }, true)
      if (!next) return
      const hit = probeHit(q.fieldId, value)
      push('ai', `我记下了：${describeHits([hit])}`, [hit])
      advance({ ...next, [q.fieldId]: value }, asked, turns)
    },
    [saving, commitFields, asked, turns, push, advance]
  )

  const skipCurrent = useCallback(() => {
    if (!currentId || saving) return
    push('me', '这条先跳过')
    push('ai', '行，不追。')
    advance(live, asked, turns)
  }, [currentId, saving, live, asked, turns, push, advance])

  const submitTyped = useCallback(async () => {
    const text = typed.trim()
    if (!text || saving) return
    setTyped('')
    push('me', text)
    const result = extractGeneralFields(text, live)
    if (!result.hits.length) {
      push(
        'ai',
        result.kept.length
          ? `这 ${result.kept.length} 条已经记过了，没动。要改就点上一条的「改」。`
          : '这条我不猜，怕记错。你想说的时候再打一句，或者点下面的。'
      )
      return
    }
    const next = await commitFields(hitsToFields(result.hits), true)
    if (!next) return
    push('ai', `我记下了：${describeHits(result.hits)}`, result.hits)
    advance({ ...next, ...hitsToFields(result.hits) }, asked, turns)
  }, [typed, saving, live, asked, turns, push, commitFields, advance])

  /** 就地改：把这一维重新上架（reask 让它出「已答」，asked 让它不再被排到别处） */
  const editField = useCallback(
    (fieldId: GeneralFieldId) => {
      const q = buildProbeQuestion(fieldId)
      setReask((prev) => (prev.includes(fieldId) ? prev : [...prev, fieldId]))
      setAsked((prev) => (prev.includes(fieldId) ? prev : [...prev, fieldId]))
      setCurrentId(fieldId)
      push('me', `${probeFieldLabel(fieldId)}这条我想改`)
      push('ai', q.ask)
    },
    [push]
  )

  // 正题让位（兜底）：弹窗在架时主输入框已被遮，正常路径走不到这里；
  // 真有消息从别处进来时先停采集，能抽到的维度顺手落档，抽不到不猜
  const seenUserText = useRef<string | null>(null)
  useEffect(() => {
    if (lastUserText === undefined) return
    if (seenUserText.current === null) {
      seenUserText.current = lastUserText
      return
    }
    if (lastUserText === seenUserText.current) return
    const said = lastUserText
    seenUserText.current = said
    const result = extractGeneralFields(said, live)
    if (result.hits.length) void commitFields(hitsToFields(result.hits), false)
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastUserText])

  if (!mounted) return null

  const current: ProbeQuestion | null = currentId ? buildProbeQuestion(currentId) : null

  return createPortal(
    <>
      <div
        aria-hidden
        data-probe-scrim
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-[101] bg-black/40 transition-opacity duration-300',
          shown ? 'opacity-100' : 'opacity-0'
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="让 AI 认识你"
        data-probe-dialog
        className={cn(
          'fixed z-[102] border-line/60 bg-surface-muted text-xs',
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
              onClick={onClose}
              className="shrink-0 inline-flex items-center justify-center w-9 min-h-[36px] rounded text-content-muted/70 transition-colors hover:text-content-primary"
              aria-label="结束采集"
              title="先到这儿，不追了"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div ref={streamRef} className="max-h-[38vh] overflow-y-auto px-2.5 py-2 flex flex-col gap-2">
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
                current?.freeText ? '打字说也行，我照着你说的记' : '不想点就打字，一句话里几个维度我一起抽'
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

export function PickButton({
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
