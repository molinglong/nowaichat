import { test } from "node:test"
import assert from "node:assert/strict"
import {
  RECONFIRM_AFTER_DAYS,
  schoolYearStartYear,
  shanghaiParts,
  nextStage,
  deriveStage,
  profileRefreshDue,
} from "../../src/lib/profile/academic"

// 学年推算：这套函数的价值全在「边界判得准 + 不乱推」，
// 一旦把开学日判错一年，整份档案的学段就错一年且会一路顺推下去。
// 五个必测点位：8/31、9/1、9/2、闰年、UTC 容器。

// 模拟 VPS 容器：进程时区 UTC 时，函数仍必须按上海时区判边界。
process.env.TZ = "UTC"

const sh = (iso: string) => new Date(iso)

test("8/31 仍属上一学年，学段不动", () => {
  const before = sh("2026-08-31T04:00:00Z") // 上海 8/31 12:00
  assert.equal(schoolYearStartYear(before), 2025)
  const d = deriveStage("高二", sh("2025-09-15T04:00:00Z"), before)
  assert.equal(d.kind, "keep")
  assert.equal(d.stage, "高二")
  assert.equal(d.steps, 0)
})

test("9/1 当天即换学年：高二顺推成高三", () => {
  const on1 = sh("2026-09-01T04:00:00Z") // 上海 9/1 12:00
  assert.equal(schoolYearStartYear(on1), 2026)
  const d = deriveStage("高二", sh("2025-09-15T04:00:00Z"), on1)
  assert.equal(d.kind, "advance")
  assert.equal(d.stage, "高三")
  assert.equal(d.steps, 1)
  assert.match(d.note, /^系统推算/)
})

test("9/2 与 9/1 同档：不出现第二次推进", () => {
  const on2 = sh("2026-09-02T04:00:00Z")
  assert.equal(schoolYearStartYear(on2), 2026)
  const d = deriveStage("高二", sh("2025-09-15T04:00:00Z"), on2)
  assert.equal(d.stage, "高三")
  assert.equal(d.steps, 1)
})

test("升学不是简单 +1：初三→高一，高三不推成大一", () => {
  assert.deepEqual(nextStage("初三"), { kind: "advance", stage: "高一" })
  assert.deepEqual(nextStage("高二"), { kind: "advance", stage: "高三" })
  assert.deepEqual(nextStage("高三"), { kind: "graduate", from: "高三" })
  assert.deepEqual(nextStage("大四"), { kind: "graduate", from: "大四" })
  assert.equal(nextStage("补习班").kind, "unknown")

  const d = deriveStage("高三", sh("2025-09-10T04:00:00Z"), sh("2026-09-05T04:00:00Z"))
  assert.equal(d.kind, "graduate")
  assert.equal(d.stage, null)
  assert.doesNotMatch(d.note, /大一/)

  // 停档后继续跨年也不越过毕业态
  const later = deriveStage("高三", sh("2025-09-10T04:00:00Z"), sh("2027-09-05T04:00:00Z"))
  assert.equal(later.kind, "graduate")
})

test("UTC 容器里 9/1 凌晨（上海）不能判成 8/31", () => {
  // 裸用 getMonth() 在 UTC 进程会得到 8 月，从而整份档案晚一年
  const naive = new Date("2026-08-31T17:30:00Z")
  assert.equal(naive.getUTCMonth(), 7)
  assert.equal(naive.getUTCDate(), 31)
  assert.equal(schoolYearStartYear(naive), 2026) // 上海 9/1 01:30，已开学

  const stillAugust = new Date("2026-08-31T15:30:00Z") // 上海 8/31 23:30
  assert.equal(schoolYearStartYear(stillAugust), 2025)

  assert.deepEqual(shanghaiParts(new Date("2026-09-01T00:30:00Z")), { year: 2026, month: 9, day: 1 })
})

test("闰日：2/29 能读出来，180 天到期跨闰年不偏移", () => {
  assert.deepEqual(shanghaiParts(sh("2028-02-29T04:00:00Z")), { year: 2028, month: 2, day: 29 })
  const confirmedAt = sh("2028-02-29T04:00:00Z")
  const day179 = new Date(confirmedAt.getTime() + (RECONFIRM_AFTER_DAYS - 1) * 86_400_000)
  const day180 = new Date(confirmedAt.getTime() + RECONFIRM_AFTER_DAYS * 86_400_000)
  assert.equal(day180.toISOString().slice(0, 10), "2028-08-27")
  assert.deepEqual(profileRefreshDue("worker", confirmedAt, day179), { due: false, reason: null })
  assert.deepEqual(profileRefreshDue("worker", confirmedAt, day180), { due: true, reason: "interval" })
})

test("到期判定按身份相位分档，不做统一半年", () => {
  const afterNewYear = sh("2026-09-03T04:00:00Z")
  const confirmedLastYear = sh("2026-03-01T04:00:00Z")

  assert.deepEqual(profileRefreshDue("student", confirmedLastYear, afterNewYear), {
    due: true,
    reason: "school-year",
  })
  assert.deepEqual(profileRefreshDue("teacher", confirmedLastYear, afterNewYear), {
    due: true,
    reason: "school-year",
  })
  // 学年内不重复打扰
  assert.deepEqual(
    profileRefreshDue("student", sh("2026-09-05T04:00:00Z"), sh("2027-06-01T04:00:00Z")),
    { due: false, reason: null }
  )
  // 上班族才 155 天：即使跨了 9/1 学年边界也不提醒（学生提醒不等于全员提醒）
  assert.deepEqual(profileRefreshDue("worker", sh("2026-04-01T04:00:00Z"), afterNewYear), {
    due: false,
    reason: null,
  })
  // 同一时点学生已到期，上班族要满 180 天才到期
  assert.deepEqual(profileRefreshDue("worker", confirmedLastYear, afterNewYear), {
    due: true,
    reason: "interval",
  })
  assert.deepEqual(profileRefreshDue("freelance", null, afterNewYear), { due: true, reason: "first" })
  assert.deepEqual(profileRefreshDue("other", confirmedLastYear, afterNewYear), {
    due: false,
    reason: null,
  })
  assert.deepEqual(profileRefreshDue(null, confirmedLastYear, afterNewYear), {
    due: false,
    reason: null,
  })
})

test("推算只给建议，绝不静默改写：缺学段一律降级为需确认", () => {
  const now = sh("2026-09-03T04:00:00Z")
  assert.equal(deriveStage(null, sh("2025-09-10T04:00:00Z"), now).kind, "confirm")
  assert.equal(deriveStage("高二", null, now).kind, "confirm")
  assert.equal(deriveStage("研究生", sh("2025-09-10T04:00:00Z"), now).kind, "confirm")
  // 「研究生」不在自动阶梯里，原样回显不臆造档位
  const d = deriveStage("研究生", sh("2025-09-10T04:00:00Z"), now)
  assert.equal(d.stage, "研究生")
  assert.equal(d.steps, 0)
  assert.match(d.note, /^系统推算/)
})
