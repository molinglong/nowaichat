import { test, expect } from "@playwright/test"

// 回复长度档冒烟：会话级读写闭环 + 设置页滑杆交互。
// 长度轴刻意与风格轴正交：单改长度不得动 stylePreset（回归风险点）。

const detail = async (request: any, cid: string) =>
  (await request.get(`/api/conversations/${cid}`)).json()

test("长度档读写闭环", async ({ request }) => {
  const listRes = await request.get("/api/conversations?limit=5")
  expect(listRes.ok()).toBeTruthy()
  const items = (await listRes.json()).items
  expect(items.length).toBeGreaterThan(0)
  const cid: string = items[0].id

  const origin = (await detail(request, cid)).replyLength ?? null
  const patch = (payload: unknown) =>
    request.patch(`/api/conversations/${cid}/style`, { data: payload })

  // 写入 short 并读回
  expect((await patch({ replyLength: "short" })).status()).toBe(200)
  expect((await detail(request, cid)).replyLength).toBe("short")

  // 非法档必须被拒
  const bad = await patch({ replyLength: "bogus" })
  expect(bad.status()).toBe(400)
  expect((await bad.json()).error).toContain("回复长度档不存在")

  // 单改长度不改风格（双轴正交）
  const styleBefore = (await detail(request, cid)).stylePreset
  expect((await patch({ replyLength: "detailed" })).status()).toBe(200)
  const after = await detail(request, cid)
  expect(after.stylePreset).toBe(styleBefore)
  expect(after.replyLength).toBe("detailed")

  // standard 归一为 null（等价「不额外限制篇幅」）
  expect((await patch({ replyLength: "standard" })).status()).toBe(200)
  expect((await detail(request, cid)).replyLength).toBe(null)

  // 还原测试前的值，不留痕迹
  if (origin !== null) expect((await patch({ replyLength: origin })).status()).toBe(200)
})

test("设置→通用 的长度滑杆可切档并给出确认", async ({ page }) => {
  await page.goto("/chat")
  await page.getByRole("button", { name: /设置/ }).first().click()
  await page.getByRole("button", { name: "通用" }).click()

  // 「回复长度」在卡片内同时是滑杆 label 与档位行文案，用 slider 角色做唯一锚点
  const slider = page.getByRole("slider", { name: "回复长度滑杆" })
  await expect(slider).toBeVisible({ timeout: 15_000 })

  await page.getByRole("button", { name: "详尽" }).click()
  await expect(slider).toHaveValue("3")
  await expect(page.getByText("回复长度已设为详尽")).toBeVisible({ timeout: 10_000 })

  await page.getByRole("button", { name: "极简" }).click()
  await expect(slider).toHaveValue("0")
  await expect(page.getByText("回复长度已设为极简")).toBeVisible({ timeout: 10_000 })

  // 停靠点与标签对齐属渲染细节，截图留档供肉眼核（test-results 已 gitignore）
  await slider
    .locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")
    .screenshot({ path: "test-results/reply-length-slider.png" })
})

const PROBE_QUESTION = "为什么天空是蓝色的？"

/** 打一次真实上游，回正文纯文本（从 UI 消息流里摘 text-delta） */
async function askOnce(request: any, replyLength: string): Promise<string> {
  const res = await request.post("/api/chat", {
    data: {
      model: "deepseek-flash",
      replyLength,
      messages: [
        { id: "probe-1", role: "user", parts: [{ type: "text", text: PROBE_QUESTION }] },
      ],
    },
    timeout: 120_000,
  })
  expect(res.status()).toBe(200)
  let text = ""
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data: ")) continue
    const payload = line.slice(6)
    if (payload === "[DONE]") continue
    try {
      const ev = JSON.parse(payload)
      if (ev.type === "text-delta" && typeof ev.delta === "string") text += ev.delta
    } catch {
      /* 非 JSON 心跳行忽略 */
    }
  }
  return text
}

test("档位真实生效：极简与详尽的正文差一个量级", async ({ request }) => {
  test.setTimeout(240_000)
  const minimal = await askOnce(request, "minimal")
  const detailed = await askOnce(request, "detailed")
  expect(minimal.trim().length).toBeGreaterThan(0)
  expect(detailed.trim().length).toBeGreaterThan(minimal.trim().length * 3)
})
