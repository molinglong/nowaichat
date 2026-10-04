import { test, expect, type Page } from "@playwright/test"

/**
 * 「编辑已发送消息」冒烟(复用 setup 生成的 admin 会话):
 *  1) 失焦不提交:点消息区其他位置后仍停留编辑态,不归档、不重答
 *  2) 「仅保存」就地改文本:等长替换也即时刷新,不动后续消息、不触发重答,服务端落库
 *  3) 「保存并重答」:确认条提示归档条数,提交后旧链归档、新消息重发,可回看历史版本
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
  const deepseekItem = page.getByRole("button", { name: /^DeepSeek-/ }).first()
  await expect(async () => {
    if (await searchBox.isVisible()) await selectorBtn.click()
    await selectorBtn.click()
    await deepseekItem.click({ timeout: 5_000 })
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

test("失焦不提交 / 仅保存 / 保存并重答(归档+回看)", async ({ page }) => {
  test.setTimeout(300_000)
  await cleanupLeaks(page)
  await gotoFreshChat(page)
  await switchToDeepSeek(page)
  const v1 = "编辑冒烟:第一版,请只回复 ok"
  await sendAndWaitReply(page, v1)
  const convId = await convIdFromUrl(page)

  try {
    // 进入编辑态
    await page.getByRole("button", { name: "编辑", exact: true }).first().click()
    const editBox = page.getByRole("textbox", { name: "编辑消息内容" })
    await expect(editBox).toBeVisible()
    await expect(editBox).toHaveValue(v1)
    await expect(page.getByRole("button", { name: "仅保存" })).toBeVisible()
    await expect(page.getByRole("button", { name: "保存并重答" })).toBeVisible()
    await expect(page.getByText("保存并重答将归档后续 1 条")).toBeVisible()

    // ① 失焦(点输入框):仍停留编辑态。编辑态下用户气泡被编辑框整体替换,
    //    [data-message-id] 只剩 assistant 一条 —— 数量不变即未提交、未重答
    await page.getByPlaceholder("输入消息...").click()
    await expect(editBox).toBeVisible()
    await expect(page.getByRole("button", { name: "保存并重答" })).toBeVisible()
    await expect(page.locator("[data-message-id]")).toHaveCount(1)

    // ② 仅保存:等长替换(一→二)必须就地刷新 —— 气泡比较器只看长度指纹,
    //    等长文本若无 metadata 引用变化会静默不重渲
    const v2 = "编辑冒烟:第二版,请只回复 ok"
    expect(v2.length).toBe(v1.length)
    await editBox.fill(v2)
    await page.getByRole("button", { name: "仅保存" }).click()
    await expect(page.getByText("已编辑", { exact: true })).toBeVisible()
    await expect(editBox).toBeHidden()
    await expect(copyButtons(page)).toHaveCount(2) // 未重答
    await expect(page.locator("[data-message-id]").first()).toContainText(v2)

    const afterSave = await fetchMessages(page, convId)
    const savedUser = afterSave.messages.find((m) => m.role === "user")
    expect(savedUser?.content).toBe(v2) // 临时 id 经 内容+时间窗 回退定位后已落库
    expect(parseMeta(savedUser?.metadata).editedAt).toBeTruthy()

    // ③ 保存并重答:归档旧链 → 重发 → 新回复;历史版本可回看
    await page.getByRole("button", { name: "编辑", exact: true }).first().click()
    const v3 = "编辑冒烟:第三版,请只回复 ok"
    await page.getByRole("textbox", { name: "编辑消息内容" }).fill(v3)
    await expect(page.getByText("保存并重答将归档后续 1 条")).toBeVisible()
    await page.getByRole("button", { name: "保存并重答" }).click()
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
    expect(archived.messages.map((m) => m.content)).toContain(v2)

    // UI 回看入口:展开历史版本能看到旧文本
    await page.getByRole("button", { name: /查看历史版本/ }).click()
    await expect(page.getByText(v2)).toBeVisible()
  } finally {
    await page.request.delete(`/api/conversations/${convId}`)
  }
})

test("带附件消息重发保留附件", async ({ page }) => {
  test.setTimeout(300_000)
  await cleanupLeaks(page)
  await gotoFreshChat(page)
  await switchToDeepSeek(page)

  // 1x1 PNG(内联,避免依赖磁盘文件)
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64"
  )
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "edit-smoke.png",
    mimeType: "image/png",
    buffer: png,
  })

  const v1 = "编辑冒烟:带图,请只回复 ok"
  await sendAndWaitReply(page, v1)
  const convId = await convIdFromUrl(page)

  try {
    const attLinks = page.locator('[data-message-id] a[href*="/uploads/"]')
    await expect(attLinks).toHaveCount(1)

    await page.getByRole("button", { name: "编辑", exact: true }).first().click()
    const v2 = "编辑冒烟:带图改说法,请只回复 ok"
    await page.getByRole("textbox", { name: "编辑消息内容" }).fill(v2)
    await page.getByRole("button", { name: "保存并重答" }).click()
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
