import { createHash } from "node:crypto"
import {
  findLatestUserText,
  type AnthropicContentBlock,
  type AnthropicMessage,
  type AnthropicMessagesBody,
} from "./gateway-injection"

/**
 * ACode 网关记忆写提取(路线 D 第二波)——从请求内消息历史取「上一已完成轮」写回记忆库。
 *
 * 可行性(第一波实测):客户端每发请求都从自己的状态重序列化全历史,所以「上一轮」的
 * (用户发言, 助手回复) 已完整躺在当前请求的 messages 里——网关不必解析响应流即可提取。
 * 已知取舍(与用户对齐):会话最后一段回复要等用户下次发言才被补提取(接受一轮延迟)。
 *
 * 触发口径:仅「新一轮纯文本发言」请求(末条 user 含文本块且无 tool_result)才提取。
 * 工具续轮(末条为 tool_result)的助手文本不完整,不提取,避免把半截回复当完成轮。
 * 节流:对 (用户, 用户文本, 助手文本) 指纹做进程内去重(TTL + 容量上限);
 * 重启丢状态最多多提一次,写入管线的去重/矛盾替换兜底(因此无需 DB 迁移)。
 */

function isTextBlock(
  block: AnthropicContentBlock
): block is AnthropicContentBlock & { text: string } {
  return block?.type === "text" && typeof block.text === "string" && block.text.trim() !== ""
}

/** 触发判定:末条消息是新一轮纯文本发言(排除工具续轮与 prefill) */
export function isFreshUserTurn(messages: readonly AnthropicMessage[]): boolean {
  const last = messages[messages.length - 1]
  if (!last || last.role !== "user") return false
  const content = last.content
  if (typeof content === "string") return content.trim() !== ""
  if (!Array.isArray(content)) return false
  if (!content.some(isTextBlock)) return false
  return !content.some((block) => block?.type === "tool_result")
}

/** 最后一条带文本块的 assistant 消息:助手回复原文(多块拼接)——即上一轮的完成回复 */
function findLastAssistantText(
  messages: readonly AnthropicMessage[]
): { index: number; text: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role !== "assistant") continue
    const content = message.content
    if (typeof content === "string") {
      if (content.trim()) return { index: i, text: content.trim() }
      continue
    }
    if (!Array.isArray(content)) continue
    const texts = content.filter(isTextBlock).map((block) => block.text)
    if (texts.length) return { index: i, text: texts.join("\n") }
  }
  return null
}

export interface ExtractionPair {
  userText: string
  assistantText: string
}

/**
 * 取「上一已完成轮」的 (用户发言, 助手回复):
 * 最后一条带文本的 assistant 消息 + 它之前最近一条真实用户发言(findLatestUserText 语义,
 * 自动跳过 tool_result 消息与系统提醒块)。非新一轮发言或历史不完整时返回 null。
 */
export function findExtractionPair(body: AnthropicMessagesBody): ExtractionPair | null {
  const messages = body?.messages
  if (!Array.isArray(messages) || messages.length === 0) return null
  if (!isFreshUserTurn(messages)) return null
  const assistant = findLastAssistantText(messages)
  if (!assistant) return null
  const userText = findLatestUserText(messages.slice(0, assistant.index))
  if (!userText) return null
  return { userText, assistantText: assistant.text }
}

const EXTRACTION_DEDUPE_TTL_MS = 30 * 60 * 1000
const EXTRACTION_DEDUPE_MAX = 1000

/** 指纹 → 预占时间戳(插入序 = 时间序,便于过期清扫) */
const recentExtractionSlots = new Map<string, number>()

/** (用户, 轮次内容) 指纹:同一对内容在窗口期内只提取一次 */
export function extractionFingerprint(userId: string, pair: ExtractionPair): string {
  return createHash("sha1")
    .update(`${userId}\u0000${pair.userText}\u0000${pair.assistantText}`)
    .digest("hex")
}

/**
 * 预占提取槽位(兼在途去重):窗口期内已预占过该指纹返回 false,否则登记并返回 true。
 * 登记发生在任何异步操作之前,并发的同指纹请求只有一个能通过。
 */
export function claimExtractionSlot(fingerprint: string, now: number = Date.now()): boolean {
  const seenAt = recentExtractionSlots.get(fingerprint)
  if (seenAt !== undefined && now - seenAt <= EXTRACTION_DEDUPE_TTL_MS) return false
  recentExtractionSlots.delete(fingerprint) // 过期键移除后重插,保持插入序即时间序
  recentExtractionSlots.set(fingerprint, now)
  const expired: string[] = []
  recentExtractionSlots.forEach((ts, key) => {
    if (now - ts > EXTRACTION_DEDUPE_TTL_MS) expired.push(key)
  })
  for (const key of expired) recentExtractionSlots.delete(key)
  while (recentExtractionSlots.size > EXTRACTION_DEDUPE_MAX) {
    const oldest = recentExtractionSlots.keys().next().value
    if (oldest === undefined) break
    recentExtractionSlots.delete(oldest)
  }
  return true
}

/** 仅供测试:清空进程内节流状态 */
export function resetExtractionSlotsForTest(): void {
  recentExtractionSlots.clear()
}
