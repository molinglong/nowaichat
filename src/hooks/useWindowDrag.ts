'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

// SSR 安全的 useLayoutEffect(Next.js 服务端渲染时降级为 useEffect)
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

type Offset = { dx: number; dy: number }

// 拖拽热区判定(macOS 惯例):
// - [data-drag-handle] = 标题栏语义手柄,按下立即拖(无阈值)
// - 交互元素与 [data-no-drag](滚动区等)完全不接管,保留原生点击/滚动
// - 其余卡片内非交互空白 = 按住拖动(位移超阈值才激活,防止误触)
const HANDLE_SELECTOR = '[data-drag-handle]'
const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, label, [contenteditable="true"], [data-no-drag]'
const DRAG_THRESHOLD = 5

function isValidOffset(v: unknown): v is Offset {
  if (!v || typeof v !== 'object') return false
  const o = v as Partial<Offset>
  return typeof o.dx === 'number' && typeof o.dy === 'number' && isFinite(o.dx) && isFinite(o.dy)
}

/**
 * 桌面端浮动窗口拖拽(零依赖,pointer events 实现)。
 * 位置模型:视口中心 + 偏移(dx,dy)。拖动期间直写 DOM transform,避免大组件逐帧重渲染;松手才提交 state 并持久化 localStorage。
 */
export function useWindowDrag({
  cardRef,
  enabled,
  active,
  storageKey,
}: {
  cardRef: RefObject<HTMLDivElement | null>
  enabled: boolean
  active: boolean
  storageKey: string
}) {
  const [pos, setPos] = useState<Offset>({ dx: 0, dy: 0 })
  const liveRef = useRef<Offset>({ dx: 0, dy: 0 }) // 当前已应用的偏移(拖动中的实时真值)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseDx: number; baseDy: number; threshold: number; activated: boolean } | null>(null)
  const suppressClickRef = useRef<((ev: Event) => void) | null>(null)

  // 按卡片实测尺寸把偏移钳制在视口内(8px 边距);rect 含当前 transform,需先扣除得到未偏移基准
  const clamp = useCallback((dx: number, dy: number): Offset => {
    const card = cardRef.current
    if (!card) return { dx, dy }
    const rect = card.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return { dx, dy }
    const baseLeft = rect.left - liveRef.current.dx
    const baseTop = rect.top - liveRef.current.dy
    const margin = 8
    return {
      dx: Math.min(Math.max(dx, margin - baseLeft), window.innerWidth - margin - (baseLeft + rect.width)),
      dy: Math.min(Math.max(dy, margin - baseTop), window.innerHeight - margin - (baseTop + rect.height)),
    }
  }, [cardRef])

  const apply = useCallback((next: Offset) => {
    liveRef.current = next
    const card = cardRef.current
    if (card) card.style.transform = `translate(${next.dx}px, ${next.dy}px)`
  }, [cardRef])

  // active+enabled 开启时恢复持久化位置并在 resize 时重新钳制;关闭时清掉 transform(移动端抽屉/未打开时不得带位移)
  useIsomorphicLayoutEffect(() => {
    if (!enabled || !active) {
      const card = cardRef.current
      if (card) {
        card.style.transform = ''
        card.style.cursor = ''
      }
      liveRef.current = { dx: 0, dy: 0 }
      return
    }
    let saved: Offset | null = null
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) saved = JSON.parse(raw)
    } catch { /* 忽略坏数据 */ }
    if (!isValidOffset(saved)) saved = null
    apply(clamp(saved?.dx ?? 0, saved?.dy ?? 0))
    setPos(liveRef.current)
    const onResize = () => {
      apply(clamp(liveRef.current.dx, liveRef.current.dy))
      setPos(liveRef.current)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [enabled, active, storageKey, clamp, apply])

  const beginDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>, threshold: number) => {
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, baseDx: liveRef.current.dx, baseDy: liveRef.current.dy, threshold, activated: false }
  }, [])

  // 阈值达标后正式激活:捕获指针到卡片 + grabbing 光标 + 禁文本选择 + 抑制松手误 click
  const activateDrag = useCallback(() => {
    const d = dragRef.current
    const card = cardRef.current
    if (!d || !card || d.activated) return
    d.activated = true
    try { card.setPointerCapture(d.pointerId) } catch { /* 部分环境对合成 pointerId 会抛错,不阻断 */ }
    card.style.cursor = 'grabbing'
    document.documentElement.style.userSelect = 'none'
    const suppress = (ev: Event) => {
      ev.stopPropagation()
      ev.preventDefault()
      suppressClickRef.current = null
    }
    document.addEventListener('click', suppress, { capture: true, once: true })
    suppressClickRef.current = suppress
    // 清掉阈值等待期间可能产生的误选区
    window.getSelection()?.removeAllRanges()
  }, [cardRef])

  const endDragVisual = useCallback(() => {
    const card = cardRef.current
    if (card) card.style.cursor = ''
    document.documentElement.style.userSelect = ''
  }, [cardRef])

  const onCardPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || !active || e.button !== 0) return
    // 清理上一次异常残留(如 pointerup 丢失):还原光标/选择状态
    if (dragRef.current?.activated) {
      endDragVisual()
      dragRef.current = null
    }
    const target = e.target as HTMLElement
    // 标题栏语义手柄:立即拖
    if (target.closest(HANDLE_SELECTOR)) {
      e.preventDefault()
      beginDrag(e, 0)
      return
    }
    // 交互元素与标记区不接管(红点/表单/链接/滚动区保持原生行为)
    if (target.closest(INTERACTIVE_SELECTOR)) return
    beginDrag(e, DRAG_THRESHOLD)
  }, [enabled, active, cardRef, beginDrag, endDragVisual])

  const onCardPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    if (!d.activated) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < d.threshold) return
      activateDrag()
    }
    apply(clamp(d.baseDx + (e.clientX - d.startX), d.baseDy + (e.clientY - d.startY)))
  }, [clamp, apply, activateDrag])

  const commit = useCallback(() => {
    if (!dragRef.current) return
    dragRef.current = null
    setPos(liveRef.current)
    try { localStorage.setItem(storageKey, JSON.stringify(liveRef.current)) } catch { /* 存储不可用时忽略 */ }
  }, [storageKey])

  const onCardPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    dragRef.current = null
    if (d.activated) {
      commit()
      endDragVisual()
      // suppress click 监听保持一次性挂载,由紧随的 click 自行消费
    }
  }, [commit, endDragVisual])

  // 系统手势打断(pointercancel):回滚到拖拽前位置
  const onCardPointerCancel = useCallback(() => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    if (d.activated) {
      apply(clamp(d.baseDx, d.baseDy))
      setPos(liveRef.current)
      endDragVisual()
      if (suppressClickRef.current) {
        document.removeEventListener('click', suppressClickRef.current, { capture: true })
        suppressClickRef.current = null
      }
    }
  }, [apply, clamp, endDragVisual])

  // 双击标题栏手柄复位居中
  const recenter = useCallback(() => {
    if (!enabled || !active) return
    apply({ dx: 0, dy: 0 })
    setPos({ dx: 0, dy: 0 })
    try { localStorage.setItem(storageKey, JSON.stringify({ dx: 0, dy: 0 })) } catch { /* 忽略 */ }
  }, [enabled, active, apply, storageKey])

  return { pos, onCardPointerDown, onCardPointerMove, onCardPointerUp, onCardPointerCancel, recenter }
}
