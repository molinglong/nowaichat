'use client'

import { useSyncExternalStore } from 'react'

/**
 * 电脑模式判定 —— 「对话资料」等重面板的显隐门。
 *
 * 判据 = 主指针是鼠标/触控板(pointer: fine) 且 视口 ≥768px(与面板自身 md: 断点同口径):
 *   - 手机、平板(含横屏 iPad / 安卓平板)主指针是触屏 → 一律不算电脑
 *   - 触屏笔记本(主指针仍是鼠标)算电脑;iPad 接外接触控板后 pointer 变 fine,也按电脑处理
 */
const COMPUTER_MEDIA = '(min-width: 768px) and (pointer: fine)'

function subscribe(onStoreChange: () => void) {
  const mql = window.matchMedia(COMPUTER_MEDIA)
  mql.addEventListener('change', onStoreChange)
  return () => mql.removeEventListener('change', onStoreChange)
}

function getSnapshot() {
  return window.matchMedia(COMPUTER_MEDIA).matches
}

/** 服务端快照恒 false:聊天页在 Suspense 下客户端渲染,首帧即拿到真值,不会误显示在平板上 */
export function useIsComputerMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
