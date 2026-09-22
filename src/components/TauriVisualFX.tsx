'use client'

import { useEffect, useState } from 'react'
import { useIsTauri, tauri } from '@/lib/tauri'

/** 毛玻璃偏好存 localStorage(纯视觉偏好,不入 DB) */
export const TAURI_GLASS_KEY = 'tauri-glass'

/** 设置弹窗切换毛玻璃后派发该事件,TauriVisualFX 监听并重同步 */
export const TAURI_GLASS_EVENT = 'tauri-glass-change'

/** 读当前毛玻璃偏好(默认开) */
export function getGlassEnabled(): boolean {
  try {
    return localStorage.getItem(TAURI_GLASS_KEY) !== 'off'
  } catch {
    return true
  }
}

/**
 * 客户端(Tauri)专属视觉增强宿主。Web 端渲染 null,零影响。
 *
 * - 失焦降饱和:监听窗口焦点,失焦时 html 上挂 data-tauri-blurred;
 *   灰罩(.tauri-blur-overlay)与红绿灯变灰由 CSS 门控生效
 * - 系统毛玻璃:挂载时读 localStorage 同步 html[data-glass] 属性 +
 *   调 Rust set_glass_effect(Mica/Acrylic);
 *   监听 TAURI_GLASS_EVENT(设置开关)与 html.dark 变化(主题切换时重同步着色)
 */
export function TauriVisualFX() {
  const isTauri = useIsTauri()
  const [blurred, setBlurred] = useState(false)

  // 焦点态写入 html 属性:纯 CSS 门控,避免全树重渲染
  useEffect(() => {
    if (!isTauri) return
    if (blurred) document.documentElement.setAttribute('data-tauri-blurred', '')
    else document.documentElement.removeAttribute('data-tauri-blurred')
  }, [isTauri, blurred])

  useEffect(() => {
    if (!isTauri) return
    const cleanupFocus = tauri.onFocusChange(setBlurred)

    const syncGlass = () => {
      // 搭子悬浮球是透明桌宠形态:不吃玻璃模式,否则 body 半透明底色会在球后露出方块
      if (window.location.pathname.startsWith('/buddy')) {
        document.documentElement.removeAttribute('data-glass')
        return
      }
      const enabled = getGlassEnabled()
      const dark = document.documentElement.classList.contains('dark')
      if (enabled) document.documentElement.setAttribute('data-glass', '')
      else document.documentElement.removeAttribute('data-glass')
      void tauri.setGlass(enabled, dark)
    }

    syncGlass()
    window.addEventListener(TAURI_GLASS_EVENT, syncGlass)
    // 跨窗口同步:设置子窗口/其他 webview 里改了 localStorage 会触发 storage 事件
    window.addEventListener('storage', syncGlass)
    // 主题切换(html.dark 增删)时重同步 Mica/Acrylic 着色
    const themeObserver = new MutationObserver(syncGlass)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => {
      cleanupFocus()
      window.removeEventListener(TAURI_GLASS_EVENT, syncGlass)
      window.removeEventListener('storage', syncGlass)
      themeObserver.disconnect()
    }
  }, [isTauri])

  if (!isTauri) return null
  return <div className="tauri-blur-overlay" aria-hidden="true" />
}
