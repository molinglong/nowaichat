import { defineConfig } from "@playwright/test"

// 冒烟测试配置:复用已在 3456 运行的 dev server,否则自动拉起
export default defineConfig({
  testDir: "./tests/smoke",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // dev server 偶发瞬时异常(如数据库连接闪断)会导致登录偶发失败,自动重试一次
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3456",
    locale: "zh-CN",
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
  },
  projects: [
    {
      // 登录一次 admin,生成 storageState 供 core-smoke 复用(避免每条用例重复登录触发限速)
      name: "setup",
      testMatch: /setup\.global\.ts/,
    },
    {
      // 鉴权相关用例:独立 context,不预置会话
      name: "auth-smoke",
      testMatch: /auth\.spec\.ts/,
    },
    {
      // 核心链路用例:复用 admin 会话
      name: "core-smoke",
      testMatch: /core\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: ".auth/admin.json" },
    },
    {
      // 写作画布用例:复用 admin 会话
      name: "write-smoke",
      testMatch: /write\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: ".auth/admin.json" },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3456",
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
