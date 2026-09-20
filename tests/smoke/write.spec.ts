import { test, expect } from "@playwright/test"

/**
 * 写作画布(/write)冒烟 —— 覆盖:导航入口 / 新建 / 编辑自动保存 /
 * 刷新持久化 / 重命名 / 删除 / 未鉴权 API 401。
 * 不跑真实 AI 生成(不耗用户 token 配额),生成链路由人工冒烟覆盖。
 */

const TITLE = "冒烟测试章"
const SAMPLE = "第一段冒烟测试正文,风速很小的下午。\n\n第二段:窗外有人走过。"

test("写作画布核心链路", async ({ page, request }) => {
  await page.goto("/write")
  await expect(page.getByRole("button", { name: "新建文档" }).first()).toBeVisible({ timeout: 30_000 })

  // 清理上次运行可能残留的测试文档(幂等):测试产物一律叫「冒烟测试章」
  const list = await request.get("/api/write/docs", { timeout: 30_000 }) // 高负载下接口可能超过默认 20s
  if (list.ok()) {
    const { docs } = (await list.json()) as { docs: Array<{ id: string; title: string }> }
    for (const d of docs) {
      if (d.title === TITLE) await request.delete(`/api/write/docs/${d.id}`)
    }
    await page.reload()
    await expect(page.getByRole("button", { name: "新建文档" }).first()).toBeVisible({ timeout: 30_000 })
  }

  // TopBar「更多」二级菜单包含写作画布入口(点击后仍在 /write,入口存在即通过)
  await page.getByRole("button", { name: "更多功能" }).click()
  await page.getByRole("menuitem", { name: "写作画布" }).click()
  await expect(page).toHaveURL(/\/write/)

  // 新建文档 → 先重命名(失败运行也不残留「未命名」) → 输入正文 → 自动保存
  await page.getByRole("button", { name: "新建文档" }).first().click()
  const editor = page.locator("textarea").first()
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await page.locator('input[placeholder="未命名"]').fill(TITLE)
  await editor.fill(SAMPLE)
  await expect(page.getByText(/编辑中|保存中/)).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText("已保存")).toBeVisible({ timeout: 20_000 })

  // 刷新后标题/正文仍在(持久化验证;刚保存的文档 updatedAt 最新,自动选中)
  await page.reload()
  await expect(page.locator("textarea").first()).toHaveValue(SAMPLE, { timeout: 30_000 })
  await expect(page.locator("aside").getByText(TITLE)).toBeVisible()

  // 删除当前文档:两段式确认 → 条目消失
  // 注意:列表项容器是 role=button 的 div,name 含「删除文档」尾缀,需 exact+限定在 li 内定位真按钮
  const item = page.locator("aside").locator("li", { hasText: TITLE })
  await item.hover()
  await item.getByRole("button", { name: "删除文档", exact: true }).click()
  await item.getByRole("button", { name: "再次点击确认删除", exact: true }).click()
  await expect(item).toHaveCount(0)
})

test("未登录访问写作 API 返回 401", async ({ playwright }) => {
  // write-smoke 项目级 storageState 会被 newContext() 合并,这里显式空 storageState 覆盖
  const ctx = await playwright.request.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const res = await ctx.get("/api/write/docs")
    expect(res.status()).toBe(401)
  } finally {
    await ctx.dispose()
  }
})
