/**
 * 未读追踪:每个会话一个 lastReadAt 时间戳,持久化到 localStorage.
 *
 * 为什么用 localStorage 而不是后端:
 * - 这是"本地应用内"的已读状态,跨设备同步意义不大(每个设备独立看自己的对话)
 * - 避免后端 schema 改动
 * - localStorage 读写即时,无网络往返
 *
 * 数据结构:{ [conversationId: string]: number }  (ISO 时间戳的 number 值)
 */

const STORAGE_KEY = 'chat:lastReadAt'

/** 读取所有 lastReadAt。SSR 期间返回空对象。 */
export function loadLastReadAt(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // 清洗:只保留 number 字段
      const cleaned: Record<string, number> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
          cleaned[k] = v
        }
      }
      return cleaned
    }
  } catch {
    // ignore corrupted storage
  }
  return {}
}

/** 把指定会话标记为已读(写入当前时间)。 */
export function persistLastReadAt(conversationId: string, ts: number = Date.now()) {
  if (typeof window === 'undefined') return
  try {
    const all = loadLastReadAt()
    all[conversationId] = ts
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // quota exceeded etc — 静默失败
  }
}

/** 删除会话时清理。 */
export function removeLastReadAt(conversationId: string) {
  if (typeof window === 'undefined') return
  try {
    const all = loadLastReadAt()
    delete all[conversationId]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // ignore
  }
}

/**
 * 计算会话是否"有未读消息"。
 *
 * 规则:
 * - 第一次访问(newId,从未标记过)→ 视为已读,不显示蓝点
 *   (否则用户历史会话全亮,第一次进就视觉爆炸)
 * - lastMessageAt > lastReadAt → 有未读
 *
 * @param conversationId - 会话 ID
 * @param lastMessageAt - 该会话最后一条消息时间(可来自会话的 updatedAt)
 * @param lastReadAtMap - 全量已读 map
 * @returns 是否有未读
 */
export function isUnread(
  conversationId: string,
  lastMessageAt: number,
  lastReadAtMap: Record<string, number>
): boolean {
  const readAt = lastReadAtMap[conversationId]
  // 从未标记过 → 不算未读(避免历史会话一片蓝)
  if (typeof readAt !== 'number') return false
  return lastMessageAt > readAt
}