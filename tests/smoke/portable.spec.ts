import { test, expect, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

/**
 * 会话搬运(导出/导入)UI 冒烟 —— 覆盖 HTTP 层核验脚本覆盖不到的"可见面":
 *  1) 单条右键菜单「导出对话包（可导入）」真的能触发下载,且落地的文件就是 bundle 契约
 *  2) 批量管理模式导完**不**退出勾选(用户常见动作是"先导再决定删谁")
 *  3) 设置→对话搬运:预演不写库 → 确认才写库 → 再导一次报「已存在，跳过」
 *  4) 附件只搬引用不搬文件这笔债,必须上屏成「导入时未迁移 N 个附件」角标
 *
 * 真消息的导出/回灌闭环(含面具降级、越权拒绝、幂等)由 scripts/verify-portable.cjs
 * 在 HTTP+DB 层判验,这里不重复打真实上游造消息。
 * 用例自建的会话标题都带 MARK,afterEach 按 MARK 清理;导入用的 id 带 RUN 后缀,不会撞历史数据。
 */

const MARK = '搬运冒烟'
const RUN = Date.now().toString(36)

function title(i: number) {
  return `${MARK}-${RUN}-${String(i).padStart(3, '0')}`
}

/** 手工造一份合法 bundle:一条会话、两条消息、其中一条挂 2 个附件引用 */
function makeBundle() {
  const convId = `smoke-portable-${RUN}`
  const createdAt = '2026-01-02T03:04:05.000Z'
  return {
    convId,
    bundle: {
      kind: 'aichat.conversation-bundle',
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: 'smoke',
      conversations: [
        {
          id: convId,
          title: title(9),
          model: 'gpt-4o',
          mode: 'single',
          maskId: null,
          createdAt,
          updatedAt: createdAt,
          messages: [
            {
              id: `${convId}-m1`,
              role: 'user',
              content: '搬运冒烟的原话',
              createdAt,
              attachments: [
                { url: '/api/uploads/nope-a.png', name: '搬运核验图.png', type: 'image/png' },
                { url: '/api/uploads/nope-b.xlsx', name: '搬运核验表.xlsx', type: 'application/vnd.ms-excel' },
              ],
            },
            {
              id: `${convId}-m2`,
              role: 'assistant',
              content: '搬运冒烟的回复',
              createdAt,
            },
          ],
          summaries: [],
          compareVotes: [],
        },
      ],
    },
  }
}

async function createConversation(page: Page, i: number): Promise<string> {
  const res = await page.request.post('/api/conversations', { data: { title: title(i) } })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { id: string }).id
}

/** 兜底清理:按 MARK 搜出本次会话逐条删掉(含导入产生的),幂等可重跑 */
async function cleanupLeaks(page: Page) {
  // afterEach 里的网络抖动不该把一条本来通过的用例判成 flaky,但也不能假装清干净了:
  // 失败只打警告,下一轮 beforeEach 会再清一次(残留核验交给 HTTP 层的基线断言)
  try {
    const res = await page.request.get(
      `/api/conversations?q=${encodeURIComponent(MARK)}&limit=100`
    )
    if (!res.ok()) return
    const data = (await res.json()) as { items?: Array<{ id: string }> }
    for (const c of data.items ?? []) {
      await page.request.delete(`/api/conversations/${c.id}`)
    }
  } catch (err) {
    console.warn(`[portable-smoke] 清理未跑完,下轮 beforeEach 会重试: ${String(err)}`)
  }
}

async function gotoWithSidebar(page: Page) {
  await page.goto('/chat')
  await expect(page.getByRole('button', { name: '批量管理对话' })).toBeVisible({ timeout: 30_000 })
}

async function openPortableSection(page: Page) {
  await page.goto('/chat')
  // 侧栏与顶栏各有一个「设置」按钮,取顶栏那个(与手机端同源,两端都点得到)
  await page.getByRole('button', { name: '设置' }).last().click()
  await page.getByRole('button', { name: '对话搬运' }).click()
  await expect(page.getByText('导入对话')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await cleanupLeaks(page)
})

test.afterEach(async ({ page }) => {
  await cleanupLeaks(page)
})

