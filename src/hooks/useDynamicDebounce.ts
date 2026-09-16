import { useRef, useEffect, useCallback } from 'react'

/**
 * 动态防抖 Hook - 冷启动优化
 * 
 * 冷启动期间（前 2 秒）：使用较短的防抖时间（默认 50ms），快速响应用户操作
 * 预热完成后：使用正常的防抖时间（默认 200ms），防止误触和重复点击
 * 
 * @param callback - 需要防抖的回调函数
 * @param deps - 依赖数组（类似 useCallback）
 * @param options - 配置选项
 * @returns 经过防抖处理的函数
 * 
 * @example
 * const handleClick = useDynamicDebounce(() => {
 *   console.log('Clicked!')
 * }, [])
 */
export function useDynamicDebounce<T extends (...args: any[]) => any>(
  callback: T,
  deps: React.DependencyList,
  options: {
    /** 冷启动期间的防抖时间（毫秒），默认 50ms */
    coldDebounceMs?: number
    /** 预热完成后的防抖时间（毫秒），默认 200ms */
    warmDebounceMs?: number
    /** 预热时长（毫秒），默认 2000ms */
    warmupDurationMs?: number
  } = {}
): T {
  const {
    coldDebounceMs = 50,
    warmDebounceMs = 200,
    warmupDurationMs = 2000,
  } = options

  const lastCallTime = useRef<number>(0)
  const isWarmingUp = useRef<boolean>(true)

  // 标记预热完成
  useEffect(() => {
    const timer = setTimeout(() => {
      isWarmingUp.current = false
    }, warmupDurationMs)
    return () => clearTimeout(timer)
  }, [warmupDurationMs])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((...args: Parameters<T>) => {
    const now = Date.now()
    const debounceMs = isWarmingUp.current ? coldDebounceMs : warmDebounceMs
    
    // 防抖检查：距离上次调用时间太短，忽略本次调用
    if (now - lastCallTime.current < debounceMs) {
      return
    }
    
    lastCallTime.current = now
    return callback(...args)
  }, deps) as T
}
