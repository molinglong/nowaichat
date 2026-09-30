import { test } from "node:test"
import assert from "node:assert/strict"
import {
  claimExtractionSlot,
  extractionFingerprint,
  findExtractionPair,
  isFreshUserTurn,
  resetExtractionSlotsForTest,
} from "../../src/lib/memory/gateway-extraction"

/**
 * 形状取自 2026-09-30 真实抓包(第零波/第一波):
 * - 新轮请求 = [...历史, 用户新发言(提醒块+原文)];
 * - 工具续轮 = [...历史, tool_use, tool_result 末条];
 * - 助手回复的最终文本在"下一轮新发言"请求里完整可见。
 */

const text = (t: string) => ({ type: "text", text: t })
const toolUse = (id: string) => ({ type: "tool_use", id, name: "Read", input: {} })
const toolResult = (id: string) => ({ type: "tool_result", tool_use_id: id, content: "ok" })

const TTLS = 30 * 60 * 1000

// ---------- isFreshUserTurn ----------

test("isFreshUserTurn: 提醒块+原文的新发言 => true", () => {
  assert.equal(
    isFreshUserTurn([
      { role: "user", content: [text("<system-reminder>skills</system-reminder>"), text("帮我看下这个报错")] },
    ]),
    true
  )
})

test("isFreshUserTurn: 工具续轮(末条 tool_result) => false", () => {
  assert.equal(
    isFreshUserTurn([
      { role: "assistant", content: [toolUse("t1")] },
      { role: "user", content: [toolResult("t1")] },
    ]),
    false
  )
})

test("isFreshUserTurn: tool_result 与提醒文本同条 => false", () => {
  assert.equal(
    isFreshUserTurn([{ role: "user", content: [toolResult("t1"), text("<system-reminder>x</system-reminder>")] }]),
    false
  )
})

test("isFreshUserTurn: 末条非 user / 空 messages / 空文本 => false", () => {
  assert.equal(isFreshUserTurn([{ role: "assistant", content: [text("x")] }]), false)
  assert.equal(isFreshUserTurn([]), false)
  assert.equal(isFreshUserTurn([{ role: "user", content: [text("   ")] }]), false)
  assert.equal(isFreshUserTurn([{ role: "user", content: "   " }]), false)
})

test("isFreshUserTurn: 字符串 content 非空 => true", () => {
  assert.equal(isFreshUserTurn([{ role: "user", content: "你好" }]), true)
})

// ---------- findExtractionPair ----------

test("findExtractionPair: 仅首条发言(无回复) => null", () => {
  assert.equal(findExtractionPair({ messages: [{ role: "user", content: [text("第一句")] }] }), null)
})

test("findExtractionPair: 新发言轮 => 取上一完成轮(用户原文, 助手回复)", () => {
  const pair = findExtractionPair({
    messages: [
      { role: "user", content: [text("<system-reminder>skills</system-reminder>"), text("帮我看看循环依赖")] },
      { role: "assistant", content: [text("根因是 A 与 B 互相引用")] },
      { role: "user", content: [text("那怎么拆")] },
    ],
  })
  assert.deepEqual(pair, { userText: "帮我看看循环依赖", assistantText: "根因是 A 与 B 互相引用" })
})

test("findExtractionPair: 工具链轮 => 取最终回复, 跳过 tool_use/tool_result", () => {
  const pair = findExtractionPair({
    messages: [
      { role: "user", content: [text("跑一下测试")] },
      { role: "assistant", content: [toolUse("t1")] },
      { role: "user", content: [toolResult("t1")] },
      { role: "assistant", content: [text("17/17 全过")] },
      { role: "user", content: [text("好，提交吧")] },
    ],
  })
  assert.deepEqual(pair, { userText: "跑一下测试", assistantText: "17/17 全过" })
})

