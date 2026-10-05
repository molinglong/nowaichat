import { test, expect, type Page } from "@playwright/test"
import { FULLTESTER } from "./helpers"

/**
 * 批量删除会话冒烟(复用 setup 生成的 admin 会话):
 *  1) UI 多选链路:批量管理 → 勾选 → 自定义确认弹窗 → 列表即时移除 + toast
 *  2) 「全选」只验证勾选态,不点删除 —— 全选会连带选中 admin 的真实历史会话
 *  3) 归属校验:他人会话 id 混入批量请求只被跳过,不会被删;整批无一条属于本人 → 400/404
 *  4) 入参护栏:空数组与超过单次上限 200 条都拒绝
 * 未覆盖:级联清理磁盘附件 —— 造一条带附件消息需要打真实上游,冒烟不花这个成本。
 * 行定位一律非精确匹配:普通态的行是 <a>,无障碍名会把行内「重命名/删除对话」按钮的 aria-label 也算进去。
 * 用例自建会话(标题含 MARK),结束兜底清理。
 */

const MARK = "批量冒烟"
const RUN = Date.now().toString(36)
/** 与后端 MAX_IDS_PER_REQUEST 对齐 */
const MAX_IDS = 200

/** 索引补零到三位:标题互不为前缀,非 exact 的无障碍名匹配也不会串味 */
function title(i: number) {
  return `${MARK}-${RUN}-${String(i).padStart(3, "0")}`
}

async function createConversations(page: Page, indexes: number[]): Promise<string[]> {
  const ids: string[] = []
  for (const i of indexes) {
    const res = await page.request.post("/api/conversations", { data: { title: title(i) } })
    expect(res.ok()).toBeTruthy()
    const conv = (await res.json()) as { id: string }
    ids.push(conv.id)
  }
  return ids
}

/** 兜底清理:按 MARK 搜出本次(及中断残留)会话逐条删掉,幂等 */
async function cleanupLeaks(page: Page) {
  const res = await page.request.get(`/api/conversations?q=${encodeURIComponent(MARK)}&limit=100`)
  if (!res.ok()) return
  const data = (await res.json()) as { items?: Array<{ id: string }> }
  for (const c of data.items ?? []) {
    await page.request.delete(`/api/conversations/${c.id}`)
  }
}

async function gotoWithSidebar(page: Page) {
  await page.goto("/chat")
  await expect(page.getByRole("button", { name: "批量管理对话" })).toBeVisible({ timeout: 30_000 })
}

test.beforeEach(async ({ page }) => {
  await cleanupLeaks(page)
})

test.afterEach(async ({ page }) => {
  await cleanupLeaks(page)
})

test("多选批量删除走自定义确认弹窗,删除后列表即时移除", async ({ page }) => {
  await createConversations(page, [1, 2, 3])
  await gotoWithSidebar(page)

  // 三条测试会话都在列表首页(按 updatedAt 倒序)
  for (const i of [1, 2, 3]) {
    await expect(page.getByRole("link", { name: title(i) })).toBeVisible()
  }

  await page.getByRole("button", { name: "批量管理对话" }).click()
  // 进入管理模式:行由链接变为勾选按钮,删除钮在未勾选时禁用
  for (const i of [1, 2, 3]) {
    await expect(page.getByRole("button", { name: title(i) })).toBeVisible()
  }
  const deleteButton = page.getByRole("button", { name: "删除 3 个对话" })
  await expect(page.getByRole("button", { name: "删除 0 个对话" })).toBeDisabled()

  for (const i of [1, 2, 3]) {
    await page.getByRole("button", { name: title(i) }).click()
  }
  await expect(deleteButton).toHaveText("删除 3")

  await deleteButton.click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText("删除 3 个对话？")).toBeVisible()
  await expect(dialog.getByText(/删除后不可恢复/)).toBeVisible()

  await dialog.getByRole("button", { name: "删除" }).click()

  // 关闭即从缓存剔除,不需要整表 refetch
  await expect(dialog).not.toBeVisible()
  for (const i of [1, 2, 3]) {
    await expect(page.getByRole("link", { name: title(i) })).toHaveCount(0)
  }
  // iziToast 的 DOM 不在本项目组件树里,按类名断言
  await expect(page.locator(".iziToast").filter({ hasText: "已删除 3 个对话" }).first()).toBeVisible()
})

