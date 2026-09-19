'use client'

/**
 * 中性灰 mini switch：设置页（McpSettings）与聊天输入框 MCP 工具菜单共用。
 * 规范：激活态 bg-accent，未激活 bg-line-strong/60，18×32 圆角滑块。
 */
import { cn } from '@/lib/utils'

export function MiniSwitch({
  on,
  onClick,
  disabled = false,
}: {
  on: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={cn(
        'relative h-[18px] w-8 shrink-0 rounded-full transition-colors',
        on ? 'bg-accent' : 'bg-line-strong/60',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all',
          on ? 'left-[16px]' : 'left-[2px]'
        )}
      />
    </button>
  )
}
