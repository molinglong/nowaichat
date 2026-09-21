'use client'

import { TrafficLights } from '@/components/TrafficLights'

/**
 * 认证页(登录/注册)顶部条:Tauri 桌面壳的红绿灯 + 整条窗口拖动区。
 *
 * 无边框窗口在登录页没有 Sidebar,没有它就无法拖动/最小化/关闭。
 * Web 端通过 globals.css 的 html:not([data-tauri]) .tauri-only 整体隐藏:
 * data-tauri 属性由 layout.tsx 的 head 内联脚本在首帧前同步注入,
 * 因此桌面端无 hydration 闪烁,Web 端零渲染差异。
 */
export function AuthTrafficBar() {
  return (
    <div
      className="tauri-only absolute inset-x-0 top-0 z-50 flex h-11 items-center px-4"
      data-tauri-drag-region=""
    >
      <div
        className="pointer-events-auto"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <TrafficLights />
      </div>
    </div>
  )
}
