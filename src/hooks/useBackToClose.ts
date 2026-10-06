'use client'

import { useEffect, useRef } from 'react'

/**
 * 让系统/浏览器「返回」先关浮层，而不是整页 goBack。
 *
 * 背景：设置、抽屉这类浮层不开新路由，因此不产生任何历史条目。在 Tauri 安卓壳里
 * 返回键由 wry 生成的 WryActivity 固定处理成「WebView 能 goBack 就 goBack」
 * （见 src-tauri/gen/android/.../WryActivity.kt），于是浮层开着时按返回会直接跳回
 * 上一个页面（实测：设置 → 返回 → 掉回 /login）。手机浏览器的手势返回同一条路径。
 *
 * 做法：浮层「这一组」打开时压入一条同 URL 的哨兵历史条目，返回键先弹掉它，
 * 我们在 popstate 里关掉最上层那一个。
 *
 * 为什么一组一条、而不是每个浮层各一条（实测踩过的坑）：浮层交接时旧浮层不是即时
 * 卸载的 —— 抽屉有 450ms 滑出动画，它真正卸载时新浮层的 effect 早跑完了，
 * 「按实例各压一条」会留下两条哨兵：[空][哨兵A(抽屉)][哨兵B(设置)]，返回关掉设置后
 * 停在哨兵A 上，用户下一次按返回是「空响一声」哪也去不了
 * （tmp-check-back-stack.cjs 的 D1/D3 就是把这条量出来的）。
 * 共一条哨兵后，交接只是组成员变化，历史深度不动。
 */

const SENTINEL = 'aichattOverlayBackToken'

// 在架浮层的 id，底→顶。顶层 = 返回键该关的那一个。
const open: number[] = []
// id → 关闭回调（popstate 时只调最上层那个）
const closers = new Map<number, () => void>()
let seq = 0

// 全局一个 popstate 监听：按实例各挂各的会出现「一次返回关掉两层」。
let listenerInstalled = false

const currentToken = (): number | null => {
  const t = (typeof history !== 'undefined' ? (history.state as Record<string, unknown> | null) : null)?.[SENTINEL]
  return typeof t === 'number' ? t : null
}

// 只追加我们的标记，其余字段原样带上：整体替换 state 会让 Next App Router 认不出
// 这条记录，表现为整页重载（聊天状态全丢）。
const writeSentinel = (id: number, push: boolean) => {
  const state = { ...(history.state || {}), [SENTINEL]: id }
  if (push) history.pushState(state, '')
  else history.replaceState(state, '')
}

const installListener = () => {
  if (listenerInstalled || typeof window === 'undefined') return
  listenerInstalled = true
  window.addEventListener('popstate', () => {
    // 哨兵还挂在当前条目上 = 这次 popstate 弹的是别的东西（页面导航等），不归我们管。
    if (currentToken() !== null) return
    const id = open[open.length - 1]
    if (id === undefined) return
    open.pop()
    const fn = closers.get(id)
    closers.delete(id)
    fn?.()
    // 组里还剩下层浮层 → 补一条哨兵，返回键继续有得弹。
    if (open.length > 0) writeSentinel(++seq, true)
  })
}

// 「组已空、待弹掉自己那条哨兵」。必须延后到下一个宏任务：history.back() 是异步的，
// 而同 tick 里可能又开了新浮层，立即弹会把人家的条目弹掉。
let popArmed = false
function armPop() {
  popArmed = true
  setTimeout(() => {
    if (!popArmed) return
    // 交接：又有浮层进组了 → 这条哨兵归它们，不收。
    if (open.length > 0) {
      popArmed = false
      return
    }
    popArmed = false
    if (currentToken() !== null) history.back()
  }, 0)
}

export function useBackToClose(openNow: boolean, close: () => void) {
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    if (!openNow || typeof window === 'undefined') return

    installListener()
    const id = ++seq
    const wasEmpty = open.length === 0
    open.push(id)
    closers.set(id, () => closeRef.current())

    if (wasEmpty) {
      // 组从零起：正常压一条；若当前条目已带一条没人认领的残留哨兵（例如整页重载
      // 后模块状态清空而历史条目还在），就接管它而不是再叠一条。
      writeSentinel(id, currentToken() === null)
    } else if (currentToken() === null) {
      // 组里已有浮层却查不到哨兵（被别的导航顶掉了）→ 兜底补一条
      writeSentinel(id, true)
    }

    return () => {
      const i = open.lastIndexOf(id)
      if (i >= 0) open.splice(i, 1)
      closers.delete(id)
      // 组清空了才收哨兵；还有浮层就留着给它们用（交接不留残条目靠的就是这条）
      if (open.length === 0) armPop()
    }
  }, [openNow])
}
