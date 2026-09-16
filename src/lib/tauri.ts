'use client'

import { useEffect, useState } from 'react'

/**
 * Tauri API 封装。
 *
 * Web 端开发时(`npm run dev`)所有 invoke 都是 no-op,
 * 这样开发者不用启动 Tauri 也能在浏览器里看到完整 UI,
 * 只是红绿灯不会响应(因为浏览器没这些 API)。
 *
 * 检测方法:`__TAURI_INTERNALS__` 是 Tauri 运行时注入的全局变量,
 * 仅在 WebView 内存在。
 */

/**
 * 始终返回 false（在 SSR 和非 Tauri 环境）。
 * 组件需要用 getIsTauri() + useEffect 来做延迟判断，
 * 避免 module 求值时 __TAURI_INTERNALS__ 尚未注入导致 SSR/CSR 不一致。
 */
export const isTauri = false

/**
 * 运行时检测是否在 Tauri WebView 内。
 * 必须在 useEffect（客户端渲染后）里调用，因为 __TAURI_INTERNALS__
 * 在模块加载时可能还没注入到 window。
 */
export function getIsTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * React hook: 只在 Tauri 客户端渲染内容。
 * SSR 和首次渲染时返回 false，mount 后返回真实值。
 */
export function useIsTauri(): boolean {
  const [v, setV] = useState(false)
  useEffect(() => {
    setV(getIsTauri())
  }, [])
  return v
}

/**
 * React hook: 只在 Tauri 客户端渲染内容。
 * 用法:
 *   const DesktopOnly = ({ children }) => useDesktopOnly(children, null)
 *   const el = useDesktopOnly(<div>仅客户端</div>, <div>web备选</div>)
 */
export function useDesktopOnly(clientContent: React.ReactNode, fallback: React.ReactNode = null) {
  return useIsTauri() ? clientContent : fallback
}

async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!getIsTauri()) return null
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(cmd, args)
}

export const tauri = {
  isTauri: false, // safe fallback; use getIsTauri() for runtime checks

  close: () => invoke('close_window'),
  minimize: () => invoke('minimize_window'),
  toggleFullscreen: () => invoke('toggle_fullscreen'),
  toggleMaximize: () => invoke('toggle_maximize'),

  /**
   * 监听窗口状态变化(全屏/最大化进入退出),
   * 用于红绿灯图标的视觉反馈。
   */
  onResized(handler: () => void): () => void {
    if (!getIsTauri()) return () => {}
    let cleanup: (() => void) | null = null
    ;(async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const unlisten = await win.onResized(handler)
      cleanup = unlisten
    })()
    return () => {
      cleanup?.()
    }
  },
}