import { useState, useCallback } from 'react'

/**
 * 批量条目开关状态 —— Record<string, boolean> 的统一操作集。
 *
 * 适用场景:同一组条目各自持有独立的布尔状态
 * (卡片展开/折叠、逐条 loading、显示密码、消息折叠等)。
 * 相比裸 useState<Record<string, boolean>>:
 * - 语义化操作(set/toggle/remove/clear),调用点不再写展开器
 * - remove 用"key 不存在则原样返回"的短路,避免多余渲染
 *
 * 不适用:状态值非布尔(用 useState<Record<string, T>>)或单条全局开关(直接 useState<boolean>)。
 *
 * @example
 * const [expanded, { toggle, set }] = useToggleMap({ [currentProviderId]: true })
 *
 * <div onClick={() => toggle(provider.id)}>...</div>
 */
export function useToggleMap(initial: Record<string, boolean> = {}) {
  const [map, setMap] = useState<Record<string, boolean>>(initial)

  /** 置为指定值 */
  const set = useCallback((key: string, value: boolean) => {
    setMap((s) => ({ ...s, [key]: value }))
  }, [])

  /** 取反 */
  const toggle = useCallback((key: string) => {
    setMap((s) => ({ ...s, [key]: !s[key] }))
  }, [])

  /** 移除条目(状态回落到"未记录",读值为 undefined/falsy) */
  const remove = useCallback((key: string) => {
    setMap((s) => {
      if (!(key in s)) return s
      const next = { ...s }
      delete next[key]
      return next
    })
  }, [])

  /** 清空全部 */
  const clear = useCallback(() => setMap({}), [])

  return [map, { set, toggle, remove, clear }] as const
}

export type ToggleMap = Record<string, boolean>
export type ToggleMapControls = ReturnType<typeof useToggleMap>[1]