test('右键单条导出对话包:菜单项存在,下载到的就是 bundle 契约', async ({ page }) => {
  const id = await createConversation(page, 1)
  await gotoWithSidebar(page)

  const row = page.getByText(title(1), { exact: false }).first()
  await expect(row).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    row.click({ button: 'right' }).then(async () => {
      await page.getByRole('menuitem', { name: '导出对话包（可导入）' }).click()
    }),
  ])

  expect(download.suggestedFilename()).toContain('.aichat.json')
  const text = await download.createReadStream().then(async (stream) => {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks).toString('utf-8')
  })
  const parsed = JSON.parse(text) as { kind: string; version: number; conversations: Array<{ id: string }> }
  expect(parsed.kind).toBe('aichat.conversation-bundle')
  expect(parsed.version).toBe(1)
  expect(parsed.conversations).toHaveLength(1)
  expect(parsed.conversations[0].id).toBe(id)
})

test('批量导出:勾选后导出按钮报数,导完不退出管理模式(勾选集合留着)', async ({ page }) => {
  await createConversation(page, 2)
  await createConversation(page, 3)
  await gotoWithSidebar(page)

  await page.getByRole('button', { name: '批量管理对话' }).click()
  await page.getByText(title(2), { exact: false }).first().click()
  await page.getByText(title(3), { exact: false }).first().click()

  const exportButton = page.getByRole('button', { name: '导出 2' })
  await expect(exportButton).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportButton.click(),
  ])
  const text = await download.createReadStream().then(async (stream) => {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks).toString('utf-8')
  })
  const parsed = JSON.parse(text) as { conversations: unknown[] }
  expect(parsed.conversations).toHaveLength(2)

  // 导完仍在管理模式且勾选未清:紧接着就能用同一批勾选做删除决策
  await expect(page.getByRole('button', { name: '删除 2' })).toBeVisible()
  await expect(exportButton).toBeVisible()
})

test('设置→对话搬运:预演不落库,确认才落库,重复导入报"已存在，跳过"', async ({ page }) => {
  const { convId, bundle } = makeBundle()
  const file = path.join(os.tmpdir(), `${MARK}-${RUN}.json`)
  await fs.writeFile(file, JSON.stringify(bundle, null, 2), 'utf-8')

  await openPortableSection(page)
  // 面板之外页面上还有 ChatInput 的附件输入(它在 DOM 里更靠前,且也会把选中的文件名显示出来),
  // 用 .first() 会把包喂给它。按 accept 精确认领自己那个。
  const fileInput = page.locator('input[type="file"][accept*=".json"]')
  await expect(fileInput).toHaveCount(1)
  await fileInput.setInputFiles(file)
  await expect(page.getByText(path.basename(file))).toBeVisible()

  // 预演:报"将新建",但库里查不到(状态文案只认清单行里那个,否则会撞 toast/按钮同名)
  await page.getByRole('button', { name: '先看看会导进什么' }).click()
  await expect(page.getByRole('listitem').getByText('将新建', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '确认导入 1 条' })).toBeVisible()
  expect((await page.request.get(`/api/conversations/${convId}`)).status()).toBe(404)

  // 确认:写入后可查
  await page.getByRole('button', { name: '确认导入 1 条' }).click()
  await expect(page.getByRole('listitem').getByText('已导入', { exact: true })).toBeVisible()
  await expect((await page.request.get(`/api/conversations/${convId}`)).ok()).toBeTruthy()

  // 再预演一次同一份:应当点名"已存在，跳过",且不给确认按钮
  await page.getByRole('button', { name: '先看看会导进什么' }).click()
  await expect(page.getByRole('listitem').getByText('已存在，跳过', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /确认导入/ })).toHaveCount(0)

  await fs.unlink(file)
})

test('导入的消息上屏"未迁移附件"角标,hover 交代原文件名', async ({ page }) => {
  const { convId, bundle } = makeBundle()
  const res = await page.request.post('/api/conversations/import', {
    data: { bundle },
  })
  expect(res.ok()).toBeTruthy()

  await page.goto(`/chat/c/${convId}`)
  const chip = page.getByText('导入时未迁移 2 个附件')
  await expect(chip).toBeVisible({ timeout: 30_000 })
  await expect(chip).toHaveAttribute('title', /搬运核验图\.png.*搬运核验表\.xlsx/)

  // 附件引用确实没进正文:不存在点开就 404 的死链图片
  await expect(page.locator('img[src*="nope-a.png"]')).toHaveCount(0)
})
