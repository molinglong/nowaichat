import { test, expect } from "@playwright/test"

// 错误提示可读性回归：上游英文原文不得裸上屏，必须折叠可展开、可复制。
// 不依赖真实上游 Key —— 直接 mock /api/chat 的响应形状。

const envelope = (code: string, status: string, detail: string, raw: string) =>
  `ERR|${code}|${status}|${detail}|${Buffer.from(raw, "utf8").toString("base64")}`

/** 以 SSE UI 消息流形式回一条错误（与线上 toUIMessageStream 的 error part 同形） */
function errorStreamBody(errorText: string) {
  // SSE 事件以空行分隔，单换行会被解析成同一个 data 负载
  return [
    `data: ${JSON.stringify({ type: "start" })}\n\n`,
    `data: ${JSON.stringify({ type: "error", errorText: errorText })}\n\n`,
    "data: [DONE]\n\n",
  ].join("")
}

async function sendOne(page: import("@playwright/test").Page, errorText: string) {
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: errorStreamBody(errorText),
    })
  )
  await page.goto("/chat")
  await page.getByRole("button", { name: "新对话" }).first().click()
  const input = page.locator("textarea").first()
  await expect(input).toBeVisible({ timeout: 30_000 })
  await input.fill("触发一条错误")
  await page.getByRole("button", { name: "发送" }).click()
}

/** dev 环境原文默认展开，生产默认折叠：先把状态收到"折叠"再断言，两种环境都成立 */
async function collapseRaw(page: import("@playwright/test").Page) {
  const collapse = page.getByRole("button", { name: "收起原始错误" })
  if (await collapse.isVisible().catch(() => false)) await collapse.click()
}

test("带 envelope 的上游错误：中文主文案 + 行动按钮，英文原文默认折叠", async ({ page }) => {
  test.setTimeout(180_000)
  const detail = "请求被拒绝：账户余额不足、欠费，或该 Key 没有调用这个模型的权限。充值或换一个模型即可。"
  await sendOne(
    page,
    envelope("insufficient_balance", "403", detail, "You exceeded your current quota, please check your plan")
  )

  const banner = page.getByText(detail).first()
  await expect(banner).toBeVisible({ timeout: 30_000 })
  await collapseRaw(page)
  // 折叠状态下英文原文不得出现在屏上
  await expect(page.getByText(/You exceeded/)).toHaveCount(0)
  await expect(page.getByRole("button", { name: "检查 Key 与额度" })).toBeVisible()

  await page.getByRole("button", { name: "查看原始错误" }).click()
  await expect(page.getByText(/You exceeded/).first()).toBeVisible()
})

test("无 envelope 的历史英文错误：降级分类成中文，原文进折叠区", async ({ page }) => {
  test.setTimeout(180_000)
  await sendOne(page, "AI_APICallError: Incorrect API key provided")

  const banner = page.getByText(/鉴权失败|API Key 已过期/).first()
  await expect(banner).toBeVisible({ timeout: 30_000 })
  await collapseRaw(page)
  await expect(page.getByText("Incorrect API key provided")).toHaveCount(0)

  await page.getByRole("button", { name: "查看原始错误" }).click()
  await expect(page.getByText(/Incorrect API key provided/).first()).toBeVisible()
})

test("AI 诊断入口暂时下线：只剩一把额度耗尽的诊断 Key，点了必然 all_failed", async ({ page }) => {
  test.setTimeout(180_000)
  await sendOne(
    page,
    envelope("unknown", "-", "没能识别这个错误的具体原因。展开「查看原始错误」可以看到服务商的原文。", "Error 503: upstream busy")
  )

  await expect(page.getByText(/没能识别这个错误的具体原因/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("button", { name: "让 AI 分析原因" })).toHaveCount(0)
  // ChatErrorBanner 的 AI_DIAGNOSIS_ENABLED 改回 true 后，本条要改回：
  // mock /api/errors/diagnose → 点按钮 → 断言中文原因与「充值或升级套餐后重试」步骤可见
})

test("链路中断 network error 字面量：归类为连接中断，不再显示「没能识别」", async ({ page }) => {
  test.setTimeout(180_000)
  await sendOne(page, "network error")

  await expect(page.getByText(/长连接在半路断了/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/没能识别这个错误的具体原因/)).toHaveCount(0)
  await collapseRaw(page)
  await page.getByRole("button", { name: "查看原始错误" }).click()
  await expect(page.getByText(/network error/).first()).toBeVisible()
})

test("流中断会主动上传取证包（手机上看不见控制台也能判案）", async ({ page }) => {
  test.setTimeout(180_000)
  const uploaded: string[] = []
  await page.route("**/api/client-diagnostics", async (route) => {
    uploaded.push(route.request().postData() ?? "")
    // 拦掉实发，避免冒烟测试往库里写证据
    await route.fulfill({ status: 202, headers: { "Content-Type": "application/json" }, body: "{}" })
  })
  await sendOne(page, "network error")

  await expect
    .poll(() => uploaded.some((b) => b.includes('"stream"') && b.includes("聊天流中断") && b.includes("visibility=")), { timeout: 30_000 })
    .toBe(true)
})

test("前置校验 400 也走同一套中文提示", async ({ page }) => {
  test.setTimeout(180_000)
  const detail = "这个模型所属的服务商还没有可用的 API Key。到设置里填一次就能用。"
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: envelope("config_missing", "-", detail, "未配置 deepseek 的 API Key"),
      }),
    })
  )
  await page.goto("/chat")
  await page.getByRole("button", { name: "新对话" }).first().click()
  const input = page.locator("textarea").first()
  await expect(input).toBeVisible({ timeout: 30_000 })
  await input.fill("触发一条错误")
  await page.getByRole("button", { name: "发送" }).click()

  await expect(page.getByText(detail).first()).toBeVisible({ timeout: 30_000 })
})
