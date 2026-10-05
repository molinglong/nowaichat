import { test, expect } from '@playwright/test'

/**
 * 取证链路冒烟:采集器装机 → 上报入库 → /diagnostics 手机端可读 → 出站脱敏。
 *
 * 这条链路是"VPS 上手机上看不见控制台也能排障"的唯一依赖,断了就等于盲飞,
 * 所以端到端验一次(不碰 prisma:页面是服务端直读数据库,页面能渲染出来说明已入库)。
 */

test.describe('客户端错误取证', () => {
  test('采集器已装机并暴露注入口', async ({ page }) => {
    await page.goto('/chat')
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 30_000 })
    const installed = await page.evaluate(() => {
      const d = (window as unknown as { __diag?: { report?: unknown; snapshot?: unknown } }).__diag
      return !!d && typeof d.report === 'function' && typeof d.snapshot === 'function'
    })
    expect(installed, 'Providers 里的 ClientDiagnostics 未装载').toBe(true)
  })

  test('上报的证据能在取证页读出,且密钥被脱敏', async ({ page }) => {
    const tag = `smoke-${Date.now()}`
    await page.goto('/chat')
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 30_000 })

    const stored = page
      .waitForResponse(
        (res) => res.url().includes('/api/client-diagnostics') && res.status() === 200,
        { timeout: 30_000 }
      )
      .then((res) => res.json())

    await page.evaluate((label) => {
      const d = (window as unknown as {
        __diag: { report: (kind: string, message: string, stack?: string) => void; flush: () => void }
      }).__diag
      d.report('manual', `冒烟取证 ${label}`)
      d.report('manual', `冒烟脱敏 ${label} sk-abcdefghij123456`)
      d.flush()
    }, tag)

    const body = await stored
    expect(body.stored, '两条证据未全部入库').toBeGreaterThanOrEqual(2)

    await page.goto('/diagnostics')
    // 同一句话既出现在条目正文也出现在面包屑里,取第一条即可
    await expect(page.getByText(`冒烟取证 ${tag}`, { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('[redacted-key]').first()).toBeVisible()
    // 原始密钥绝不能落到库里(库是最终交付物)
    await expect(page.getByText('sk-abcdefghij123456')).toHaveCount(0)

    // 现场数据随证据一起上来:面包屑记录了会话启动与上报动作。
    // 用 exact 段落锁定条目:同 tag 的另一条证据会把这句写进自己的面包屑,模糊匹配会命中两条。
    const entry = page.locator('li').filter({ has: page.getByText(`冒烟取证 ${tag}`, { exact: true }) })
    const details = entry.locator('details')
    await details.locator('summary').click()
    await expect(details.getByText('面包屑', { exact: true })).toBeVisible()
    await expect(details.getByText('会话启动')).toBeVisible()
  })

  test('渲染探针在跑,崩前那一秒的刷帧数会随证据上报', async ({ page }) => {
    await page.goto('/chat')
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 30_000 })

    const snapshot = await page.evaluate(() => {
      const d = (window as unknown as {
        __diag: { report: (k: string, m: string) => void; snapshot: () => { crumbs: unknown[]; renders: Record<string, number> }; flush: () => void }
      }).__diag
      d.report('manual', `冒烟计数 ${Date.now()}`)
      return d.snapshot()
    })

    expect(Object.keys(snapshot.renders).length, '渲染计数器为空,探针没接上').toBeGreaterThan(0)
    expect(snapshot.renders.ChatPanel ?? 0, 'ChatPanel 探针未生效').toBeGreaterThan(0)
    expect(snapshot.crumbs.length).toBeGreaterThan(0)
    await page.evaluate(() => {
      ;(window as unknown as { __diag: { flush: () => void } }).__diag.flush()
    })
  })
})
