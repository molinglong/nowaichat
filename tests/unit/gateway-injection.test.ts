import { test } from "node:test"
import assert from "node:assert/strict"
import {
  MEMORY_CONTEXT_TAG,
  buildGatewayMemoryBlock,
  findLatestUserText,
  injectMemoryIntoBody,
} from "../../src/lib/memory/gateway-injection"

/**
 * 形状取自 2026-09-30 真实抓包(第零波):
 * - 首轮:user 消息 = [提醒块, 提醒块, 用户原文+cc];
 * - 续轮:末条 user = [tool_result+cc];cache 断点总数恒为 4(system×3 + 末条消息末块)。
 */
const EPHEMERAL = { type: "ephemeral" }

function firstTurnBody() {
  return {
    model: "mock-model",
    system: [
      { type: "text", text: "prefix", cache_control: EPHEMERAL },
      { type: "text", text: "stable", cache_control: EPHEMERAL },
      { type: "text", text: "dynamic", cache_control: EPHEMERAL },
    ],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "<system-reminder>skills</system-reminder>" },
          { type: "text", text: "<system-reminder>currentDate</system-reminder>" },
          { type: "text", text: "帮我看下这个报错", cache_control: EPHEMERAL },
        ],
      },
    ],
  }
}

function followupBody() {
  return {
    model: "mock-model",
    system: [
      { type: "text", text: "prefix", cache_control: EPHEMERAL },
      { type: "text", text: "stable", cache_control: EPHEMERAL },
      { type: "text", text: "dynamic", cache_control: EPHEMERAL },
    ],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "<system-reminder>skills</system-reminder>" },
          { type: "text", text: "帮我看下这个报错" },
        ],
      },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: {} }] },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: "1\tfile text",
            cache_control: EPHEMERAL,
          },
        ],
      },
    ],
  }
}

function countCacheControl(body: { system?: unknown; messages?: unknown }): number {
  let count = 0
  const scan = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) scan(item)
      return
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "cache_control" && value) count++
        else scan(value)
      }
    }
  }
  scan(body.system)
  scan(body.messages)
  return count
}

test("findLatestUserText: 取用户原文(提醒块之后的最后一块)", () => {
  assert.equal(findLatestUserText(firstTurnBody().messages), "帮我看下这个报错")
})

test("findLatestUserText: 续轮跳过 tool_result 消息, 回找当轮原话", () => {
  assert.equal(findLatestUserText(followupBody().messages), "帮我看下这个报错")
})

test("findLatestUserText: 无用户文本时返回空串", () => {
  assert.equal(findLatestUserText([]), "")
  assert.equal(
    findLatestUserText([{ role: "user", content: [{ type: "tool_result", tool_use_id: "t" }] }]),
    ""
  )
})

test("findLatestUserText: 字符串 content 直接返回", () => {
  assert.equal(findLatestUserText([{ role: "user", content: "你好" }]), "你好")
})

test("injectMemoryIntoBody: 首轮追加到尾块, cc 原位不动, 断点数不变", () => {
  const body = firstTurnBody()
  const before = JSON.parse(JSON.stringify(body.messages[0].content))
  assert.equal(injectMemoryIntoBody(body, "<memory-context>MEM</memory-context>"), true)

  const blocks = body.messages[0].content
  assert.equal(blocks.length, 4)
  assert.deepEqual(blocks.slice(0, 3), before)
  assert.equal(blocks[2].cache_control, EPHEMERAL)
  assert.equal(blocks[3].type, "text")
  assert.match(blocks[3].text, /MEM/)
  assert.equal(countCacheControl(body), 4)
})

test("injectMemoryIntoBody: 续轮 tool_result 在前, 记忆块追加在最后且不带 cc", () => {
  const body = followupBody()
  assert.equal(injectMemoryIntoBody(body, "<memory-context>MEM</memory-context>"), true)

  const last = body.messages[2].content
  assert.equal(last.length, 2)
  assert.equal(last[0].type, "tool_result")
  assert.equal(last[0].cache_control, EPHEMERAL)
  assert.equal(last[1].type, "text")
  assert.equal(last[1].cache_control, undefined)
  assert.equal(countCacheControl(body), 4)
})

test("injectMemoryIntoBody: 字符串 content 转两个 text 块", () => {
  const body = { messages: [{ role: "user", content: "你好" }] }
  assert.equal(injectMemoryIntoBody(body, "MEM"), true)
  assert.deepEqual(body.messages[0].content, [
    { type: "text", text: "你好" },
    { type: "text", text: "MEM" },
  ])
})

test("injectMemoryIntoBody: 末条非 user / 空 messages 时不改", () => {
  const prefill = { messages: [{ role: "assistant", content: [{ type: "text", text: "x" }] }] }
  assert.equal(injectMemoryIntoBody(prefill, "MEM"), false)
  assert.equal(prefill.messages[0].content.length, 1)

  assert.equal(injectMemoryIntoBody({}, "MEM"), false)
  assert.equal(injectMemoryIntoBody({ messages: [] }, "MEM"), false)
})

test("buildGatewayMemoryBlock: 无记忆返回 null; 有记忆带标签与内容", () => {
  assert.equal(buildGatewayMemoryBlock([]), null)
  const block = buildGatewayMemoryBlock([
    { category: "preference", content: "喜欢深色主题" },
    { category: "user_info", content: "在校学生" },
  ])
  assert.ok(block)
  assert.match(block, new RegExp(`<${MEMORY_CONTEXT_TAG}>`))
  assert.match(block, new RegExp(`</${MEMORY_CONTEXT_TAG}>`))
  assert.match(block, /喜欢深色主题/)
  assert.match(block, /在校学生/)
})
