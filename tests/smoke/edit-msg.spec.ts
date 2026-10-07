import fs from "node:fs"
import { test, expect, type Page } from "@playwright/test"

/**
 * 「编辑已发送消息」冒烟(复用 setup 生成的 admin 会话):
 *  1) 失焦不提交:点消息区其他位置后仍停留编辑态,不归档、不重答
 *  2) ✕ 取消:复原气泡,不归档、不重答
 *  3) 「保存并重答」(编辑卡唯一动作):提交后旧链归档、新消息重发,可回看历史版本(卡内无警示行)
 *  4) 带附件消息重发保留附件(此前会静默丢图)
 * 依赖 .env 已配置的 DeepSeek Key;用例自建会话,结束即删(正文含 MARK,中断也能兜底清理)。
 */

const REPLY_TIMEOUT = 90_000
/** 会话标题/正文唯一标记:运行中断时据此兜底清理残留会话 */
const MARK = "编辑冒烟"

async function gotoFreshChat(page: Page) {
  await page.goto("/chat")
  await page.getByRole("button", { name: "新对话" }).first().click()
  const input = page.locator("textarea").first()
  await expect(input).toBeVisible({ timeout: 30_000 })
  return input
}

/**
 * 新对话默认模型(admin 未配其 Key),切到已配置 Key 的 DeepSeek 分组。
 * 默认模型名随注册表升级漂移(曾写死 GPT-4o,实际已变 GPT-5.5),故触发器改用结构定位:
 * 发送按钮的前一个兄弟容器即 ModelSelector(ChatInput 工具行),不再依赖模型名。
 */
