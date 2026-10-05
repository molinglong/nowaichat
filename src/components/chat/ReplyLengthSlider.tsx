'use client'

import { useState, useEffect, useRef, memo } from 'react'
import { cn } from '@/lib/utils'
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback'
import {
  REPLY_LENGTH_LEVELS,
  DEFAULT_REPLY_LENGTH,
  type ReplyLengthId,
} from '@/lib/ai/reply-length'

interface ReplyLengthSliderProps {
  value: ReplyLengthId | string
  onChange: (value: ReplyLengthId) => void
  /**
   * 拖动结束后只触发一次(过程中不触发)—— 用于持久化 / toast
   * 契约与 StylePicker 一致：onChange 管即时生效，onCommit 管落库
   */
  onCommit?: (value: ReplyLengthId) => void
  /** onCommit 的 debounce 毫秒数,默认 250ms */
  commitDelayMs?: number
  label?: string
  className?: string
}

/**
 * 回复长度四档停靠滑杆（极简 / 简短 / 标准 / 详尽）。
 *
 * 刻意做成停靠档而非连续 0-100：档位 id 要能进 AI 设置白名单并被快照读回，
 * 连续值既落不成正向提示词指令，也无法做取值校验。
 */
function ReplyLengthSliderInner({
  value = DEFAULT_REPLY_LENGTH,
  onChange,
  onCommit,
  commitDelayMs = 250,
  label = '回复长度',
  className,
}: ReplyLengthSliderProps) {
  const [localValue, setLocalValue] = useState<ReplyLengthId>(
    (value as ReplyLengthId) ?? DEFAULT_REPLY_LENGTH
  )
  const localValueRef = useRef<ReplyLengthId>(localValue)
  const propsValueRef = useRef(value)

  useEffect(() => {
    const v = (value as ReplyLengthId) ?? DEFAULT_REPLY_LENGTH
    setLocalValue(v)
    localValueRef.current = v
    propsValueRef.current = v
  }, [value])

  const debouncedCommit = useDebouncedCallback((v: ReplyLengthId) => {
    onCommit?.(v)
  }, commitDelayMs)

  // 卸载时立刻 flush —— 用户切走设置页时不丢保存
  useEffect(() => {
    return () => {
      if (
        typeof onCommit === 'function' &&
        localValueRef.current !== propsValueRef.current
      ) {
        onCommit(localValueRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSelect = (next: ReplyLengthId) => {
    if (next === localValue) return
    setLocalValue(next)
    localValueRef.current = next
    onChange(next)
    debouncedCommit(next)
  }

  const index = Math.max(
    0,
    REPLY_LENGTH_LEVELS.findIndex((l) => l.id === localValue)
  )
  const percent = (index / (REPLY_LENGTH_LEVELS.length - 1)) * 100
  const active = REPLY_LENGTH_LEVELS[index]

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-content-primary">{label}</label>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-content-muted">当前</span>
          <span className="text-xs font-medium text-accent">{active.label}</span>
        </div>
      </div>

      {/* 轨道：隐藏原生 range 负责键盘与命中，自绘轨道/刻度/圆点负责视觉 */}
      <div className="relative h-2 rounded-full bg-surface-muted border border-line/60">
        <div
          className="absolute top-0 bottom-0 left-0 rounded-full bg-accent/60 transition-all duration-200"
          style={{ width: `calc(${percent}% )` }}
        />
        {REPLY_LENGTH_LEVELS.map((l, i) => (
          <span
            key={l.id}
            aria-hidden
            className={cn(
              'absolute top-1/2 -translate-y-1/2 w-1 h-1 rounded-full pointer-events-none transition-colors',
              i === index ? 'bg-accent' : 'bg-line'
            )}
            style={{ left: `calc(${(i / (REPLY_LENGTH_LEVELS.length - 1)) * 100}% - 2px)` }}
          />
        ))}
        <input
          type="range"
          min={0}
          max={REPLY_LENGTH_LEVELS.length - 1}
          step={1}
          value={index}
          onChange={(e) => {
            const level = REPLY_LENGTH_LEVELS[Number(e.target.value)]
            if (level) handleSelect(level.id)
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label="回复长度滑杆"
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white dark:bg-surface border-2 border-accent shadow-md transition-all duration-200 pointer-events-none"
          style={{ left: `calc(${percent}% - 8px)` }}
        />
      </div>

      {/* 档位刻度标签：与轨道停靠点对齐，点击等效于拖到该档 */}
      <div className="flex justify-between -mt-1">
        {REPLY_LENGTH_LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => handleSelect(l.id)}
            title={l.tagline}
            aria-pressed={l.id === localValue}
            className={cn(
              'text-[11px] font-medium transition-colors',
              l.id === localValue
                ? 'text-accent'
                : 'text-content-muted hover:text-content-secondary'
            )}
          >
            {l.label}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-content-muted leading-relaxed">
        {active.hint ?? active.tagline}
      </p>
    </div>
  )
}

export const ReplyLengthSlider = memo(ReplyLengthSliderInner)
