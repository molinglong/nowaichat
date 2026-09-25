'use client'

import { memo, useMemo, useState } from 'react'
import { Check, ChevronDown, HelpCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toClarifyIntro, toClarifyQuestions } from '@/lib/ai/clarify'
import type { ToolCallView } from './ToolCallCard'

/**
 * 澄清问答卡片 —— 渲染 ask_clarification 工具调用,让"AI 反问"从纯文本
 * 升级为结构化点选交互。
 *
 * 三态(由 view.state + answered 驱动):
 * - 流式(input-streaming): 参数还在生成,显示骨架占位,不可交互
 * - 待答(input-available + 未回答): 问题 + 选项 chips + 可选补充输入,点选后提交
 *   单选题点一个选项;multiSelect 题可累计点选(再点取消),题干旁标「可多选」
 * - 已答(answered): 折叠为摘要行,可展开回看问题列表(只读)
 *
 * 提交协议:回答以普通 user 消息回流(逐题"问题:答案"编号列表,多选题选项以「、」连接),
 * 走 sendMessage 复用落库/排队/token 统计全链路;"已答"判定由消息列表层给出(卡片之后存在 user 消息)。
 */
interface ClarifyCardProps {
  view: ToolCallView
  /** 该 assistant 消息之后是否已有 user 消息(视为已回答) */
  answered: boolean
  /** 提交回答文本(拼接后的编号列表);缺省则卡片只读 */
  onSubmit?: (answersText: string) => void
}

function ClarifyCardInner({ view, answered, onSubmit }: ClarifyCardProps) {
  const questions = useMemo(() => toClarifyQuestions(view.input), [view.input])
  const intro = useMemo(() => toClarifyIntro(view.input), [view.input])
  const isStreaming = view.state === 'input-streaming'

  // 每题的选择:选项点选记入 selected(单选恒为一元素数组,多选题可累计/再点取消);
  // 自由填写记入 custom(与选项互斥,后写的覆盖先写的)
  const [selected, setSelected] = useState<Record<number, string[]>>({})
  const [custom, setCustom] = useState<Record<number, string>>({})
  const [expanded, setExpanded] = useState(false)

  const answers = useMemo(() => {
    return questions
      .map((q, i) => (selected[i]?.length ? selected[i].join('、') : custom[i]?.trim() ?? ''))
      .filter(Boolean)
  }, [questions, selected, custom])
  const canSubmit = !isStreaming && !answered && answers.length > 0 && !!onSubmit

  const submit = () => {
    if (!canSubmit) return
    const lines = questions
      .map((q, i) => {
        const a = selected[i]?.length ? selected[i].join('、') : custom[i]?.trim() ?? ''
        return a ? `${i + 1}. ${q.question}：${a}` : null
      })
      .filter((l): l is string => !!l)
    if (lines.length === 0) return
    onSubmit?.(intro ? `${intro}\n${lines.join('\n')}` : lines.join('\n'))
  }

  // ---- 已答态:折叠摘要行,可展开回看 ----
  if (answered) {
    return (
      <div className="rounded-lg border border-line/60 bg-surface-muted overflow-hidden text-xs">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-surface-subtle transition-colors text-left"
          aria-expanded={expanded}
        >
          <Check className="w-3.5 h-3.5 shrink-0 text-content-muted" />
          <span className="text-content-secondary">已回答 {questions.length} 个澄清问题</span>
          <ChevronDown
            className={cn('w-3 h-3 ml-auto shrink-0 text-content-muted transition-transform', expanded ? '' : '-rotate-90')}
          />
        </button>
        {expanded && (
          <div className="px-2.5 pb-2 pt-0.5 flex flex-col gap-1.5">
            {questions.map((q, i) => (
              <div key={i} className="text-content-muted">
                <span className="font-mono text-[10px] mr-1">[{i + 1}]</span>
                {q.question}
              </div>
            ))}
            <div className="text-content-muted/80">回答见下方消息</div>
          </div>
        )}
      </div>
    )
  }

  // ---- 流式骨架:参数尚未成形 ----
  if (isStreaming) {
    return (
      <div className="rounded-lg border border-line/60 bg-surface-muted overflow-hidden text-xs">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-content-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span>正在整理需要确认的问题…</span>
        </div>
      </div>
    )
  }

  // ---- 待答态:可交互 ----
  return (
    <div className="rounded-lg border border-line/60 bg-surface-muted overflow-hidden text-xs">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-content-secondary border-b border-line/40">
        <HelpCircle className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 truncate">{intro || '需要补充一些信息'}</span>
      </div>
      <div className="px-2.5 py-2 flex flex-col gap-2.5">
        {questions.map((q, i) => {
          const picked = selected[i]
          const customText = custom[i] ?? ''
          return (
            <div key={i} className="flex flex-col gap-1.5">
              <p className="font-medium text-content-primary leading-relaxed">
                {i + 1}. {q.question}
                {q.multiSelect && (
                  <span className="ml-1.5 text-[10px] font-normal text-content-muted">可多选</span>
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt) => {
                  const active = picked?.includes(opt) ?? false
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        // 选项与自由填写互斥:选中选项时清掉该题的自由输入
                        setCustom((prev) => ({ ...prev, [i]: '' }))
                        setSelected((prev) => {
                          // 单选:一题只保留一个选项;多选:同项再点取消,异项追加
                          if (!q.multiSelect) return { ...prev, [i]: [opt] }
                          const cur = prev[i] ?? []
                          return {
                            ...prev,
                            [i]: cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt],
                          }
                        })
                      }}
                      className={cn(
                        'rounded-md border px-2 py-1 leading-none transition-colors',
                        active
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-line/60 text-content-secondary hover:bg-surface-subtle hover:text-content-primary'
                      )}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>
              {q.allowCustom && (
                <input
                  value={customText}
                  onChange={(e) => {
                    const v = e.target.value
                    // 输入自由内容时取消该题的选项选中
                    setCustom((prev) => ({ ...prev, [i]: v }))
                    setSelected((prev) => {
                      if (!(i in prev)) return prev
                      const next = { ...prev }
                      delete next[i]
                      return next
                    })
                  }}
                  placeholder="或自行输入…"
                  className="w-full rounded-md border border-line/60 bg-surface px-2 py-1 text-xs text-content-primary placeholder:text-content-muted/70 focus:outline-none focus:border-accent/50"
                />
              )}
            </div>
          )
        })}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs text-accent-foreground hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            提交回答
          </button>
        </div>
      </div>
    </div>
  )
}

export const ClarifyCard = memo(ClarifyCardInner)
