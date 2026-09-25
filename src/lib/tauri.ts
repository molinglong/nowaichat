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

/** 回复完成通知开关 localStorage key('0'=关,缺省开) */
const NOTIFY_ON_REPLY_KEY = 'chat:notifyOnReply'

/** 通知正文摘要:多行 Markdown 压平成一行,超出 80 字截断 */
function squashForNotification(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat
}

export const tauri = {
  isTauri: false, // safe fallback; use getIsTauri() for runtime checks

  /**
   * 打开设置独立子窗口(可拖出主窗口外)。
   * 窗口在 tauri.conf.json 预声明(visible:false),这里 show+focus;
   * 被用户关过时兜底重建。主窗口所有设置入口经 chat-store 拦截统一走到这里。
   */
  async openSettings() {
    if (!getIsTauri()) return
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      const existing = await WebviewWindow.getByLabel('settings')
      if (existing) {
        // 防导航漂移:窗口常驻保活,WebView 可能被留在别的页面(如服务异常时的
        // 404 页上点了“返回主页”→ 停在 /)。JS 侧无跨 WebView 读 URL/导航的
        // API(2.11 权限表也不提供),show+校验+拉回统一收口到 Rust 命令。
        await invoke('show_settings_window')
        return
      }
      const win = new WebviewWindow('settings', {
        url: '/settings-window/',
        title: '设置',
        width: 780,
        height: 640,
        minWidth: 560,
        minHeight: 480,
        center: true,
        decorations: false,
        shadow: true,
        resizable: true,
      })
      win.once('tauri://error', (e) => {
        console.error('[tauri] settings window create failed:', e)
      })
    } catch (err) {
      console.error('[tauri] openSettings failed:', err)
    }
  },

  /** 隐藏当前窗口(设置子窗口的“关闭”= 隐藏保活,下次打开瞬时) */
  async hideCurrentWindow() {
    if (!getIsTauri()) return
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().hide()
    } catch (err) {
      console.error('[tauri] hideCurrentWindow failed:', err)
    }
  },

  /**
   * 关闭窗口:先播「缩小淡出」退场动画(globals.css 的 tauri-app-out,
   * html 上 data-closing 门控),180ms 后再真正关窗。
   * 关闭失败(极少见)时回滚动画,窗口恢复可用。
   */
  close: () => {
    if (!getIsTauri()) return invoke('close_window')
    const html = document.documentElement
    if (html.hasAttribute('data-closing')) return Promise.resolve(null) // 防重复触发
    html.setAttribute('data-closing', '')
    return new Promise((resolve) => {
      window.setTimeout(() => {
        invoke('close_window')
          .catch(() => html.removeAttribute('data-closing'))
          .finally(() => resolve(null))
      }, 180)
    })
  },
  minimize: () => invoke('minimize_window'),
  toggleFullscreen: () => invoke('toggle_fullscreen'),
  toggleMaximize: () => invoke('toggle_maximize'),

  /**
   * 系统毛玻璃材质开关(Mica/Acrylic,对应 Rust set_glass_effect)。
   * dark: 应用当前深浅色(同步给系统材质着色),缺省跟随系统。
   * Web 端 no-op。
   */
  setGlass: (enabled: boolean, dark?: boolean | null) =>
    invoke('set_glass_effect', { enabled, dark: dark ?? null }),

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

  /**
   * 监听窗口焦点变化(失焦降饱和 / 红绿灯变灰,macOS 行为)。
   * handler 收到 true=获得焦点, false=失焦。Web 端为 no-op。
   */
  onFocusChange(handler: (focused: boolean) => void): () => void {
    if (!getIsTauri()) return () => {}
    let cleanup: (() => void) | null = null
    ;(async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const unlisten = await win.onFocusChanged(({ payload }) => handler(payload))
      cleanup = unlisten
    })()
    return () => {
      cleanup?.()
    }
  },

  /**
   * AI 回复完成的系统通知(仅 Tauri 客户端)。
   * 触发条件:通知开关开启 + 窗口失焦(用户正看着窗口时不打扰)。
   * Web 端 no-op;系统通知权限未授予时静默放弃,不阻塞聊天主流程。
   */
  async notifyReplyDone(title: string, body: string) {
    if (!getIsTauri()) return
    if (!getNotifyOnReply()) return
    try {
      // document.hasFocus():WebView 失焦(最小化/被其他窗口遮挡/切走应用)时为 false,
      // 与 TauriVisualFX 的 focus 监听同语义,这里直接读文档焦点免维护全局状态
      if (document.hasFocus()) return
      const { isPermissionGranted, requestPermission, sendNotification } =
        await import('@tauri-apps/plugin-notification')
      let granted = await isPermissionGranted()
      if (!granted) {
        const permission = await requestPermission()
        granted = permission === 'granted'
      }
      if (!granted) return
      sendNotification({ title, body: squashForNotification(body) })
    } catch (err) {
      console.error('[tauri] notifyReplyDone failed:', err)
    }
  },
}

/** 回复完成通知是否开启(设置弹窗「聊天行为」开关,默认开) */
export function getNotifyOnReply(): boolean {
  try {
    return localStorage.getItem(NOTIFY_ON_REPLY_KEY) !== '0'
  } catch {
    return true
  }
}

/** 写入回复完成通知开关(设置弹窗切换) */
export function setNotifyOnReply(enabled: boolean) {
  try {
    localStorage.setItem(NOTIFY_ON_REPLY_KEY, enabled ? '1' : '0')
  } catch {
    // ignore
  }
}