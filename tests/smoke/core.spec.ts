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
  // 新对话默认模型(admin 未配其 Key),切到已配置 Key 的 DeepSeek 分组
  // 型号名随注册表升级漂移,不硬编码:发送按钮的前一个兄弟容器即 ModelSelector
  // (ChatInput 工具行)。下拉打开后才异步拉取 Key 名单,未就绪时
  // 只剩 custom 分组(拉取失败被静默吞掉)—— 每轮重开下拉重新拉取,直至分组出现
  const selectorBtn = page
    .locator('xpath=//button[@aria-label="发送"]/preceding-sibling::*[1]//button')
    .first()
  const searchBox = page.getByPlaceholder("搜索模型...")
  // 模型行可访问名以厂商色块首字母开头(D DeepSeek-V3 · …),不再 /^DeepSeek-/ 锚定;
  // 改走搜索 + ↵ 选中高亮行(过滤后高亮自动收回首行),顺带覆盖键盘选择路径
  await expect(async () => {
    if (await searchBox.isVisible().catch(() => false)) await page.keyboard.press("Escape")
    await selectorBtn.click()
    await searchBox.fill("DeepSeek")
    await page.keyboard.press("Enter")
    await expect(selectorBtn).toContainText("DeepSeek", { timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  await input.fill("用一句话介绍你自己")
  await page.getByRole("button", { name: "发送", exact: true }).first().click()
  // 用户气泡与 assistant 气泡各有一个「复制」按钮,回复渲染完成即出现第 2 个
  // (不依赖文本长度:模型下拉收起动画会污染页面文本基线)
  await expect(page.getByRole("button", { name: "复制" })).toHaveCount(2, { timeout: 90_000 })
})

test("流式回复逐帧增长(防一次性上屏回归)", async ({ page }) => {
  // 回归护栏: 网络在流、DOM 不动的形态(AI SDK pushMessage 不快照 → memo 按文本长度
  // 判等恒 bail out)只靠"第二条气泡出现"是测不出来的, 必须数正文长度的递增步数。
  await page.goto("/chat")
  const input = page.locator("textarea").first()
  await expect(input).toBeVisible({ timeout: 30_000 })
  test.setTimeout(180_000)
  const selectorBtn = page
    .locator('xpath=//button[@aria-label="发送"]/preceding-sibling::*[1]//button')
    .first()
  const searchBox = page.getByPlaceholder("搜索模型...")
  await expect(async () => {
    if (await searchBox.isVisible().catch(() => false)) await page.keyboard.press("Escape")
    await selectorBtn.click()
    await searchBox.fill("DeepSeek")
    await page.keyboard.press("Enter")
    await expect(selectorBtn).toContainText("DeepSeek", { timeout: 5_000 })
  }).toPass({ timeout: 60_000 })

  await page.getByRole("button", { name: "新对话" }).first().click()
  await input.fill("直接在本页回答，不要生成文档或卡片：介绍 B+ 树为什么适合做数据库索引，分点写，约 800 字")
  await page.getByRole("button", { name: "发送", exact: true }).first().click()

  // 100ms 轮询「全列表最长气泡」字符数, 记录去重后的长度序列。
  // 取最大值而非末条: 发送瞬间末条还是 user 气泡, assistant 进列表后才轮到它,
  // 用末条会把 40→29 这种"换气泡"的回落算进序列。
  // 阈值 500 字: 打字机在 300~1500 字符/秒区间, 500 字内足够攒出递增步数
  const lens: number[] = []
  for (let i = 0; i < 700; i++) {
    const n = await page.evaluate(() => {
      let max = 0
      document.querySelectorAll("[data-message-id]").forEach((el) => {
        const c = (el.textContent || "").replace(/\s/g, "").length
        if (c > max) max = c
      })
      return max
    })
    if (!lens.length || n !== lens[lens.length - 1]) lens.push(n)
    if (n >= 500) break
    await page.waitForTimeout(100)
  }
  const increases = lens.filter((v, i) => i > 0 && v > lens[i - 1]).length
  expect(increases, `增长步数过少, 正文疑似一次性上屏: ${lens.join(" ")}`).toBeGreaterThanOrEqual(5)
})

test("设置各板块打开不白屏", async ({ page }) => {
  await page.goto("/chat")
  await page.getByRole("button", { name: "设置", exact: true }).first().click()
  // exact 必给:遮罩背后的聊天页也有 aria-label="关闭提示"(ProfileProbe/ChatInput 的提示条),
  // 子串匹配会先命中它 —— 点了它弹窗当然关不掉,表现为随机失败
  const closeBtn = page.getByRole("button", { name: "关闭", exact: true }).first()
  await expect(closeBtn).toBeVisible()
  // 覆盖数据加载最重与纯静态的代表性板块;板块崩溃会导致弹窗消失而失败
  for (const section of ["总览", "记忆", "面具管理", "用户中心", "通用"]) {
    await page.getByRole("button", { name: section, exact: true }).first().click()
    await expect(closeBtn).toBeVisible()
  }
  await closeBtn.click()
  await expect(closeBtn).toBeHidden()
})