test("取消确认弹窗不删除;确认后再次进入模式勾选态已清空", async ({ page }) => {
  await createConversations(page, [11])
  await gotoWithSidebar(page)

  await page.getByRole("button", { name: "批量管理对话" }).click()
  await page.getByRole("button", { name: title(11) }).click()
  await page.getByRole("button", { name: "删除 1 个对话" }).click()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "取消" }).click()
  await expect(dialog).not.toBeVisible()
  // 取消 = 一条都没删
  await expect(page.getByRole("button", { name: title(11) })).toBeVisible()

  // 退出管理模式再进入,勾选集合应已清空
  await page.getByRole("button", { name: "退出批量管理" }).click()
  await expect(page.getByRole("button", { name: "批量管理对话" })).toBeVisible()
  await page.getByRole("button", { name: "批量管理对话" }).click()
  await expect(page.getByRole("button", { name: "删除 0 个对话" })).toBeDisabled()
})

test("全选把已加载行置为选中,取消全选复原(不触发删除)", async ({ page }) => {
  await createConversations(page, [21, 22])
  await gotoWithSidebar(page)

  await page.getByRole("button", { name: "批量管理对话" }).click()
  const row21 = page.getByRole("button", { name: title(21) })

  await expect(row21).toHaveAttribute("aria-pressed", "false")
  await page.getByRole("button", { name: /全选/ }).click()
  await expect(row21).toHaveAttribute("aria-pressed", "true")

  await page.getByRole("button", { name: /取消全选/ }).click()
  await expect(row21).toHaveAttribute("aria-pressed", "false")
})

test("单条删除也走自定义弹窗(替代原生 window.confirm)", async ({ page }) => {
  await createConversations(page, [41])
  await gotoWithSidebar(page)

  const row = page.getByRole("link", { name: title(41) })
  await row.hover()
  await row.getByRole("button", { name: "删除对话" }).click()

  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("删除这个对话？")).toBeVisible()
  await dialog.getByRole("button", { name: "删除" }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole("link", { name: title(41) })).toHaveCount(0)
})

test("他人会话 id 混入批量请求只被跳过,本人会话正常删除", async ({ page, browser }) => {
  // 凭据缺失时给出可读失败,而不是登录超时
  expect(FULLTESTER.id).not.toBe("")
  expect(FULLTESTER.mainPassword).not.toBe("")

  const [ownId] = await createConversations(page, [31])

  // 第二个账号(主密码登录)建一条会话,admin 无权删它。
  // 同样要显式清掉继承来的 admin storageState,否则登录态是 admin 而不是 FULLTESTER。
  const otherContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const otherPage = await otherContext.newPage()
  await otherPage.goto("/login")
  await otherPage.locator("#email").fill(FULLTESTER.id)
  await otherPage.locator("#password").fill(FULLTESTER.mainPassword)
  await otherPage.getByRole("button", { name: /登\s*录/ }).click()
  await otherPage.waitForURL(/\/chat/, { timeout: 60_000 })
  const foreignRes = await otherPage.request.post("/api/conversations", { data: { title: title(32) } })
  expect(foreignRes.ok()).toBeTruthy()
  const foreignId = ((await foreignRes.json()) as { id: string }).id

  try {
    const res = await page.request.post("/api/conversations/batch-delete", {
      data: { ids: [ownId, foreignId, "c000000000000000000000nope"] },
    })
    expect(res.ok()).toBeTruthy()
    const data = (await res.json()) as { deleted: number; skipped: number }
    expect(data.deleted).toBe(1)
    expect(data.skipped).toBe(2)

    // 本人会话已消失,他人会话仍在
    await expect(
      (await page.request.get(`/api/conversations/${ownId}`)).status()
    ).toBe(404)
    await expect(
      (await otherPage.request.get(`/api/conversations/${foreignId}`)).status()
    ).toBe(200)
  } finally {
    await otherPage.request.delete(`/api/conversations/${foreignId}`)
    await otherContext.close()
  }
})

test("入参护栏:空数组、超上限、非法 body 一律 400", async ({ page }) => {
  const empty = await page.request.post("/api/conversations/batch-delete", { data: { ids: [] } })
  expect(empty.status()).toBe(400)

  const tooMany = await page.request.post("/api/conversations/batch-delete", {
    data: { ids: Array.from({ length: MAX_IDS + 1 }, (_, i) => `c${String(i).padStart(24, "0")}`) },
  })
  expect(tooMany.status()).toBe(400)

  const notArray = await page.request.post("/api/conversations/batch-delete", { data: { ids: "abc" } })
  expect(notArray.status()).toBe(400)

  // 整批没有一条属于本人 → 不静默成功
  const noneOwned = await page.request.post("/api/conversations/batch-delete", {
    data: { ids: ["c000000000000000000000nope"] },
  })
  expect(noneOwned.status()).toBe(404)
})

test("未登录调用返回 401", async ({ browser }) => {
  // 本项目预置了 admin storageState,browser.newContext() 会继承 —— 必须显式清空才是真匿名
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const res = await anon.request.post("/api/conversations/batch-delete", {
    data: { ids: ["whatever"] },
  })
  expect(res.status()).toBe(401)
  await anon.close()
})
