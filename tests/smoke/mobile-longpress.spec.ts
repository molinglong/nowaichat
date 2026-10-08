import { test, expect, type Page, type Locator } from "@playwright/test"

// 手机端长按菜单回归（用户报两条：菜单触发时机不对 / 复制到的内容不对）。
// 根因：安卓长按先派 contextmenu、选区随后才建立，旧实现在 contextmenu 当下装配菜单项，
// 既把没选中的整条复制走，又让菜单在手指仍压屏时弹出、被紧随的微滚/合成 mousedown 关掉。
// 布局保持桌面尺寸（复用既有「新对话/发送」选择器），触屏判定由 CDP 强制 pointer=coarse 生效。
// evaluate 回调会被序列化到页面执行，模块作用域的函数引不进来，故选区/事件构造就地写。

const SENT_1 = "甲句是不该被复制的第一句。"
const SENT_2 = "乙句是长按后应当选中的第二句。"

const streamBody = (text: string) =>
  [
    { type: "start" },
    { type: "text-start", id: "seg-1" },
    { type: "text-delta", id: "seg-1", delta: text },
    { type: "text-end", id: "seg-1" },
    { type: "finish" },
  ]
    .map((e) => `data: ${JSON.stringify(e)}\n\n`)
    .join("") + "data: [DONE]\n\n"

/** 造一条含两句话的助手回复 */
async function seedReply(page: Page) {
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: streamBody(`${SENT_1}${SENT_2}`),
    })
  )
  await page.goto("/chat")
  await page.getByRole("button", { name: "新对话" }).first().click()
  const input = page.locator("textarea").first()
  await expect(input).toBeVisible({ timeout: 30_000 })
  await input.fill("给我两句话")
  await page.getByRole("button", { name: "发送" }).click()
  await expect(page.getByText(SENT_2).first()).toBeVisible({ timeout: 30_000 })
}

/** 强制主指针为触屏（matchMedia('(pointer: coarse)') 的判定源） */
async function emulateCoarsePointer(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "pointer", value: "coarse" },
      { name: "any-pointer", value: "coarse" },
    ],
  })
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true })
  expect(await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(true)
}

const lastBubble = (page: Page): Locator => page.locator("[data-message-id]").last()
const menu = (page: Page) => page.locator('[role="menu"]')
const copyItem = (page: Page) => page.getByRole("menuitem", { name: "复制", exact: true })

/**
 * 复刻安卓长按的事件时序：contextmenu（此刻选区仍为空）→ 选区建立 → touchend。
 * 两个观测点都必须等两帧：zustand 落 state 到菜单 DOM 之间隔着 React 渲染，
 * 不等帧的话连「旧实现当下就弹」也测不出来。
 */
async function runLongPress(page: Page) {
  return page.evaluate(async (sent) => {
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const pick = (): HTMLElement => {
      const nodes = document.querySelectorAll("[data-message-id]")
      return nodes[nodes.length - 1] as HTMLElement
    }
    const pressAt = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      el.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: Math.round(r.left + r.width / 2),
          clientY: Math.round(r.top + 20),
        })
      )
    }
    const select = (el: HTMLElement) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let target: Text | null = null
      while (walker.nextNode()) {
        const t = walker.currentNode as Text
        if (t.data.includes(sent)) target = t
      }
      if (!target) throw new Error("回复正文里没找到目标句")
      const range = document.createRange()
      const at = target.data.indexOf(sent)
      range.setStart(target, at)
      range.setEnd(target, at + sent.length)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
    }

    const el = pick()
    pressAt(el)
    await nextFrame()
    const menuAtContextMenu = !!document.querySelector('[role="menu"]')
    select(el)
    el.dispatchEvent(new Event("touchend", { bubbles: true }))
    await nextFrame()
    return { menuAtContextMenu, menuAtTouchEnd: !!document.querySelector('[role="menu"]') }
  }, SENT_2)
}

test.beforeEach(async ({ page }) => {
  await seedReply(page)
})

test("长按当下不弹菜单，抬手后才弹", async ({ page }) => {
  await emulateCoarsePointer(page)
  const { menuAtContextMenu, menuAtTouchEnd } = await runLongPress(page)
  expect(menuAtContextMenu, "contextmenu 当下就弹会压在手指底下").toBe(false)
  expect(menuAtTouchEnd, "抬手后必须弹，否则长按没有任何菜单").toBe(true)
  await expect(copyItem(page)).toBeVisible()
  await page.screenshot({ path: "test-results/mobile-longpress-menu.png" })
})

test("复制走的是长按选区，不是整条消息", async ({ page }) => {
  await emulateCoarsePointer(page)
  await runLongPress(page)
  await copyItem(page).click()
  const clipped = await page.evaluate(() => navigator.clipboard.readText())
  expect(clipped, "长按选中一句却复制整条,就是用户报的第一条").toBe(SENT_2)
})

test("菜单刚弹时的惯性微滚不得关掉菜单", async ({ page }) => {
  await emulateCoarsePointer(page)
  await runLongPress(page)
  const nudge = () => lastBubble(page).evaluate((el) => el.dispatchEvent(new Event("scroll", { bubbles: true })))
  await nudge()
  await expect(menu(page)).toBeVisible()
  // 宽限期过后的滚动才该收菜单
  await page.waitForTimeout(400)
  await nudge()
  await expect(menu(page)).toHaveCount(0)
})

test("桌面右键仍当下即弹(轮盘),不被触屏改动带偏", async ({ page }) => {
  await lastBubble(page).evaluate((el) => {
    const r = el.getBoundingClientRect()
    el.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + 20),
      })
    )
  })
  await expect(menu(page)).toBeVisible()
  await expect(copyItem(page)).toBeVisible()
})
