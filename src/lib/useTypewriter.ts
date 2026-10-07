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
  /** 揭示位置的小数累加器: 低速帧位移不足 1 字符时不丢量, 否则慢速档会被 floor 吃停 */
  revealedPos: number
  /** 平滑后的瞬时速度(字符/秒) */
  rate: number
  /** 本实例速度上限(字符/秒)。默认 RATE_MAX;推理小窗等"永不追平"的流用它压低
   *  稳态速度:RATE_MAX 下每帧推进 ~25 字(半行),行粒度位移观感就是"一跳一跳" */
  rateCap: number
  /** 上一帧时间戳(ms), 用于把推进量换算成时间基 */
  lastTs: number
  /** 监听器列表 (useSyncExternalStore 的 subscribe 回调) */
  listeners: Set<() => void>
  /** 当前 RAF id */
  rafId: number | null
  /** tick 链是否还活着 */
  alive: boolean
}

const stores = new WeakMap<object, StoreEntry>()

/* ── 时间基推进参数 ─────────────────────────────────────────────────────
 * 旧实现是帧基: step = max(1, min(24, gap/12)) —— 速度是「剩余差距」的阶跃函数,
 * 而差距由上游 chunk 到达节奏决定, 于是屏上速度在 60 与 1440 字符/秒之间硬切,
 * 观感就是"爬一段、爆一下、再爬"。
 * 新实现: 目标速度仍是差距的函数但连续, 实际速度用指数平滑跟踪, 位移对时间积分
 * —— 上游再怎么抖, 屏上推进速度都是条平滑曲线, 且与屏幕刷新率无关。 */
const RATE_MIN = 60 // 字符/秒下限(旧版 1 字符/帧@60Hz 的量级, 保证不更慢)
const RATE_MAX = 1500 // 字符/秒上限(旧版 24 字符/帧@60Hz≈1440, 同档兜住远程轮询整段补进)
const RATE_GAIN = 3.2 // 差距→目标速度的斜率
const TAU_MS = 240 // 平滑时间常数: 越小越跟手, 越大越顺滑
// 后台标签页里 RAF 被节流到 ~1 帧/秒, dt 不钳一次就跳几百字符
const MAX_DT_MS = 48

function targetRate(gap: number, cap: number): number {
  return Math.min(cap, RATE_MIN + gap * RATE_GAIN)
}

function getStore(token: object): StoreEntry {
  let s = stores.get(token)
  if (s) return s
  s = {
    fullText: '',
    revealedLength: 0,
    revealedPos: 0,
    rate: RATE_MIN,
    rateCap: RATE_MAX,
    lastTs: 0,
    listeners: new Set(),
    rafId: null,
    alive: false,
  }
  stores.set(token, s)
  return s
}

let tokenCounter = 0

/* ── 核心 RAF tick ────────────────────────────────────────────────────── */

function tick(entry: StoreEntry, now: number) {
  entry.rafId = null

  const target = entry.fullText.length

  // 已追平:退出链
  if (entry.revealedPos >= target) {
    entry.alive = false
    return
  }

  const dtMs = entry.lastTs ? Math.min(MAX_DT_MS, Math.max(1, now - entry.lastTs)) : 16.7
  entry.lastTs = now

  const gap = target - entry.revealedPos
  entry.rate += (targetRate(gap, entry.rateCap) - entry.rate) * (1 - Math.exp(-dtMs / TAU_MS))

  entry.revealedPos = Math.min(target, entry.revealedPos + (entry.rate * dtMs) / 1000)
  entry.revealedLength = Math.floor(entry.revealedPos)

  // 通知 React (通过 useSyncExternalStore)
  // 注意: 这必须在 RAF 中调用,不在 render 中。
  entry.listeners.forEach((l) => l())

  // 追平则不调度下一帧
  if (entry.revealedPos >= target) {
    entry.alive = false
    return
  }

  // 调度下一帧
  entry.rafId = requestAnimationFrame((t) => tick(entry, t))
}

function kick(entry: StoreEntry) {
  if (entry.alive) return
  if (entry.revealedLength >= entry.fullText.length) return
  entry.alive = true
  entry.lastTs = 0
  if (entry.rafId !== null) {
    cancelAnimationFrame(entry.rafId)
  }
  entry.rafId = requestAnimationFrame((t) => tick(entry, t))
}

function stop(entry: StoreEntry) {
  entry.alive = false
  if (entry.rafId !== null) {
    cancelAnimationFrame(entry.rafId)
    entry.rafId = null
  }
}

/** 一次性揭示到全文(关闭逐字符 / 重置时用), 同步三个派生字段 */
function revealAll(entry: StoreEntry) {
  entry.revealedPos = entry.fullText.length
  entry.revealedLength = entry.fullText.length
  entry.rate = RATE_MIN
  stop(entry)
  entry.listeners.forEach((l) => l())
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

/* ── Hook ─────────────────────────────────────────────────────────────── */

export function useTypewriter(fullText: string, enabled: boolean, maxRate?: number): {
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
    entry.rateCap = maxRate && maxRate > 0 ? maxRate : RATE_MAX

    const prevLen = entry.fullText.length

    if (fullText.length < prevLen) {
      // fullText 缩短: 新消息 / 重置, 从头开始
      entry.fullText = fullText
      entry.revealedPos = 0
      entry.revealedLength = 0
      entry.rate = RATE_MIN
      // 通知 React
      entry.listeners.forEach((l) => l())

      if (!enabled) {
        // enabled = false: 一次性显示
        revealAll(entry)
      } else {
        kick(entry)
      }
    } else if (fullText.length > prevLen) {
      // fullText 增长
      entry.fullText = fullText

      if (!enabled) {
        // enabled = false: 一次性显示完整
        revealAll(entry)
      } else {
        // enabled = true:
        //   - 若 tick 链还活着, 自然推进 (tick 会读最新 fullText)
        //   - 若 tick 链已退出(上游慢、打字追平后新 chunk 才到), 保持已揭示
        //     位置原地续打只 kick —— 不能重置为 0: 慢速流式下"追平→新chunk"
        //     反复出现, 清零会造成跳 0 再整段快速重放的回跳观感
        if (!entry.alive) {
          kick(entry)
        }
        // 不需要在这里 notify —— tick 链会持续推进并 notify
      }
    }
    // fullText.length 没变: enabled 切换已由下面 effect 处理
  }, [fullText, enabled, token, maxRate])

  // 单独 effect 处理 enabled 切换 (fullText 没变时)
  useEffect(() => {
    const entry = getStore(token)

    if (!enabled) {
      // 关闭逐字符: 一次性显示
      if (entry.revealedLength !== entry.fullText.length || entry.alive) {
        revealAll(entry)
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
  // 但 SSR 时 entry 不存在, getStore 会创建。但 enabled 通常是 false 在 SSR,
  // 且 isTyping 只是 UI 提示, SSR 渲染时不会显示, 安全。
  const entry = getStore(token)
  const isTyping = enabled && entry.revealedLength < entry.fullText.length

  return { displayText, isTyping }
}