async function switchToDeepSeek(page: Page) {
  const selectorBtn = page
    .locator('xpath=//button[@aria-label="发送"]/preceding-sibling::*[1]//button')
    .first()
  const searchBox = page.getByPlaceholder("搜索模型...")
  // 模型行可访问名以厂商色块首字母开头(D DeepSeek-V3 · …),不再 /^DeepSeek-/ 锚定;
  // 改走搜索 + ↵ 选中高亮行(过滤后高亮自动收回首行)
  await expect(async () => {
    if (await searchBox.isVisible().catch(() => false)) await page.keyboard.press("Escape")
    await selectorBtn.click()
    await searchBox.fill("DeepSeek")
    await page.keyboard.press("Enter")
    await expect(selectorBtn).toContainText("DeepSeek", { timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  // 触发器文本已变为所选模型名,确认切换真正生效
  await expect(selectorBtn).toContainText("DeepSeek")
}

/** 「复制」必须精确匹配:"选择复制格式"也含「复制」二字,欠精确会提前命中而失去等待语义 */
function copyButtons(page: Page) {
  return page.getByRole("button", { name: "复制", exact: true })
}

/** 等回复真正结束:两个复制按钮(用户 + assistant) + 输入框恢复可用(= 流式结束且已落库) */
async function waitReplyDone(page: Page) {
  await expect(copyButtons(page)).toHaveCount(2, { timeout: REPLY_TIMEOUT })
  await expect(page.locator("textarea").first()).toBeEnabled({ timeout: REPLY_TIMEOUT })
}

async function sendAndWaitReply(page: Page, text: string) {
  await page.locator("textarea").first().fill(text)
  await page.getByRole("button", { name: "发送", exact: true }).first().click()
  await waitReplyDone(page)
}

/** URL 改写由响应头 X-Conversation-Id 触发,略晚于发送,故先等 URL 再取 id */
async function convIdFromUrl(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/chat\/c\//, { timeout: 15_000 })
  const matched = page.url().match(/\/chat\/c\/([^/?#]+)/)
  if (!matched) throw new Error(`url 中没有会话 id: ${page.url()}`)
  return matched[1]
}

/** 兜底清理:中断残留的用例会话(标题或正文含 MARK),幂等 */
async function cleanupLeaks(page: Page) {
  const res = await page.request.get(`/api/conversations?q=${encodeURIComponent(MARK)}&limit=100`)
  if (!res.ok()) return
  const data = (await res.json()) as { items?: Array<{ id: string }> }
  for (const c of data.items ?? []) {
    await page.request.delete(`/api/conversations/${c.id}`)
  }
}

async function fetchMessages(page: Page, convId: string) {
  const res = await page.request.get(`/api/conversations/${convId}/messages`)
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as { messages: Array<Record<string, unknown>> }
}

function parseMeta(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

test("失焦不提交 / ✕ 取消 / 保存并重答(归档+回看)", async ({ page }) => {
  test.setTimeout(300_000)
  await cleanupLeaks(page)
  await gotoFreshChat(page)
  await switchToDeepSeek(page)
  const v1 = "编辑冒烟:第一版,请只回复 ok"
  await sendAndWaitReply(page, v1)
  const convId = await convIdFromUrl(page)

  // 主钮可访问名含钮面上的 ⏎ 快捷键提示,统一用正则匹配
  const resendBtn = () => page.getByRole("button", { name: /保存并重答/ })

  try {
    // 进入编辑态:编辑卡出现,无警示行(定案已删,归档影响面只在主钮 title 中说明)
    await page.getByRole("button", { name: "编辑", exact: true }).first().click()
    const editBox = page.getByRole("textbox", { name: "编辑消息内容" })
    await expect(editBox).toBeVisible()
    await expect(editBox).toHaveValue(v1)
    await expect(resendBtn()).toBeVisible()
    await expect(page.getByText("提交后将归档")).toHaveCount(0)

    // ① 失焦(点输入框):仍停留编辑态。编辑态下用户气泡被编辑卡整体替换,
    //    [data-message-id] 只剩 assistant 一条 —— 数量不变即未提交、未重答
    await page.getByPlaceholder("输入消息...").click()
    await expect(editBox).toBeVisible()
    await expect(resendBtn()).toBeVisible()
    await expect(page.locator("[data-message-id]")).toHaveCount(1)

    // ② ✕ 取消:编辑卡收起,气泡原文复原,不归档不重答
    const v2 = "编辑冒烟:第二版,请只回复 ok"
    await editBox.fill(v2)
    await page.getByRole("button", { name: "取消编辑" }).click()
    await expect(editBox).toBeHidden()
    await expect(page.locator("[data-message-id]").first()).toContainText(v1)
    const afterCancel = await fetchMessages(page, convId)
    expect(afterCancel.messages.find((m) => m.role === "user")?.content).toBe(v1) // 取消未落库

    // ③ 保存并重答:归档旧链 → 重发 → 新回复;历史版本可回看
    await page.getByRole("button", { name: "编辑", exact: true }).first().click()
    const v3 = "编辑冒烟:第三版,请只回复 ok"
    await page.getByRole("textbox", { name: "编辑消息内容" }).fill(v3)
    await expect(page.getByText("提交后将归档")).toHaveCount(0)
    await resendBtn().click()
    await waitReplyDone(page)

    const afterResend = await fetchMessages(page, convId)
    expect(afterResend.messages).toHaveLength(2) // 只剩新分支:新 user + 新 assistant
    const resentUser = afterResend.messages.find((m) => m.role === "user")
    expect(resentUser?.content).toBe(v3)
    const editedFrom = parseMeta(resentUser?.metadata).editedFrom
    expect(typeof editedFrom).toBe("string")

    const archivedRes = await page.request.get(
      `/api/conversations/${convId}/archived?rootId=${editedFrom as string}`
    )
    expect(archivedRes.ok()).toBeTruthy()
    const archived = (await archivedRes.json()) as { messages: Array<{ content: string }> }
    expect(archived.messages.map((m) => m.content)).toContain(v1)

    // UI 回看入口:展开历史版本能看到旧文本。v1 同时是会话标题(header 也有同名文本),
    // 断言收窄到消息区,避免 strict mode 歧义
    await page.getByRole("button", { name: /查看历史版本/ }).click()
    await expect(page.getByRole("main").getByText(v1)).toBeVisible()
  } finally {
    await page.request.delete(`/api/conversations/${convId}`)
  }
})

test("带附件消息重发保留附件", async ({ page }) => {
  test.setTimeout(300_000)
  await cleanupLeaks(page)
  await gotoFreshChat(page)
  await switchToDeepSeek(page)

  // 夹具取仓库内真实 PNG:DeepSeek 会拒收 1x1 占位图(HTTP 400 "unsupported image"),
  // 真图才走得通视觉链路 —— 本用例主题正是"带图编辑重答不静默丢图"
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "edit-smoke.png",
    mimeType: "image/png",
    buffer: fs.readFileSync("public/brand/mark.png"),
  })
  // setInputFiles 只触发上传,附件要等 POST /api/upload 返回才进 attachments 态;
  // 上传中列表已渲染同名文件(u.name),故以只在落定后才有的「移除」按钮为判据。
  // 不等就发送会静默丢附件(测的是竞态,不是产品缺陷)
  await expect(page.getByRole("button", { name: "移除" })).toBeVisible({ timeout: 30_000 })

  const v1 = "编辑冒烟:带附件,请只回复 ok"
  await sendAndWaitReply(page, v1)
  const convId = await convIdFromUrl(page)

  try {
    const attLinks = page.locator('[data-message-id] a[href*="/uploads/"]')
    await expect(attLinks).toHaveCount(1)

    await page.getByRole("button", { name: "编辑", exact: true }).first().click()
    const v2 = "编辑冒烟:带附件改说法,请只回复 ok"
    await page.getByRole("textbox", { name: "编辑消息内容" }).fill(v2)
    await page.getByRole("button", { name: /保存并重答/ }).click()
    await waitReplyDone(page)
    await expect(page.locator("[data-message-id]").first()).toContainText(v2)

    // 重发后的新气泡仍带附件(修复前:编辑即静默丢图)
    await expect(attLinks).toHaveCount(1)

    const afterResend = await fetchMessages(page, convId)
    const resentUser = afterResend.messages.find((m) => m.role === "user")
    expect(resentUser?.content).toBe(v2)
    const rawAtts = resentUser?.attachments
    const atts =
      typeof rawAtts === "string" ? (JSON.parse(rawAtts) as unknown[]) : (rawAtts as unknown[])
    expect(Array.isArray(atts)).toBeTruthy()
    expect(atts).toHaveLength(1)
  } finally {
    await page.request.delete(`/api/conversations/${convId}`)
  }
})
