import { useRef, useCallback, useEffect } from 'react'

/**
 * 末尾触发式 debounce —— 多次调用合并,只执行最后一次
 *
 * 与 useDynamicDebounce 区别:
 * - useDynamicDebounce: 冷启动期间/预热后忽略重复点击(用于按钮防误触)
 * - useDebouncedCallback: 滑动条/输入框等连续输入场景,等待用户停顿后再执行
 *
 * @example
 * const persist = useDebouncedCallback((value: number) => {
 *   fetch('/api/save', { body: JSON.stringify({ value }) })
 *   toast.success(`已保存: ${value}`)
 * }, 300)
 *
 * <input onChange={(e) => persist(e.target.value)} />
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  fn: T,
  delayMs: number
): T {
  const fnRef = useRef(fn)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastArgsRef = useRef<Parameters<T> | null>(null)

  // 同步最新 fn(避免闭包陷阱)
  useEffect(() => {
    fnRef.current = fn
  }, [fn])

  // 卸载时清理 pending timer
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((...args: Parameters<T>) => {
    lastArgsRef.current = args
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (lastArgsRef.current) {
        const a = lastArgsRef.current
        fnRef.current(...a)
      }
      timerRef.current = null
    }, delayMs)
  }, [delayMs]) as T
}