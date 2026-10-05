import { test } from "node:test"
import assert from "node:assert/strict"
import {
  REPLY_LENGTH_LEVELS,
  DEFAULT_REPLY_LENGTH,
  LENGTH_LAYER_PREAMBLE,
  getReplyLengthLevel,
  getReplyLengthLabel,
  getReplyLengthPrompt,
} from "../../src/lib/ai/reply-length"
import { isAllowedValue } from "@/lib/settings/registry"

// 回复长度档:档位契约 + 提示词注入规则。
// 这条轴的价值全在 prompt 层(不用 max_tokens 硬截断),所以文案结构与优先级
// 必须有回归兜底——档位 id 一旦漂出注册表白名单,AI 侧改档会被直接拒。

test("四档齐备且顺序为极简→详尽", () => {
  assert.deepEqual(
    REPLY_LENGTH_LEVELS.map((l) => l.id),
    ["minimal", "short", "standard", "detailed"]
  )
  assert.equal(REPLY_LENGTH_LEVELS.length, 4)
})

test("standard 是空操作档:prompt 为空串,不注入任何段落", () => {
  assert.equal(getReplyLengthLevel("standard").prompt, "")
  assert.equal(getReplyLengthPrompt("standard"), "")
  assert.equal(getReplyLengthPrompt(null), "")
})

test("非默认档都带长度层前缀,且前缀声明了优先级裁决", () => {
  for (const level of REPLY_LENGTH_LEVELS) {
    if (level.id === DEFAULT_REPLY_LENGTH) continue
    const prompt = getReplyLengthPrompt(level.id)
    assert.ok(prompt.startsWith(LENGTH_LAYER_PREAMBLE), `${level.id} 缺少长度层前缀`)
    // 裁决顺序必须显式写出,否则会与 concise 风格预设、翻译官这类人格规则互相打架
    assert.match(prompt, /用户本轮对长度的明确要求/)
    assert.match(prompt, /面具人格的输出格式规则/)
    assert.match(prompt, /风格预设里的详略/)
    // 篇幅限制不能顺带砍掉风险提醒:前缀必须把「风险」列为免裁剪例外
    assert.match(prompt, /风险/)
  }
})

test("档位文案落到可观察量级,不裸用抽象词", () => {
  // 极简/简短/详尽三档各含字数或条数的硬指标
  assert.match(getReplyLengthPrompt("minimal"), /30\s*字/)
  assert.match(getReplyLengthPrompt("short"), /150\s*字/)
  assert.match(getReplyLengthPrompt("detailed"), /500\s*字/)
})

test("未知 id 与 null 一律回退默认档,不抛错", () => {
  for (const bad of ["nope", "", "MINIMAL", undefined]) {
    assert.equal(getReplyLengthLevel(bad).id, DEFAULT_REPLY_LENGTH)
    assert.equal(getReplyLengthPrompt(bad), "")
  }
})

test("中文标签可用于快照与 toast", () => {
  assert.equal(getReplyLengthLabel("minimal"), "极简")
  assert.equal(getReplyLengthLabel("detailed"), "详尽")
  assert.equal(getReplyLengthLabel(null), "标准")
})

test("四档全部在 AI 可控注册表白名单内(档位表与白名单同源)", () => {
  for (const level of REPLY_LENGTH_LEVELS) {
    assert.ok(
      isAllowedValue("reply_length", level.id),
      `reply_length 白名单漏了 ${level.id}`
    )
  }
  assert.equal(isAllowedValue("reply_length", "verbose"), false)
  assert.equal(isAllowedValue("unknown_key", "short"), false)
})
