// 临时脚本: 错题本闭环全链路验证
// 链路: 收题(save) → 题库列表(list) → 练习做错转错题(practice×2 验幂等) → 复习队列(queue) → 清理
// 用法: node scripts/tmp-verify-study-loop.cjs
// 登录态: 优先复用 .auth/admin.json 的 session-token;失效则走 CSRF + credentials 登录(SMOKE_* 凭据)
const fs = require('fs')

const BASE = 'http://localhost:3456'
const MARK = '【链路验证】' + Date.now()

// ---- env 加载(.env 先,.env.local 覆盖) ----
function loadEnv(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(m[1] in process.env)) process.env[m[1]] = v
  }
}
loadEnv('.env')
loadEnv('.env.local')

let failures = 0
function ok(cond, label, extra) {
  if (cond) {
    console.log('  ✓ ' + label)
  } else {
    failures++
    console.log('  ✗ ' + label + (extra ? ' — ' + JSON.stringify(extra).slice(0, 300) : ''))
  }
}

function cookiesFromStorage() {
  const state = JSON.parse(fs.readFileSync('.auth/admin.json', 'utf8'))
  return (state.cookies || [])
    .filter((c) => c.domain === 'localhost')
    .map((c) => c.name + '=' + c.value)
}

function pickCookie(setCookieList, name) {
  for (const line of setCookieList) {
    const pair = line.split(';')[0]
    if (pair.startsWith(name + '=')) return pair
  }
  return null
}

async function api(path, opts = {}, cookieJar = []) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { ...(opts.headers || {}), cookie: cookieJar.join('; ') },
  })
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  for (const name of ['authjs.csrf-token', 'authjs.session-token', 'authjs.callback-url']) {
    const c = pickCookie(setCookies, name)
    if (c && !cookieJar.some((x) => x.startsWith(name + '='))) cookieJar.push(c)
    else if (c) {
      const i = cookieJar.findIndex((x) => x.startsWith(name + '='))
      if (i >= 0) cookieJar[i] = c
    }
  }
  return res
}

async function login(cookieJar) {
  console.log('· session-token 失效,走 CSRF + credentials 登录')
  const csrfRes = await api('/api/auth/csrf', {}, cookieJar)
  const { csrfToken } = await csrfRes.json()
  const form = new URLSearchParams({
    csrfToken,
    email: process.env.SMOKE_ADMIN_ID || 'admin',
    password: process.env.SMOKE_ADMIN_PASSWORD || '',
  })
  const res = await api(
    '/api/auth/callback/credentials',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual',
    },
    cookieJar
  )
  const hasSession = cookieJar.some((c) => c.startsWith('authjs.session-token='))
  ok(hasSession || res.status < 400, '登录拿到 session', { status: res.status })
}

async function ensureAuth(cookieJar) {
  cookieJar.push(...cookiesFromStorage())
  let res = await api('/api/study/queue', {}, cookieJar)
  if (res.status === 401) {
    cookieJar.length = 0
    await login(cookieJar)
    res = await api('/api/study/queue', {}, cookieJar)
  }
  ok(res.status === 200, '鉴权可用(queue ' + res.status + ')')
  return res.status === 200
}