test("findExtractionPair: 工具续轮中途(末条 tool_result) => null 不提取半截轮", () => {
  const pair = findExtractionPair({
    messages: [
      { role: "user", content: [text("查一下端口")] },
      { role: "assistant", content: [text("我看下"), toolUse("t1")] },
      { role: "user", content: [toolResult("t1")] },
    ],
  })
  assert.equal(pair, null)
})

test("findExtractionPair: 末条回复无文本块(仅 thinking) => 回退到上一条带文本回复", () => {
  const pair = findExtractionPair({
    messages: [
      { role: "user", content: [text("第一轮问题")] },
      { role: "assistant", content: [text("第一轮回复")] },
      { role: "assistant", content: [{ type: "thinking", thinking: "..." }] },
      { role: "user", content: [text("第二轮问题")] },
    ],
  })
  assert.deepEqual(pair, { userText: "第一轮问题", assistantText: "第一轮回复" })
})

test("findExtractionPair: 用户原文取提醒块之后的最后一块;助手多文本块拼接", () => {
  const pair = findExtractionPair({
    messages: [
      { role: "user", content: [text("<system-reminder>currentDate</system-reminder>"), text("正文一"), text("正文二")] },
      { role: "assistant", content: [text("第一段"), text("第二段")] },
      { role: "user", content: [text("新发言")] },
    ],
  })
  assert.deepEqual(pair, { userText: "正文二", assistantText: "第一段\n第二段" })
})

test("findExtractionPair: 字符串 content 形态也可配对", () => {
  const pair = findExtractionPair({
    messages: [
      { role: "user", content: "你好呀" },
      { role: "assistant", content: "你好，有什么可以帮你" },
      { role: "user", content: "继续" },
    ],
  })
  assert.deepEqual(pair, { userText: "你好呀", assistantText: "你好，有什么可以帮你" })
})

// ---------- 指纹与节流 ----------

test("extractionFingerprint: 相同输入稳定, 用户/任一侧文本变化即变化", () => {
  const pair = { userText: "u", assistantText: "a" }
  assert.equal(extractionFingerprint("user1", pair), extractionFingerprint("user1", { ...pair }))
  assert.notEqual(extractionFingerprint("user1", pair), extractionFingerprint("user2", pair))
  assert.notEqual(extractionFingerprint("user1", pair), extractionFingerprint("user1", { userText: "u2", assistantText: "a" }))
  assert.notEqual(extractionFingerprint("user1", pair), extractionFingerprint("user1", { userText: "u", assistantText: "a2" }))
})

test("claimExtractionSlot: 同指纹窗口期内只通过一次, 不同指纹互不影响", () => {
  resetExtractionSlotsForTest()
  const t0 = 1_000_000
  assert.equal(claimExtractionSlot("fp-a", t0), true)
  assert.equal(claimExtractionSlot("fp-a", t0 + 1000), false)
  assert.equal(claimExtractionSlot("fp-b", t0 + 1000), true)
})

test("claimExtractionSlot: 超过 TTL 后可重新预占(含边界)", () => {
  resetExtractionSlotsForTest()
  const t0 = 2_000_000
  assert.equal(claimExtractionSlot("fp-t", t0), true)
  assert.equal(claimExtractionSlot("fp-t", t0 + TTLS), false) // 恰好到 TTL, 仍在窗口内
  assert.equal(claimExtractionSlot("fp-t", t0 + TTLS + 1), true) // 过期, 可重新预占
})

test("claimExtractionSlot: 容量上限逐出最旧, 不误伤新键", () => {
  resetExtractionSlotsForTest()
  const t0 = 3_000_000
  for (let i = 0; i < 1100; i++) {
    assert.equal(claimExtractionSlot(`fp-${i}`, t0 + i), true)
  }
  // 最旧的已被逐出:可重新预占;最新的仍在窗口内
  assert.equal(claimExtractionSlot("fp-0", t0 + 1100), true)
  assert.equal(claimExtractionSlot("fp-1099", t0 + 1100), false)
  resetExtractionSlotsForTest()
})
