import { test as setup } from "@playwright/test"
import { ADMIN } from "./helpers"

const STATE_FILE = ".auth/admin.json"

// 登录 admin 一次并保存会话,供 core-smoke 项目复用
setup("authenticate", async ({ page }) => {
  await page.goto("/login")
  await page.locator("#email").fill(ADMIN.id)
  await page.locator("#password").fill(ADMIN.password)
  await page.getByRole("button", { name: /登\s*录/ }).click()
  await page.waitForURL(/\/chat/, { timeout: 60_000 })
  await page.context().storageState({ path: STATE_FILE })
})
