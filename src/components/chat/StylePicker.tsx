'use client'

import { useState, useEffect, useRef, memo } from 'react'
import {
  Scale,
  Briefcase,
  Code2,
  Pencil,
  Compass,
  GraduationCap,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback'
import {
  STYLE_PRESETS,
  type StylePreset,
  type StylePresetId,
} from '@/lib/ai/style-presets'

/** icon 名称 → lucide-react 组件 */
const ICON_MAP: Record<StylePreset['icon'], LucideIcon> = {
  Scale,
  Briefcase,
  Code2,
  Pencil,
  Compass,
  GraduationCap,
}

interface StylePickerProps {
  value: StylePresetId | string
  onChange: (value: StylePresetId) => void
  /**
   * 拖动/选择结束后只触发一次(选择过程不触发)—— 用于持久化 / 网络请求 / toast
   * 若不传则只用 onChange
   */
  onCommit?: (value: StylePresetId) => void
  /** onCommit 的 debounce 毫秒数,默认 250ms */
  commitDelayMs?: number
  label?: string
  className?: string
}

function StylePickerInner({
  value = 'balanced',
  onChange,
  onCommit,
  commitDelayMs = 250,
  label = '对话风格',
  className,
}: StylePickerProps) {
  const [localValue, setLocalValue] = useState<StylePresetId>(
    (value as StylePresetId) ?? 'balanced'
  )
  const localValueRef = useRef<StylePresetId>(localValue)
  const propsValueRef = useRef(value)

  useEffect(() => {
    const v = (value as StylePresetId) ?? 'balanced'
    setLocalValue(v)
    localValueRef.current = v
    propsValueRef.current = v
  }, [value])

  const debouncedCommit = useDebouncedCallback((v: StylePresetId) => {
    onCommit?.(v)
  }, commitDelayMs)

  // 卸载时立刻 flush —— 用户切换页面时不丢保存
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

  const handleSelect = (next: StylePresetId) => {
    if (next === localValue) return
    setLocalValue(next)
    localValueRef.current = next
    onChange(next)
    debouncedCommit(next)
  }

  const active = STYLE_PRESETS.find((p) => p.id === localValue) ?? STYLE_PRESETS[0]

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-content-primary">
          {label}
        </label>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-content-muted">当前</span>
          <span className="text-xs font-medium text-accent">
            {active.label}
          </span>
        </div>
      </div>

      {/* 一行 6 个 chip(窄屏自动换行) */}
      <div className="flex flex-wrap gap-1.5">
        {STYLE_PRESETS.map((p) => {
          const Icon = ICON_MAP[p.icon]
          const isActive = p.id === localValue
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => handleSelect(p.id)}
              title={p.tagline}
              aria-pressed={isActive}
              aria-label={`选择风格：${p.label}（${p.tagline}）`}
              className={cn(
                'group flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all',
                'border',
                isActive
                  ? 'bg-accent/15 border-accent text-accent'
                  : 'bg-surface-muted/40 border-line/60 text-content-secondary hover:border-accent/40 hover:text-content-primary'
              )}
            >
              <Icon
                className={cn(
                  'h-3.5 w-3.5 shrink-0 transition-transform',
                  isActive ? 'scale-110' : 'group-hover:scale-105'
                )}
                aria-hidden
              />
              <span>{p.label}</span>
            </button>
          )
        })}
      </div>

      {/* 当前 preset 的 tagline 副标题 */}
      <p className="text-[11px] text-content-muted leading-relaxed">
        {active.tagline}
      </p>
    </div>
  )
}

export const StylePicker = memo(StylePickerInner)