import { test, expect } from "@playwright/test"
import { ADMIN, FULLTESTER } from "./helpers"

// 鉴权冒烟:登录表单 + 临时入口(独立 context,不预置会话)
// 凭据从 .env 的 SMOKE_* 变量读取,见 tests/smoke/helpers.ts

test("登录成功跳转聊天页", async ({ page }, testInfo) => {
  // 捕获 NextAuth 回调响应状态,失败时作为附件输出用于定位
  page.on("response", (res) => {
    if (res.url().includes("/api/auth/")) {
      void testInfo.attach(`auth-res-${res.status()}`, {
        body: `${res.status()} ${res.request().method} ${res.url()}`,
      })
    }
  })
  await page.goto("/login")
  await page.locator("#email").fill(ADMIN.id)
  await page.locator("#password").fill(ADMIN.password)
  await page.getByRole("button", { name: /登\s*录/ }).click()
  await page.waitForURL(/\/chat/, { timeout: 60_000 })
})

test("临时入口拒绝主密码", async ({ page }) => {
  await page.goto("/login/ephemeral")
  await page.locator("#email").fill(FULLTESTER.id)
  await page.locator("#password").fill(FULLTESTER.mainPassword) // 主密码
  await page.getByRole("button", { name: "进入临时聊天" }).click()
  await expect(page.getByText("此入口仅支持访客密码")).toBeVisible()
})

test("访客密码进入临时模式", async ({ page }) => {
  await page.goto("/login/ephemeral")
  await page.locator("#email").fill(FULLTESTER.id)
  await page.locator("#password").fill(FULLTESTER.guestPassword) // 访客密码
  await page.getByRole("button", { name: "进入临时聊天" }).click()
  await page.waitForURL(/\/chat/, { timeout: 60_000 })
  await expect(page.locator("textarea").first()).toBeVisible()
})