async function main() {
  const cookieJar = []
  if (!(await ensureAuth(cookieJar))) {
    console.log('无法建立登录态,中止')
    process.exit(1)
  }

  // ---- 1. 收进题库 ----
  console.log('\n[1] POST /api/study/quiz/save 收题入库')
  const saveRes = await api(
    '/api/study/quiz/save',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [
          {
            subject: 'math',
            kind: 'choice',
            stem: MARK + ' 1+1=?\nA. 1\nB. 2\nC. 3\nD. 4',
            answer: '答案:B\n设误说明:A 忘记进位',
            topic: '链路验证',
            difficulty: 'basic',
            source: 'ai_generated',
            sourceRef: '验证脚本',
          },
        ],
      }),
    },
    cookieJar
  )
  const saveData = await saveRes.json()
  ok(saveRes.status === 200 && saveData.saved === 1, '收题成功 saved=1', { status: saveRes.status, saveData })

  // ---- 2. 题库列表检索 ----
  console.log('\n[2] GET /api/study/quiz/list 检索测试题')
  const listRes = await api('/api/study/quiz/list?q=' + encodeURIComponent(MARK), {}, cookieJar)
  const listData = await listRes.json()
  const found = (listData.items || []).find((q) => q.stem.startsWith(MARK))
  ok(listRes.status === 200 && !!found, '列表命中测试题', { status: listRes.status, count: (listData.items || []).length })
  if (!found) process.exit(1)
  const questionId = found.id
  ok(found.answer.includes('答案:B'), '列表含 answer(前端折叠防剧透用)')

  // ---- 3. 练习做错 → 转错题 ----
  console.log('\n[3] POST /api/study/quiz/practice result=wrong')
  const p1 = await api(
    '/api/study/quiz/practice',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId, result: 'wrong', userAnswer: 'A. 1(故意答错)' }),
    },
    cookieJar
  )
  const p1Data = await p1.json()
  ok(p1.status === 201 && p1Data.noteId && p1Data.existing === false, '建错题卡成功 noteId=' + p1Data.noteId, { status: p1.status, p1Data })
  const noteId = p1Data.noteId

  // ---- 4. 幂等:同题再错不重复建卡 ----
  console.log('\n[4] POST practice 同题重复提交(幂等)')
  const p2 = await api(
    '/api/study/quiz/practice',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId, result: 'wrong', userAnswer: 'A. 1' }),
    },
    cookieJar
  )
  const p2Data = await p2.json()
  ok(p2.status === 200 && p2Data.existing === true && p2Data.noteId === noteId, '幂等返回既有 noteId', { status: p2.status, p2Data })

  // ---- 5. 复习队列出现新卡 ----
  console.log('\n[5] GET /api/study/queue 新卡入今日队列')
  const qRes = await api('/api/study/queue', {}, cookieJar)
  const qData = await qRes.json()
  const inQueue = (qData || []).find((n) => n.id === noteId)
  ok(qRes.status === 200 && !!inQueue, '队列包含新错题卡', { status: qRes.status, queueLen: (qData || []).length })
  ok(inQueue && inQueue.subject === 'math' && inQueue.sourceQuestionId === questionId, 'subject 继承 + 来源关联正确', inQueue)

  // ---- 6. result=right 仅 ok ----
  console.log('\n[6] POST practice result=right')
  const p3 = await api(
    '/api/study/quiz/practice',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId, result: 'right' }),
    },
    cookieJar
  )
  const p3Data = await p3.json()
  ok(p3.status === 200 && p3Data.ok === true, 'right 仅返回 ok', { status: p3.status, p3Data })

  return { questionId, noteId }
}

async function cleanup() {
  console.log('\n[cleanup] 清理测试数据(按【链路验证】前缀)')
  const { Client } = require('pg')
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    // 先删错题卡(来源关联)再删题,顺带清掉此前中断残留的验证数据
    const n = await client.query(
      'DELETE FROM "StudyNote" WHERE "sourceQuestionId" IN (SELECT id FROM "Question" WHERE "stem" LIKE $1)',
      ['【链路验证】%']
    )
    const q = await client.query('DELETE FROM "Question" WHERE "stem" LIKE $1', ['【链路验证】%'])
    console.log('  ✓ 删除 StudyNote=' + n.rowCount + ' Question=' + q.rowCount)
  } finally {
    await client.end()
  }
}

main()
  .then(async (ids) => {
    if (ids) await cleanup(ids).catch((e) => console.log('  ! 清理失败(手动删):', e.message))
    console.log('\n==== 结果: ' + (failures ? failures + ' 项失败' : '全部通过') + ' ====')
    process.exit(failures ? 1 : 0)
  })
  .catch((e) => {
    console.error('脚本异常:', e)
    process.exit(1)
  })
