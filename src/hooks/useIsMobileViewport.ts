'use client'

import { useSyncExternalStore } from 'react'

/**
 * 移动视口判定(≤767px)—— 方案 C 手机端壳层的显隐门。
 *
 * 判据与 Tailwind 的 md: 断点同口径(max-width: 767px),与 useIsComputerMode
 * 同款 useSyncExternalStore 实现;服务端快照恒 false,首帧按桌面渲染,
 * 水合后拿到真值再切 —— 不产生 hydration 分歧。
 */
const MOBILE_MEDIA = '(max-width: 767px)'

function subscribe(onStoreChange: () => void) {
  const mql = window.matchMedia(MOBILE_MEDIA)
  mql.addEventListener('change', onStoreChange)
  return () => mql.removeEventListener('change', onStoreChange)
}

function getSnapshot() {
  return window.matchMedia(MOBILE_MEDIA).matches
}

export function useIsMobileViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
