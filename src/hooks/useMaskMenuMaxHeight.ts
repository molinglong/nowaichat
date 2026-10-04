'use client'

import { useLayoutEffect, useRef, useState } from 'react'

/** 封顶盒高: 搜索 41 + 列表窗 318 + 钉底 37 + 边框 2(与 MaskPickerMenu 分区对齐) */
export const MASK_MENU_MAX_BOX_HEIGHT = 398
/** 触发钮到菜单盒的间距(bottom-full/top-full 的 6px) */
const TRIGGER_GAP = 6
/** 视口安全边距 */
const EDGE = 8

/**
 * 向上弹时菜单顶的下界: 视口安全边距, 且要避开应用顶栏带(md 以下的 shell header)。
 * 顶栏是 fixed 玻璃带, 只按视口顶夹取会让菜单顶(搜索框)钻到它下面 —— 实测 390×844 上
 * 搜索框 15.9~43.9px 正落在顶栏 7~51px 里, 点不到。
 */
function topFloor(): number {
  const bar = document.querySelector('[data-app-topbar]')
  const rect = bar?.getBoundingClientRect()
  if (!rect || rect.width === 0 || rect.height === 0) return EDGE
  return Math.max(EDGE, Math.round(rect.bottom) + EDGE)
}

/**
 * 向下弹时菜单底的上界: 内容列(main, overflow-hidden)底缘 − 安全边距。
 * 菜单是 absolute, 逃不出 main 的裁剪; 只按视口高夹取会让菜单底(钉底栏)被裁掉 ——
 * 实测 390×844 超出 10px、390×667 超出 56px(钉底栏整行不可见/不可点)。
 * main 缺失(独立预览等)时退回视口底。
 */
function bottomFloor(): number {
  const main = document.querySelector('main')
  const rect = main?.getBoundingClientRect()
  if (!rect || rect.width === 0 || rect.height === 0) return window.innerHeight - EDGE
  return Math.min(window.innerHeight, Math.round(rect.bottom) - EDGE)
}

/**
 * 面具菜单盒高的视口夹取: 取触发钮一侧(向上/向下)的可用空间, 封顶 398。
 * 向下弹(欢迎页面具钮 / 移动端 ⋯ 面具菜单 / 会话页面具 chip) → min(视口底, main 底缘) − 触发钮 bottom − 14;
 * 向上弹 → 触发钮 top − 6 − 下界(顶栏或视口顶 + 8)。
 */
export function useMaskMenuMaxHeight(open: boolean, direction: 'up' | 'down' = 'up') {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [maxHeight, setMaxHeight] = useState(MASK_MENU_MAX_BOX_HEIGHT)

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const available =
        direction === 'up'
          ? rect.top - TRIGGER_GAP - topFloor()
          : bottomFloor() - rect.bottom - TRIGGER_GAP
      // 向下取整: 盒高只能小于等于可用空间,否则舍入会把安全边距吃穿
      setMaxHeight(Math.max(0, Math.min(MASK_MENU_MAX_BOX_HEIGHT, Math.floor(available))))
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, direction])

  return { triggerRef, maxHeight }
}
