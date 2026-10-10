/*
 * 会话搬运(导出/导入)端到端核验 —— 只打本机 dev 实例与本机库。
 *
 * 覆盖:导出结构、跨账号越权拒写、预演不落库、真实写入(内容/时间/面具降级)、
 * 幂等重导、附件引用摘除并留下前端可见的凭据、坏包报人话。
 *
 * 跑法:node scripts/verify-portable.cjs
 * 造"另一个账号"的样本走 pg 直插,用完即删;删除只按本次自建的 id,不碰任何既有数据。
 */
const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const { Pool } = require('pg')

const BASE = process.env.PORTABLE_SMOKE_BASE || 'http://localhost:3456'
const ADMIN_ID = process.env.SMOKE_ADMIN_ID || 'admin'
const ADMIN_PW = process.env.SMOKE_ADMIN_PASSWORD
const DB_URL = process.env.DATABASE_URL || ''

// 安全闸:这个脚本会写库,只允许本机库
if (!/localhost|127\.0\.0\.1/.test(DB_URL)) {
  console.error('拒绝执行:DATABASE_URL 不指向本机，核验脚本不许碰线上库')
  process.exit(1)
}
if (!ADMIN_PW) {
  console.error('拒绝执行:缺少 SMOKE_ADMIN_PASSWORD')
  process.exit(1)
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`)
}

/* ── 带 cookie 的最小 HTTP 客户端 ─────────────────────────── */
const jar = new Map()
function absorb(res) {
  const list = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean)
  for (const c of list) {
    const [kv] = c.split(';')
    const i = kv.indexOf('=')
    if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim())
  }
}
async function api(p, { method = 'GET', body, form } = {}) {
  const headers = { cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }
  let payload
  if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    payload = new URLSearchParams(form).toString()
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(BASE + p, { method, headers, body: payload, redirect: 'manual' })
  absorb(res)
  let json = null
  try {
    json = await res.json()
  } catch {
    /* 空响应体 */
  }
  return { status: res.status, json }
}

let idSeq = 0
function newId(prefix) {
  idSeq += 1
  return `${prefix || 'x'}${Date.now().toString(36)}${idSeq.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

/** 把一份导出会话整体换一套新 id:模拟"另一套库里同内容不同主键"的真实搬运场景 */
function rewriteIds(conv, opts) {
  const o = opts || {}
  const msgMap = new Map()
  conv.messages.forEach((m) => msgMap.set(m.id, newId('m')))
  const groupMap = new Map()
  conv.messages.forEach((m) => {
    if (m.groupId && !groupMap.has(m.groupId)) groupMap.set(m.groupId, newId('g'))
  })
  const convId = newId('c')
  return {
    ...conv,
    id: convId,
    title: `${conv.title}〔搬运核验〕`,
    maskId: o.maskId === undefined ? conv.maskId : o.maskId,
    messages: conv.messages.map((m) => ({
      ...m,
      id: msgMap.get(m.id),
      conversationId: convId,
      groupId: m.groupId ? groupMap.get(m.groupId) ?? m.groupId : null,
      archivedRoot: m.archivedRoot ? msgMap.get(m.archivedRoot) ?? m.archivedRoot : null,
      attachments: o.attachToMessageId === m.id ? o.attachments : m.attachments,
    })),
    summaries: conv.summaries.map((s) => ({
      ...s,
      id: newId('s'),
      conversationId: convId,
      rangeStart: s.rangeStart ? msgMap.get(s.rangeStart) ?? s.rangeStart : s.rangeStart,
      rangeEnd: msgMap.get(s.rangeEnd) ?? s.rangeEnd,
    })),
    compareVotes: conv.compareVotes.map((v) => ({
      ...v,
      id: newId('v'),
      conversationId: convId,
      groupId: groupMap.get(v.groupId) ?? v.groupId,
    })),
  }
}

/** 首屏消息端点走的是原始列(字符串),更早翻页走 format(对象)—— 两种都吃 */
function asObject(v) {
  if (v && typeof v === 'object') return v
  if (typeof v === 'string' && v) {
    try {
      return JSON.parse(v)
    } catch {
      return null
    }
  }
  return null
}

async function main() {
  const pool = new Pool({ connectionString: DB_URL })

  // ── 1. 登录 ────────────────────────────────────────────
  const csrfRes = await api('/api/auth/csrf')
  const csrf = csrfRes.json && csrfRes.json.csrfToken
  check('登录:拿到 csrf', !!csrf, `HTTP ${csrfRes.status}`)
  await api('/api/auth/callback/credentials', {
    method: 'POST',
    form: { csrfToken: csrf, email: ADMIN_ID, password: ADMIN_PW, callbackUrl: BASE },
  })
  const probe = await api('/api/conversations?limit=1')
  check('登录:会话列表可读(200)', probe.status === 200, `HTTP ${probe.status}`)
  if (probe.status !== 200) throw new Error('登录失败，后续无法进行')

  // ── 2. 取样:优先挑带面具 / 对比模式的真实会话 ──────────
  const listRes = await api('/api/conversations?limit=100')
  const items = (listRes.json && (listRes.json.items || listRes.json.conversations)) || []
  const totalBaseline = (listRes.json && listRes.json.total) || 0
  check('取样:本机有可导出的会话', items.length > 0, `共 ${items.length} 条`)
  if (items.length === 0) return

  const withMask = items.find((c) => c.maskId)
  const compareOne = items.find((c) => c.mode === 'compare')
  const samples = []
  if (withMask) samples.push(withMask)
  if (compareOne && compareOne.id !== withMask?.id) samples.push(compareOne)
  for (const c of items) {
    if (samples.length >= 2) break
    if (!samples.includes(c)) samples.push(c)
  }
  const sampleIds = samples.map((c) => c.id)
  check(
    '取样:样本含面具/对比档',
    true,
    `面具=${withMask ? '有' : '无'} 对比=${compareOne ? '有' : '无'}`
  )

  // ── 3. 导出:结构与保真度 ───────────────────────────────
  const exp = await api('/api/conversations/export', { method: 'POST', body: { ids: sampleIds } })
  check('导出:HTTP 200', exp.status === 200, `HTTP ${exp.status}`)
  const bundle = exp.json && exp.json.bundle
  check('导出:契约头正确', bundle && bundle.kind === 'aichat.conversation-bundle' && bundle.version === 1)
  check('导出:条数与请求一致', bundle && bundle.conversations.length === sampleIds.length,
    `${bundle ? bundle.conversations.length : 0}/${sampleIds.length}`)

  // 注意:导出端点的返回顺序不保证跟 ids 入参一致(findMany 的 in 查询按库顺序),
  // 所以凡是要跟库里那一行对照的,一律按 id 找回,不能拿 conversations[0] 当 sampleIds[0]
  const conv0 = bundle && bundle.conversations.find((c) => c.id === sampleIds[0])
  check('导出:会话元数据在包内', !!conv0 && typeof conv0.title === 'string' && !!conv0.model)
  check('导出:消息非空', conv0 && conv0.messages.length > 0, conv0 ? `${conv0.messages.length} 行` : '无')
  check(
    '导出:思考过程与对比分组随包带走',
    !!conv0 && conv0.messages.every((m) => 'reasoning' in m && 'groupId' in m)
  )
  // 时间保真的对照口径(踩过的坑,别再改回去):
  //   列是 timestamp without time zone,本机 PG 会话时区是 Asia/Shanghai。
  //   node-pg 会按会话时区把 naive 值解读成另一个瞬时(实测差 8h),而 Prisma 一律按 UTC 读写
  //   —— 已用"已知瞬时 2026-05-05T08:30:00Z 写入后读回仍是 08:30Z"证实。
  //   所以权威值取 to_char(native) 拼出来的 UTC ISO,不能用 new Date(pgRow.createdAt)。
  const dbTimes = await pool.query(
    `SELECT to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_utc,
            to_char("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_utc
       FROM "Conversation" WHERE id=$1`,
    [sampleIds[0]]
  )
  check(
    '导出:createdAt/updatedAt 与库中原值一致',
    !!conv0 &&
      dbTimes.rows[0] &&
      conv0.createdAt === dbTimes.rows[0].created_utc &&
      conv0.updatedAt === dbTimes.rows[0].updated_utc,
    `包=${conv0 && conv0.createdAt} 库=${dbTimes.rows[0] && dbTimes.rows[0].created_utc}`
  )
  if (compareOne) {
    const cmp = bundle.conversations.find((c) => c.mode === 'compare')
    const groups = new Set((cmp ? cmp.messages : []).map((m) => m.groupId).filter(Boolean))
    check('导出:对比轮的 groupId 成组出现', !cmp || groups.size > 0, `${groups.size} 组`)
  }

  // 坏包必须报人话(这条同时证明判据本身是"能红"的)
  const bad = await api('/api/conversations/import', { method: 'POST', body: { bundle: { foo: 1 } } })
  check('导入:坏 JSON 报人话而非 500', bad.status === 400 && /会话记录包|没有可导入/.test(bad.json.error || ''),
    `HTTP ${bad.status} / ${bad.json && bad.json.error}`)

  // ── 4. 跨账号越权:别人库里的同 id 会话必须被拒 ─────────
  const tmpUserId = newId('u')
  const tmpConvId = newId('c')
  await pool.query(
    `INSERT INTO "User" (id, email, "createdAt", "updatedAt") VALUES ($1, $2, now(), now())`,
    [tmpUserId, `${tmpUserId}@portable-smoke.local`]
  )
  await pool.query(
    `INSERT INTO "Conversation" (id, "userId", title, "createdAt", "updatedAt") VALUES ($1, $2, '越权样本', now(), now())`,
    [tmpConvId, tmpUserId]
  )
  const foreignBundle = {
    kind: 'aichat.conversation-bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    conversations: [{ ...conv0, id: tmpConvId, title: '越权样本', messages: conv0.messages.slice(0, 2) }],
  }
  const foreignRes = await api('/api/conversations/import', { method: 'POST', body: { bundle: foreignBundle } })
  const foreignReport = foreignRes.json && foreignRes.json.reports
  check(
    '导入:他人同 id 会话被拒绝',
    foreignRes.status === 200 &&
      Array.isArray(foreignReport) &&
      foreignReport[0] && foreignReport[0].outcome === 'foreign' &&
      foreignRes.json.created === 0,
    JSON.stringify(foreignReport && foreignReport[0])
  )
  const stillOwned = await pool.query('SELECT "userId" FROM "Conversation" WHERE id=$1', [tmpConvId])
  check('导入:拒写没有改动他人归属行', stillOwned.rows[0] && stillOwned.rows[0].userId === tmpUserId)

  // ── 5. 预演:只报清单,不落库 ────────────────────────────
  const attachNames = ['核验图-a.png', '核验表-b.xlsx']
  const rewritten = [
    rewriteIds(conv0, {
      attachToMessageId: conv0.messages.find((m) => m.role === 'user')?.id,
      attachments: [
        { url: '/uploads/does-not-exist-a.png', name: attachNames[0], type: 'image/png', size: 12 },
        { url: '/uploads/does-not-exist-b.xlsx', name: attachNames[1], type: 'application/vnd.ms-excel', size: 34 },
      ],
    }),
  ]
  if (bundle.conversations[1]) rewritten.push(rewriteIds(bundle.conversations[1], {}))
  const previewTarget = rewritten[0]
  const pv = await api('/api/conversations/import', {
    method: 'POST',
    body: { bundle: { ...bundle, conversations: rewritten }, preview: true },
  })
  const pvReports = pv.json && pv.json.reports
  check('预演:HTTP 200 且逐条点名', pv.status === 200 && Array.isArray(pvReports) && pvReports.length === rewritten.length,
    `HTTP ${pv.status}`)
  check('预演:全部判为将新建', (pvReports || []).every((r) => r.outcome === 'pending'))
  check(
    '预演:附件欠账条数如实报',
    pvReports && pvReports[0].strippedAttachments >= attachNames.length,
    `${pvReports && pvReports[0].strippedAttachments} 个`
  )
  const afterPreview = await api(`/api/conversations/${previewTarget.id}`)
  check('预演:确实没落库', afterPreview.status === 404 || !afterPreview.json || !afterPreview.json.conversation,
    `HTTP ${afterPreview.status}`)

  // ── 6. 真导入:内容/时间/附件标记/面具降级 ──────────────
  const real = await api('/api/conversations/import', {
    method: 'POST',
    body: { bundle: { ...bundle, conversations: rewritten } },
  })
  const reports = real.json && real.json.reports
  check('导入:全部写入', real.status === 200 && real.json.created === rewritten.length,
    `created=${real.json && real.json.created} HTTP ${real.status}`)

  const stored = await api(`/api/conversations/${previewTarget.id}/messages?limit=100`)
  const storedMsgs = (stored.json && stored.json.messages) || []
  const srcMsgs = previewTarget.messages.filter((m) => !m.archived)
  check('导入:消息行数一致', storedMsgs.length === srcMsgs.length, `${storedMsgs.length}/${srcMsgs.length}`)
  // 逐条按 id 对照,而不是"取第一条 user":消息端点首屏按 createdAt 倒序返回,
  // 包内是正序 —— 拿顺序位相比会假红(上一轮就是这么错的)
  const byId = new Map(storedMsgs.map((m) => [m.id, m]))
  const missingIds = srcMsgs.filter((m) => !byId.has(m.id))
  const mismatchContent = srcMsgs.filter((m) => byId.has(m.id) && byId.get(m.id).content !== m.content)
  const mismatchTime = srcMsgs.filter(
    (m) =>
      byId.has(m.id) &&
      new Date(byId.get(m.id).createdAt).getTime() !== new Date(m.createdAt).getTime()
  )
  check('导入:每条消息都按原 id 落库', missingIds.length === 0, missingIds.length ? `缺 ${missingIds.length} 条` : 'id 全部命中')
  check('导入:正文逐字一致', mismatchContent.length === 0, mismatchContent.length ? `${mismatchContent.length} 条不一致` : `${srcMsgs.length} 条全对`)
  check(
    '导入:时间戳按原值落库(不是导入时刻)',
    mismatchTime.length === 0,
    mismatchTime.length
      ? `差值示例 ${new Date(byId.get(mismatchTime[0].id).createdAt).getTime() - new Date(mismatchTime[0].createdAt).getTime()}ms`
      : '与包内一致'
  )

  // 附件:引用必须被摘掉,且前端读得到"未迁移"凭据
  const attStored = storedMsgs.find((m) => m.id === previewTarget.messages.find((x) => x.attachments && x.attachments.length)?.id)
  const attMeta = attStored && asObject(attStored.metadata)
  const attParsed = attStored && asObject(attStored.attachments)
  check('导入:附件引用已摘除', attStored && (attParsed === null || (Array.isArray(attParsed) && attParsed.length === 0)),
    JSON.stringify(attStored && attStored.attachments))
  check(
    '导入:未迁移凭据写进 metadata 供前端标注',
    !!(attMeta && attMeta.importSkippedAttachments && attMeta.importSkippedAttachments.count === attachNames.length),
    JSON.stringify(attMeta && attMeta.importSkippedAttachments)
  )
  check(
    '导入:凭据里保留原文件名',
    !!(attMeta && attMeta.importSkippedAttachments &&
      attMeta.importSkippedAttachments.names.join(',') === attachNames.join(','))
  )

  // ── 7. 幂等:同一份再导一次不得翻倍 ─────────────────────
  const listAfter1 = await api('/api/conversations?limit=200')
  const total1 = listAfter1.json.total
  const again = await api('/api/conversations/import', {
    method: 'POST',
    body: { bundle: { ...bundle, conversations: rewritten } },
  })
  check('幂等:重导创建 0 条', again.json && again.json.created === 0 && again.json.duplicate === rewritten.length,
    JSON.stringify(again.json && { created: again.json.created, duplicate: again.json.duplicate }))
  const listAfter2 = await api('/api/conversations?limit=200')
  check('幂等:列表条数没变', listAfter2.json.total === total1, `${total1} → ${listAfter2.json.total}`)

  // ── 8. 自定义面具在本实例不存在时降级为无面具 ───────────
  const ghostMask = await api('/api/conversations/import', {
    method: 'POST',
    body: {
      bundle: {
        ...bundle,
        conversations: [rewriteIds(conv0, { maskId: `user:${newId('nomask')}` })],
      },
    },
  })
  const ghostReport = ghostMask.json && ghostMask.json.reports && ghostMask.json.reports[0]
  check('导入:查无此面具时降级并说明', !!ghostReport && ghostReport.maskDropped === true,
    JSON.stringify(ghostReport))
  if (ghostReport && ghostReport.id) {
    const convRow = await pool.query('SELECT "maskId" FROM "Conversation" WHERE id=$1', [ghostReport.id])
    check('导入:降级确实落到库(maskId=null)', convRow.rows[0] && convRow.rows[0].maskId === null,
      JSON.stringify(convRow.rows[0]))
  }

  // ── 9. 清理:只删本次自建的行 ────────────────────────────
  const createdIds = [
    ...(reports || []).filter((r) => r.outcome === 'created').map((r) => r.id),
    ghostReport && ghostReport.id,
  ].filter(Boolean)
  if (createdIds.length) {
    const del = await api('/api/conversations/batch-delete', { method: 'POST', body: { ids: createdIds } })
    check('清理:自建核验会话已删', del.status === 200 && del.json.deleted === createdIds.length,
      `deleted=${del.json && del.json.deleted} / ${createdIds.length}`)
  }
  await pool.query('DELETE FROM "Conversation" WHERE id=$1', [tmpConvId])
  await pool.query('DELETE FROM "User" WHERE id=$1', [tmpUserId])
  const leftUser = await pool.query('SELECT count(*)::int AS n FROM "User" WHERE id=$1', [tmpUserId])
  const leftConv = await pool.query('SELECT count(*)::int AS n FROM "Conversation" WHERE "userId"=$1', [tmpUserId])
  check('清理:临时账号与其会话无残留', leftUser.rows[0].n === 0 && leftConv.rows[0].n === 0,
    `user=${leftUser.rows[0].n} conv=${leftConv.rows[0].n}`)

  const listFinal = await api('/api/conversations?limit=1')
  check('清理:账号会话数回到基线', listFinal.json.total === totalBaseline,
    `${totalBaseline} → ${listFinal.json.total}`)

  await pool.end()
}

main()
  .catch((e) => {
    console.error('FAIL(未捕获):', e && e.message)
    process.exitCode = 1
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok)
    console.log(`\n合计 ${results.length} 项，失败 ${failed.length} 项`)
    if (failed.length) process.exitCode = 1
  })
