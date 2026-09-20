import { test, expect } from "@playwright/test"

// 核心链路冒烟(复用 setup 生成的 admin 会话)
// 流式回复用例依赖 .env 中已配置的可用模型 Key

test("新建对话后可输入", async ({ page }) => {
  await page.goto("/chat")
  await page.getByRole("button", { name: "新对话" }).first().click()
  await expect(page.locator("textarea").first()).toBeVisible()
})

test("发送消息收到流式回复", async ({ page }) => {
  await page.goto("/chat")
  const input = page.locator("textarea").first()
  // dev server 高负载时首屏水合可能超过默认 15s;本用例整体放宽到 3 分钟
  await expect(input).toBeVisible({ timeout: 30_000 })
  test.setTimeout(180_000)
  // 新对话默认 GPT-4o,admin 未配 openai Key,切到已配置 Key 的 DeepSeek 分组
  // 型号名随注册表升级漂移,不硬编码。下拉打开后才异步拉取 Key 名单,未就绪时
  // 只剩 custom 分组(拉取失败被静默吞掉)—— 每轮重开下拉重新拉取,直至分组出现
  const selectorBtn = page.getByRole("button", { name: "GPT-4o" }).first()
  const searchBox = page.getByPlaceholder("搜索模型...")
  const deepseekItem = page.getByRole("button", { name: /^DeepSeek-/ }).first()
  await expect(async () => {
    if (await searchBox.isVisible()) await selectorBtn.click()
    await selectorBtn.click()
    await deepseekItem.click({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  await input.fill("用一句话介绍你自己")
  await page.getByRole("button", { name: "发送", exact: true }).first().click()
  // 用户气泡与 assistant 气泡各有一个「复制」按钮,回复渲染完成即出现第 2 个
  // (不依赖文本长度:模型下拉收起动画会污染页面文本基线)
  await expect(page.getByRole("button", { name: "复制" })).toHaveCount(2, { timeout: 90_000 })
})

test("设置各板块打开不白屏", async ({ page }) => {
  await page.goto("/chat")
  await page.getByRole("button", { name: "设置", exact: true }).first().click()
  const closeBtn = page.getByRole("button", { name: "关闭" }).first()
  await expect(closeBtn).toBeVisible()
  // 覆盖数据加载最重与纯静态的代表性板块;板块崩溃会导致弹窗消失而失败
  for (const section of ["总览", "记忆", "面具管理", "账号信息", "通用"]) {
    await page.getByRole("button", { name: section, exact: true }).first().click()
    await expect(closeBtn).toBeVisible()
  }
  await closeBtn.click()
  await expect(closeBtn).toBeHidden()
})
