'use client'

import { useEffect } from 'react'

/**
 * 全局 React 错误捕获:开发模式打印完整堆栈(包括 React componentStack),
 * 方便定位 "Maximum update depth exceeded" 这类循环错误的真正元凶。
 *
 * 装在全局 layout 上,通过 override console.error 拦所有 React 警告/错误,
 * 并把 componentStack 单独打到 console.group 里(避免普通 console.log 被淹没)。
 */
export function ReactErrorLogger() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (process.env.NODE_ENV === 'production') return

    const originalError = console.error.bind(console)
    let inLogger = false
    console.error = (...args: unknown[]) => {
      // 防止自递归
      if (inLogger) {
        originalError(...args)
        return
      }
      inLogger = true
      try {
        const first = args[0]
        const firstStr = typeof first === 'string' ? first : ''
        const isReactError =
          firstStr.includes('Maximum update depth') ||
          firstStr.includes('Too many re-renders') ||
          firstStr.includes('Cannot update a component while rendering')

        if (isReactError) {
          // 把所有参数散到分组里,React 会把 componentStack 放在后续参数
          // 用 groupCollapsed 折叠避免污染主控制台
          originalError('[ReactErrorLogger] 捕获到 React 循环更新错误')
          originalError('完整参数(后续 argument 即 React 提供的 componentStack):')
          for (let i = 0; i < args.length; i++) {
            const arg = args[i]
            if (arg instanceof Error) {
              originalError(`arg[${i}] Error.message:`, arg.message)
              originalError(`arg[${i}] Error.stack:`, arg.stack)
            } else if (typeof arg === 'string') {
              originalError(`arg[${i}] string:`, arg)
            } else {
              originalError(`arg[${i}]:`, arg)
            }
          }
        }
        originalError(...args)
      } finally {
        inLogger = false
      }
    }

    return () => {
      console.error = originalError
    }
  }, [])

  return null
}
