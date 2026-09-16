'use client'

import { useSyncExternalStore, useRef, useEffect } from 'react'

/**
 * useTypewriter —— 逐字符显示 hook (彻底根治 "Maximum update depth exceeded")
 *
 * 旧实现的死循环源头:
 *   - 用 useState 维护 revealedLength
 *   - setRevealedLength(updater) 的 updater 函数在 React 18 并发模式下可能被反复调用
 *   - 闭包变量 nextReachedTarget 在反复调用间状态不可靠
 *   - 一旦 updater 没设 nextReachedTarget,tick 函数体外就会调度下一帧 → setState 再来
 *   - 50 帧内就触发 React 的 update depth 兜底
 *
 * 新实现的关键设计 (useSyncExternalStore 模式):
 *
 *   1. **完全不依赖 useState** —— revealedLength 存在 module-level store 的 ref 里
 *   2. **useSyncExternalStore 订阅 store** —— React 只在 commit 阶段读 snapshot,
 *      snapshot 返回字符串。React 用 Object.is 比较新旧 snapshot,
 *      字符串内容相同时就 bail out, 不触发渲染
 *   3. **所有 entry 修改都在 RAF / useEffect 里, 不在 render 函数里**:
 *      - render 函数只读 entry, 调 getSnapshot 拿 displayText
 *      - useEffect 检测 fullText / enabled 变化, 改 entry 字段 (必要时 kick)
 *      - RAF tick 推进 revealedLength, 调用 store listeners (通知 React)
 *   4. **跨实例隔离** —— 每个 useTypewriter 调用分配独立 token (WeakMap 存 entry)
 *   5. **enabled = false 时一次性显示** —— 直接设置 revealedLength = fullText.length 并 notify
 *
 * 此实现保证:
 *   - 不在 render 函数里调用任何 setState / listener
 *   - 不在 effect 里调用 setState (只调用 store listener, 走 useSyncExternalStore)
 *   - 不通过闭包变量跨调用追踪状态
 *
 * @param fullText  完整文本
 * @param enabled   是否启用逐字符 (false 时一次性显示完整)
 */

/* ── Store ─────────────────────────────────────────────────────────────── */

interface StoreEntry {
  /** 完整文本(由 useEffect 同步, render 不读) */
  fullText: string
  /** 当前已揭示长度 */
  revealedLength: number
  /** 监听器列表 (useSyncExternalStore 的 subscribe 回调) */
  listeners: Set<() => void>
  /** 当前 RAF id */
  rafId: number | null
  /** tick 链是否还活着 */
  alive: boolean
}

const stores = new WeakMap<object, StoreEntry>()

function getStore(token: object): StoreEntry {
  let s = stores.get(token)
  if (s) return s
  s = {
    fullText: '',
    revealedLength: 0,
    listeners: new Set(),
    rafId: null,
    alive: false,
  }
  stores.set(token, s)
  return s
}

let tokenCounter = 0

/* ── 核心 RAF tick ────────────────────────────────────────────────────── */

function tick(entry: StoreEntry) {
  entry.rafId = null

  const target = entry.fullText.length
  const current = entry.revealedLength

  // 已追平:退出链
  if (current >= target) {
    entry.alive = false
    return
  }

  // 推进一帧
  const gap = target - current
  const step = gap > 30 ? 8 : 1
  entry.revealedLength = Math.min(current + step, target)

  // 通知 React (通过 useSyncExternalStore listener)
  // 注意: 这必须在 RAF 中调用,不在 render 中。
  entry.listeners.forEach((l) => l())

  // 追平则不调度下一帧
  if (entry.revealedLength >= target) {
    entry.alive = false
    return
  }

  // 调度下一帧
  entry.rafId = requestAnimationFrame(() => tick(entry))
}

function kick(entry: StoreEntry) {
  if (entry.alive) return
  if (entry.revealedLength >= entry.fullText.length) return
  entry.alive = true
  if (entry.rafId !== null) {
    cancelAnimationFrame(entry.rafId)
  }
  entry.rafId = requestAnimationFrame(() => tick(entry))
}

