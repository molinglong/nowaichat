'use client'

import { useEffect, useState } from 'react'
import { tauri } from '@/lib/tauri'

/**
 * macOS 风格红绿灯。嵌入 Sidebar 顶部使用。
 *
 * 行为:
 * - 红 = 关闭窗口
 * - 黄 = 最小化
 * - 绿 = 进入/退出全屏(macOS 行为,不是 Windows 的"最大化")
 * - 圆点默认灰色,鼠标悬停红绿灯组时才显色(macOS 老版本风格);
 *   窗口失焦时整组变灰降透明,重新聚焦恢复
 *
 * Web 端开发时按钮渲染但事件是 no-op,样式可预览。
 * onClose:自定义红点行为(如设置子窗口的"关闭=隐藏"),缺省关窗当前窗口。
 */
export function TrafficLights({ onClose }: { onClose?: () => void } = {}) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [hovered, setHovered] = useState<'close' | 'min' | 'max' | null>(null)
  // 窗口焦点态:失焦时红绿灯变灰(macOS 行为)
  const [focused, setFocused] = useState(true)

  useEffect(() => {
    return tauri.onFocusChange(setFocused)
  }, [])

  useEffect(() => {
    return tauri.onResized(() => {
      ;(async () => {
        const state = (await (window as any).__TAURI__?.core?.invoke?.(
          'get_window_state'
        )) as { maximized: boolean; fullscreen: boolean } | null
        if (state) setIsFullscreen(state.fullscreen)
      })()
    })
  }, [])

  const handleClose = onClose ?? (() => tauri.close())
  const handleMinimize = () => tauri.minimize()
  const handleFullscreen = () => {
    setIsFullscreen((v) => !v)
    tauri.toggleFullscreen()
  }

  return (
    <div
      className="group/tl flex items-center gap-1.5 select-none"
      // Tauri:禁止这块区域响应拖拽,否则点按钮时会拖动窗口
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <TrafficLight
        color="red"
        focused={focused}
        hovered={hovered === 'close'}
        icon={'\u2715' /* × */}
        onClick={handleClose}
        onEnter={() => setHovered('close')}
        onLeave={() => setHovered(null)}
      />
      <TrafficLight
        color="yellow"
        focused={focused}
        hovered={hovered === 'min'}
        icon={'\u2212' /* − */}
        onClick={handleMinimize}
        onEnter={() => setHovered('min')}
        onLeave={() => setHovered(null)}
      />
      <TrafficLight
        color="green"
        focused={focused}
        hovered={hovered === 'max'}
        icon={isFullscreen ? '\u29C9' /* ⧉ */ : '\u2922' /* ⤢ */}
        onClick={handleFullscreen}
        onEnter={() => setHovered('max')}
        onLeave={() => setHovered(null)}
      />
    </div>
  )
}

function TrafficLight({
  color,
  icon,
  hovered,
  focused,
  onClick,
  onEnter,
  onLeave,
}: {
  color: 'red' | 'yellow' | 'green'
  icon: string
  hovered: boolean
  focused: boolean
  onClick: () => void
  onEnter: () => void
  onLeave: () => void
}) {
  // hover 显色用命名 group(group/tl),避免外层组件的 group 误触发;
  // 字面量类名写死在映射表里,保证 Tailwind JIT 能扫描生成
  const hoverColor = {
    red: 'group-hover/tl:bg-[#ff5f57]',
    yellow: 'group-hover/tl:bg-[#febc2e]',
    green: 'group-hover/tl:bg-[#28c840]',
  }[color]

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      aria-label={color}
      className={[
        'flex h-3 w-3 items-center justify-center rounded-full transition-colors duration-150',
        // 默认灰(macOS 未悬停态);聚焦且悬停组内时才显色
        'bg-neutral-300 dark:bg-neutral-600',
        focused ? hoverColor : 'opacity-70',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {hovered && (
        <span className="text-[8px] font-bold leading-none text-black/70">
          {icon}
        </span>
      )}
    </button>
  )
}
