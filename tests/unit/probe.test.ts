import { test } from "node:test"
import assert from "node:assert/strict"
import {
  PROBE_MAX_QUESTIONS,
  PROBE_SNOOZE_MS,
  describeHits,
  extractGeneralFields,
  looksLikeRealTopic,
  pendingProbeFields,
  probeQueue,
  probeQuotaLeft,
  probeSnoozed,
} from "../../src/lib/profile/probe"
import type { GeneralFieldId } from "../../src/lib/profile/general"

// 对话式采集的抽取层：判错一次档案就会被每轮注入反复引用，
// 所以断言的重点不在"抽得到"，而在"该不抽的时候确实没抽"。

const ids = (result: ReturnType<typeof extractGeneralFields>) => result.hits.map((h) => h.fieldId)
const find = (result: ReturnType<typeof extractGeneralFields>, fieldId: string) =>
  result.hits.find((h) => h.fieldId === fieldId)

test("问题编排按身份分岔：学生问学段选科，上班族问职业，都不问对方那套", () => {
  assert.deepEqual(pendingProbeFields({}), ["identity", "depth", "goal"])

  const student = pendingProbeFields({ identity: "student" })
  assert.deepEqual(student, ["stage", "subjectTrack", "depth", "goal"])
  assert.ok(!student.includes("occupation"), "学生不该被追问职业")

  const worker = pendingProbeFields({ identity: "worker" })
  assert.deepEqual(worker, ["occupation", "depth", "goal"])
  assert.ok(!worker.includes("stage"), "上班族不该被追问学段")

  const teacher = pendingProbeFields({ identity: "teacher" })
  assert.deepEqual(teacher, ["depth", "goal"], "教师无在读学段，只补讲解偏好与目标")

  assert.deepEqual(pendingProbeFields({ identity: "other" }), ["depth", "goal"])
})

test("已落档的维度出队，问题带短标签与档位选项", () => {
  assert.deepEqual(pendingProbeFields({ identity: "student", stage: "高二" }), [
    "subjectTrack",
    "depth",
    "goal",
  ])

  const [first] = probeQueue({}, [], [])
  assert.equal(first.fieldId, "identity")
  assert.equal(first.label, "我的身份")
  assert.equal(first.freeText, false)
  assert.ok(first.options.length >= 4, "身份档位应来自档位表")
  assert.match(first.ask, /读书|上班/)

  const occupation = probeQueue({ identity: "worker" }, [], []).find((q) => q.fieldId === "occupation")
  assert.equal(occupation?.freeText, true, "职业无档位，走整行输入")
  assert.equal(occupation?.max, 16)
})

test("队列按当前档案算适用性：就地改身份后立刻分岔", () => {
  // 学生改成上班族：刚写回的 identity 不能从「适用性计算」里被摘掉，
  // 否则 appliesTo(occupation) 判假，改过口径的人永远问不到职业。
  const workerFields = {
    identity: "worker",
    stage: "高二",
    subjectTrack: "phys-chem-bio",
    depth: "full-steps",
  }
  assert.deepEqual(
    probeQueue(workerFields, ["identity", "stage", "depth"], ["identity"]).map((q) => q.fieldId),
    ["occupation", "goal"]
  )
  // 已答的维不进 reask 就不该被重问
  assert.deepEqual(
    probeQueue(workerFields, [], []).map((q) => q.fieldId),
    ["occupation", "goal"]
  )
})

test("到期复核只过已答的那几条，不顺手追问没答过的", () => {
  const answered = { identity: "student", stage: "高二", depth: "full-steps" }
  const reask: GeneralFieldId[] = ["identity", "stage", "depth"]
  assert.deepEqual(
    probeQueue(answered, [], reask, reask).map((q) => q.fieldId),
    ["identity", "stage", "depth"]
  )
})

test("硬上限 9 问：问满即收口，多问不倒扣", () => {
  assert.equal(probeQuotaLeft(0), PROBE_MAX_QUESTIONS)
  assert.equal(probeQuotaLeft(PROBE_MAX_QUESTIONS - 1), 1)
  assert.equal(probeQuotaLeft(PROBE_MAX_QUESTIONS), 0)
  assert.equal(probeQuotaLeft(PROBE_MAX_QUESTIONS + 5), 0)
})

test("一句话抽多维：身份/学段/选科/深度同时命中", () => {
  const result = extractGeneralFields("我高二物化生，讲题步骤全写", {})
  assert.deepEqual(ids(result).sort(), ["depth", "identity", "stage", "subjectTrack"])
  assert.equal(find(result, "identity")?.value, "student")
  assert.equal(find(result, "stage")?.value, "高二")
  assert.equal(find(result, "subjectTrack")?.value, "phys-chem-bio")
  assert.equal(find(result, "depth")?.value, "full-steps")
  assert.equal(result.refused.length, 0)
})