function stop(entry: StoreEntry) {
  entry.alive = false
  if (entry.rafId !== null) {
    cancelAnimationFrame(entry.rafId)
    entry.rafId = null
  }
}

/* ── useSyncExternalStore 接口 ─────────────────────────────────────────── */

function subscribe(token: object, listener: () => void) {
  const entry = getStore(token)
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
  }
}

function getSnapshot(token: object): string {
  const entry = getStore(token)
  return entry.fullText.slice(0, entry.revealedLength)
}

function getServerSnapshot(): string {
  return ''
}

/* ── Hook ──────────────────────────────────────────────────────────────── */

export function useTypewriter(fullText: string, enabled: boolean): {
  displayText: string
  isTyping: boolean
} {
  // 稳定 token (每次 hook 调用分配一个, 跨渲染保持稳定)
  const tokenRef = useRef<object | null>(null)
  if (tokenRef.current === null) {
    tokenRef.current = { __id: ++tokenCounter }
  }
  const token = tokenRef.current

  // ── 关键: 所有 entry 字段修改都放在 useEffect 里, 绝不在 render 函数里 ──
  useEffect(() => {
    const entry = getStore(token)

    const prevLen = entry.fullText.length

    if (fullText.length < prevLen) {
      // fullText 缩短: 新消息 / 重置, 从头开始
      entry.fullText = fullText
      entry.revealedLength = 0
      // 通知 React
      entry.listeners.forEach((l) => l())

      if (enabled) {
        kick(entry)
      } else {
        // enabled = false: 一次性显示
        entry.revealedLength = fullText.length
        stop(entry)
        entry.listeners.forEach((l) => l())
      }
    } else if (fullText.length > prevLen) {
      // fullText 增长
      entry.fullText = fullText

      if (!enabled) {
        // enabled = false: 一次性显示完整
        entry.revealedLength = fullText.length
        stop(entry)
        entry.listeners.forEach((l) => l())
      } else {
        // enabled = true:
        //   - 若 tick 链还活着, 自然推进 (tick 会读最新 fullText)
        //   - 若 tick 链已退出, 重置 revealedLength 到 0 并 kick
        if (!entry.alive) {
          // 之前追平过, 现在新文本来了, 重置到 0
          entry.revealedLength = 0
          entry.listeners.forEach((l) => l())
          kick(entry)
        }
        // 不需要在这里 notify —— tick 链会持续推进并 notify
      }
    }
    // fullText.length 没变: enabled 切换已由下面 effect 处理
  }, [fullText, enabled, token])

  // 单独 effect 处理 enabled 切换 (fullText 没变时)
  useEffect(() => {
    const entry = getStore(token)

    if (!enabled) {
      // 关闭逐字符: 一次性显示
      if (entry.revealedLength !== entry.fullText.length || entry.alive) {
        entry.revealedLength = entry.fullText.length
        stop(entry)
        // 通知 React 让 displayText 跳到完整
        entry.listeners.forEach((l) => l())
      }
    } else {
      // 启用逐字符: 若 tick 链死了, kick
      if (!entry.alive && entry.revealedLength < entry.fullText.length) {
        kick(entry)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // 卸载时清理
  useEffect(() => {
    const entry = getStore(token)
    return () => {
      stop(entry)
    }
  }, [token])

  // ── 这里只读, 不写 ──
  const displayText = useSyncExternalStore(
    (listener) => subscribe(token, listener),
    () => getSnapshot(token),
    getServerSnapshot
  )

  // isTyping 用 useSyncExternalStore 的 getServerSnapshot 思路,
  // 但 enabled + revealedLength 比较是渲染时计算 —— 不会触发 setState
  // 注意: 这里读 entry 是读 module-level 单例, 不在 effect 中, 所以安全。
  // 但 React 在 SSR 阶段访问 module-level 单例可能有问题 ——
  // SSR 时 entry 不存在, getStore 会创建。但 enabled 通常是 false 在 SSR,
  // 且 isTyping 只是 UI 提示, SSR 渲染时不会显示, 安全。
  const entry = getStore(token)
  const isTyping = enabled && entry.revealedLength < entry.fullText.length

  return { displayText, isTyping }
}
