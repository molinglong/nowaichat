'use client'

import { useEffect } from 'react'

/**
 * 监听 visualViewport 变化,把"被键盘挤掉的高度"写入 --keyboard-height。
 *
 * - 桌面端 visualViewport ≈ layout viewport,差值为 0,键盘变量始终 0px
 * - iOS Safari / Android Chrome 弹软键盘时,visualViewport.height 变小,
 *   window.innerHeight - visualViewport.height - visualViewport.offsetTop
 *   就是键盘大致高度
 *
 * 任何需要顶住键盘的底部元素,只需:
 *   padding-bottom: var(--keyboard-height, 0px);
 * 或 Tailwind: `pb-[length:var(--keyboard-height,0px)]`
 *
 * 不返回值,纯副作用 hook(挂载即开始监听,卸载自动清理)。
 */
export function useVisualViewport(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const vv = window.visualViewport
    if (!vv) return

    const update = () => {
      // 计算键盘高度:
      //   layout viewport = window.innerHeight
      //   visual viewport  = vv.height(键盘弹出时缩小)
      //   offsetTop        = vv.top(地址栏隐藏/键盘弹出时的偏移)
      // 键盘高度 = innerHeight - (vv.height + vv.offsetTop - maxOffset)
      // 简化做法:max(0, innerHeight - vv.height - vv.offsetTop)
      //   桌面 vv.height ≈ innerHeight,offsetTop=0 → 0
      //   iOS 键盘弹出,vv.height 变小 → 正值
      const layoutHeight = window.innerHeight
      const visualBottom = vv.height + vv.offsetTop
      const keyboardHeight = Math.max(0, layoutHeight - visualBottom)
      document.documentElement.style.setProperty(
        '--keyboard-height',
        `${keyboardHeight}px`,
      )
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    window.addEventListener('resize', update)

    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      // 卸载时复位,避免切回其它 layout 时残留
      document.documentElement.style.setProperty('--keyboard-height', '0px')
    }
  }, [])
}