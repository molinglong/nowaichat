import { useRef, useCallback } from 'react'

/**
 * Single-flight 锁 —— callback 执行期间屏蔽重复点击,执行完才解锁。
 *
 * 适用场景:按钮点击、提交操作等"按下就该有反应"的交互。
 * 不适用:连续输入、滚动等需要节流/防抖的场景(用 useDebouncedCallback)。
 *
 * 与 useDynamicDebounce 的关键区别:
 * - useDynamicDebounce: 基于时间窗口的防抖,200ms 内的合法点击会被吞
 * - useSingleFlight:   基于执行状态的锁,callback 没在跑就不拦
 *
 * @example
 * const handleCopy = useSingleFlight(async (text: string) => {
 *   await navigator.clipboard.writeText(text)
 *   toast.success('已复制')
 * }, [bodyText])
 *
 * <button onClick={() => handleCopy(text)}>复制</button>
 */
export function useSingleFlight<T extends (...args: any[]) => any>(
  callback: T,
  deps: React.DependencyList,
): T {
  const busy = useRef(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((...args: Parameters<T>) => {
    if (busy.current) return
    busy.current = true
    try {
      const result = callback(...args)
      // 异步 callback:等 Promise 完成再解锁
      if (result instanceof Promise) {
        result.finally(() => {
          busy.current = false
        })
      } else {
        // 同步 callback:立即解锁
        busy.current = false
      }
      return result
    } catch (err) {
      // 同步抛错也要解锁,否则按钮永远锁死
      busy.current = false
      throw err
    }
  }, deps) as T
}