test("first-wins：已落档的值不被后续自由文本覆盖", () => {
  const result = extractGeneralFields("我高三了", { stage: "高二", identity: "student" })
  assert.ok(!ids(result).includes("stage"), "已确认的学段不能被随口一句改掉")
  assert.deepEqual(
    result.kept.map((h) => `${h.fieldId}:${h.value}`),
    ["identity:student", "stage:高三"]
  )
})

test("他人转述不落档：「我表哥高三」既不记学段也不因此判定身份", () => {
  const result = extractGeneralFields("我表哥高三，帮我看看他的题", {})
  assert.ok(!ids(result).includes("stage"))
  assert.ok(!ids(result).includes("identity"), "亲戚在读高中不等于用户是学生")
  assert.deepEqual(result.refused, ["stage"])

  const teacherSaid = extractGeneralFields("老师说高一第二章不考", {})
  assert.equal(teacherSaid.hits.length, 0, "转述老师的话不进档案")
})

test("职业自述优先于学段证据：「我是教书的，教高二」判教师不判学生", () => {
  const result = extractGeneralFields("我是教书的，教高二数学", {})
  assert.equal(find(result, "identity")?.value, "teacher")
  assert.equal(find(result, "stage")?.value, "高二", "教师教哪个年级对讲解有用，仍记学段")
})

test("选科只在已知路线表内落档，表外组合不猜", () => {
  assert.equal(find(extractGeneralFields("我选物化地", {}), "subjectTrack")?.value, "phys-chem-geo")
  assert.equal(
    find(extractGeneralFields("我选的政史地", {}), "subjectTrack")?.value,
    "hist-pol-geo"
  )
  assert.equal(find(extractGeneralFields("还没分科呢", {}), "subjectTrack")?.value, "not-split")
  assert.equal(find(extractGeneralFields("我物理化学都一般", {}), "subjectTrack"), undefined)
  const odd = extractGeneralFields("我选了物理历史地理", {})
  assert.ok(!ids(odd).includes("subjectTrack"), "三科不在路线表内不能硬凑一档")
  assert.ok(odd.refused.includes("subjectTrack"))
})

test("目标与深度档位命中，抽不到就整条不落档", () => {
  assert.equal(find(extractGeneralFields("期末不拉分就行", {}), "goal")?.value, "no-drag")
  assert.equal(find(extractGeneralFields("想冲一本", {}), "goal")?.value, "first-tier")
  assert.equal(find(extractGeneralFields("纯兴趣，自己想看", {}), "goal")?.value, "interest")
  assert.equal(find(extractGeneralFields("先给思路再展开", {}), "depth")?.value, "ideas-only")
  assert.equal(find(extractGeneralFields("适中就好，跳步注明", {}), "depth")?.value, "medium")
  assert.equal(extractGeneralFields("今天天气不错", {}).hits.length, 0)
})

test("回显只列抽到的维度，用中文档位而非枚举值", () => {
  const result = extractGeneralFields("我高二物化生", {})
  const text = describeHits(result.hits)
  assert.match(text, /身份 学生/)
  assert.match(text, /学段 高二/)
  assert.match(text, /选科路线 物化生/)
  assert.ok(!text.includes("phys-chem-bio"), "枚举值不暴露给用户")
})

test("正题让位判定：一发正题就停问，日常回答不该被误判成正题", () => {
  assert.equal(looksLikeRealTopic("直答：2x+3=7"), true)
  assert.equal(looksLikeRealTopic("帮我解释一下牛顿第二定律"), true)
  assert.equal(looksLikeRealTopic("为什么天空是蓝的"), true)
  assert.equal(looksLikeRealTopic("https://example.com/a"), true)
  assert.equal(looksLikeRealTopic("@记忆 记一下我高二"), true)
  assert.equal(looksLikeRealTopic(""), false)
  assert.equal(looksLikeRealTopic("我高二物化生"), false)
  assert.equal(looksLikeRealTopic("学生"), false)
  assert.equal(looksLikeRealTopic("适中（跳步注明）"), false)
})

test("跳过即 7 天静默，到期自动恢复；时钟回拨不无限静默", () => {
  const now = Date.parse("2026-10-06T08:00:00+08:00")
  assert.equal(probeSnoozed(null, now), false)
  assert.equal(probeSnoozed(0, now), false)
  assert.equal(probeSnoozed(now - PROBE_SNOOZE_MS + 60_000, now), true)
  assert.equal(probeSnoozed(now - PROBE_SNOOZE_MS - 1, now), false)
  assert.equal(probeSnoozed(now + 3_600_000, now), true, "时钟回拨期间不打扰")
})
