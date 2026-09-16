'use client'

import { useEffect } from 'react'
import { ensureClient } from '@/lib/toast'

/**
 * 全局 toast 预热组件
 * - 在应用根挂载,提前触发 iziToast 客户端初始化,避免首次错误提示有 ~50ms 延迟
 * - 不会渲染任何 DOM
 */
export function ToasterBridge() {
  useEffect(() => {
    // 提前拉取脚本与 CSS,使后续 toast.show() 同步可用
    ensureClient().catch(() => {
      /* iziToast 加载失败时静默降级,业务仍可走原 alert/横幅 */
    })
  }, [])

  return null
}