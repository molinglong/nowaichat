/**
 * 导入脚本(PDF 转换版课本)：页面流 HTML -> 学习知识库(KnowledgeDoc + KnowledgeChunk)
 *
 * 适用格式:PDF 转图片+文本层的单文件 HTML(与 import-knowledge-html.cjs 的
 * 结构化 h2/h3/h4 版不同),特征:
 *   - 正文按 <section class="page" data-page="N"> 分页,文本都在 <p> 里
 *   - 每页页脚 <p>印刷页码<br/>章节名</p> 提供章节定位
 *   - 目录页「名称/页码」行交替,含 单元/课/综合探究/框题 四类条目
 * 解析策略:
 *   - 页脚 (dataPage, printPage) 对 → 求众数偏移 offset = dataPage - printPage
 *   - 目录条目按印刷页码排序,每页按层级(单元/课/框)取 ≤printPage 的最后条目定归属
 *   - 栏目名行(可带 ◆◆◆ 前缀)转【栏目】内联前缀,页眉页脚/pagenum 剔除
 *   - 单块超 4000 字符按段落边界续拆(heading 加 ·续N)
 * 学科:书名含「思想政治/政治」自动识别为 politics(与 NOTE_SUBJECTS 对齐)
 *
 * 用法:node scripts/import-knowledge-page-html.cjs <html路径> [--user admin@qq.com]
 *       [--subject politics] [--title 覆盖书名] [--dry 仅解析统计不入库]
 * 幂等:同用户同名(title)资料重复导入时,先删旧再导。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const { Pool } = require('pg')

const SOFT_CHUNK_LIMIT = 4000

// —— 命令行参数 ——
function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) { args[key] = next; i++ } else { args[key] = true }
    } else {
      args._.push(a)
    }
  }
  return args
}

const args = parseArgs(process.argv)
const HTML_PATH = args._[0]
if (!HTML_PATH || !fs.existsSync(HTML_PATH)) {
  console.error('用法: node scripts/import-knowledge-page-html.cjs <html路径> [--user email] [--subject politics] [--title 覆盖书名] [--dry]')
  process.exit(1)
}
const USER_EMAIL = args.user || 'admin@qq.com'
const SUBJECT_OVERRIDE = args.subject
const DRY = !!args.dry

/** 按书名猜学科(与 NOTE_SUBJECTS 对齐) */
function guessSubject(text) {
  const map = [['数学', 'math'], ['语文', 'chinese'], ['英语', 'english'], ['物理', 'physics'], ['化学', 'chemistry'], ['生物', 'biology'], ['思想政治', 'politics'], ['政治', 'politics'], ['历史', 'other'], ['地理', 'other']]
  for (const [kw, sub] of map) if (text.includes(kw)) return sub
  return 'other'
}

// —— HTML → 纯文本 ——
const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&ldquo;': '“', '&rdquo;': '”' }

function htmlToText(html) {
  let s = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|section|figure|header)>/gi, '\n')
    .replace(/<(td|th)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  for (const [ent, ch] of Object.entries(ENTITIES)) s = s.split(ent).join(ch)
  return s
    .split('\n').map((l) => l.replace(/[ \t\u3000]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// —— 解析页面流 ——
function parsePages(html) {
  const pages = []
  for (const m of html.matchAll(/<section class="page" data-page="(\d+)">([\s\S]*?)<\/section>/g)) {
    const dataPage = parseInt(m[1], 10)
    const seg = m[2]
    const rawLines = htmlToText(seg).split('\n').map((l) => l.trim()).filter(Boolean)
    pages.push({ dataPage, rawLines })
  }
  return pages
}

// 栏目名(可带 ◆◆◆/◆ 前缀与冒号后缀)
const COLUMN_NAMES = ['阅读与思考', '相关链接', '专家点评', '探究与分享', '名言', '示例', '情境导入', '名句', '字词扫描', '单元活动']
const COLUMN_LABELS = { 阅读与思考: '【阅读与思考】', 相关链接: '【相关链接】', 专家点评: '【专家点评】', 探究与分享: '【探究与分享】', 名言: '【名言】', 示例: '【示例】', 情境导入: '【情境导入】', 名句: '【名句】', 字词扫描: '【字词扫描】', 单元活动: '【单元活动】' }

function columnLabel(line) {
  const t = line.replace(/^◆+\s*/, '').replace(/[:：]\s*$/, '').trim()
  return COLUMN_LABELS[t] || null
}

/** 从页行中分离页脚:htmlToText 后 <p>页码<br/>章节名</p> 变为相邻两行「N」+「章节名」 */
function splitFooter(rawLines) {
  for (let i = rawLines.length - 2; i >= Math.max(0, rawLines.length - 5); i--) {
    const a = rawLines[i], b = rawLines[i + 1]
    if (isNum(a) && /^(第[一二三四五六七八九十]+单元|第[一二三四五六七八九十]+课|目录)/.test(b)) {
      return { footer: { printPage: parseInt(a, 10), section: b.replace(/\s+/g, ' ').trim() }, lines: rawLines.slice(0, i) }
    }
  }
  return { footer: null, lines: rawLines }
}

// —— 目录解析 ——
function isNum(line) { return /^\d{1,3}$/.test(line) }

function classifyToc(line) {
  if (/第[一二三四五六七八九十]+单元/.test(line)) return 'unit'
  if (/综合探究/.test(line)) return 'synth'
  if (/第[一二三四五六七八九十]+课/.test(line)) return 'lesson'
  return 'item'
}

function parseToc(pages) {
  // 目录页:文本含「目 录/目录」标题的页及其后一页(目录常跨两页)
  const tocPages = []
  for (const p of pages) {
    if (p.rawLines.some((l) => /^目\s*录$/.test(l))) tocPages.push(p)
    else if (tocPages.length && tocPages[tocPages.length - 1].dataPage === p.dataPage - 1 && p.rawLines.length < 60) {
      // 目录后一页,仍以「数字/名称」行为主才继续
      const numLike = p.rawLines.filter((l) => isNum(l) || /单元|课|综合探究/.test(l)).length
      if (numLike >= p.rawLines.length * 0.4) tocPages.push(p)
    }
  }
  const entries = []
  if (!tocPages.length) return { entries, tocPages, tocStart }
  const tocStart = tocPages[0].dataPage
  const lines = tocPages.flatMap((p) => p.rawLines)
    .map((l) => l.replace(/^—\s*\d+\s*—/, '').trim()).filter(Boolean) // 目录页 pagenum 可能与条目连行,一并剥离
  // 名称缓冲合并:长条目(如综合探究)在目录里可能折行,连续名称行直到页码行才配对
  let buf = []
  const flushBuf = (page) => {
    if (!buf.length) return
    const name = buf.join('')
    buf = []
    if (!isNum(name) && !/^目\s*录$/.test(name)) entries.push({ level: classifyToc(name), name, printPage: page })
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+/g, ' ').trim()
    // 兼容两种目录格式:页码独立行(必修3/4)与页码在名称行尾(必修2)
    if (isNum(line)) { flushBuf(parseInt(line, 10)); continue }
    if (/^目\s*录$/.test(line)) { buf = []; continue }
    const tail = line.match(/^(.*\S)[ \u3000]+(\d{1,3})$/)
    if (tail) { buf.push(tail[1]); flushBuf(parseInt(tail[2], 10)); continue }
    buf.push(line)
  }
  // 页码非递减校验:乱序脏行丢弃
  const cleaned = []
  let last = 0
  for (const e of entries) {
    if (e.printPage >= last) { cleaned.push(e); last = e.printPage }
  }
  return { entries: cleaned, tocPages, tocStart }
}
function calibrateOffset(pages, entries, tocStart) {
  const deltas = {}
  for (const p of pages) {
    if (!p.footer) continue
    if (!/单元|课|目录/.test(p.footer.section)) continue
    if (p.footer.section === '目录') continue
    const d = p.dataPage - p.footer.printPage
    deltas[d] = (deltas[d] || 0) + 1
  }
  let best = null, bestN = 0
  for (const [d, n] of Object.entries(deltas)) if (n > bestN) { best = parseInt(d, 10); bestN = n }
  if (best != null) return best
  // 页脚校准失败(如必修2无章节页脚)→目录锚点兑底:正文页行与目录条目名全等处取众数偏移
  if (entries && entries.length) {
    const anchorDeltas = {}
    const nameMap = new Map(entries.map((e) => [e.name.replace(/[\s\u3000]+/g, ''), e]))
    for (const p of pages) {
      if (tocStart && p.dataPage >= tocStart && p.dataPage < tocStart + 4) continue // 跳过目录区
      for (const l of p.lines) {
        const e = nameMap.get(l.replace(/[\s\u3000]+/g, ''))
        if (e) {
          const d = p.dataPage - e.printPage
          anchorDeltas[d] = (anchorDeltas[d] || 0) + 1
        }
      }
    }
    for (const [d, n] of Object.entries(anchorDeltas)) if (n > bestN) { best = parseInt(d, 10); bestN = n }
  }
  return best
}

// —— 章节归属 ——
function buildAssigner(entries) {
  // 按层级分别取 ≤printPage 的最后条目;层级切换时清空下级(新课/新探究页不再挂上一框题)
  return (printPage) => {
    let unit = null, lesson = null, item = null
    for (const e of entries) {
      if (e.printPage > printPage) continue
      if (e.level === 'unit') { unit = e; lesson = null; item = null }
      else if (e.level === 'lesson' || e.level === 'synth') { lesson = e; item = null }
      else if (e.level === 'item') item = e
    }
    return { unit, lesson, item }
  }
}

// —— 切块 ——
const norm = (s) => s.replace(/[\s\u3000]+/g, '')

function buildChunks(pages, entries, offset, tocPages, tocStart) {
  const assign = buildAssigner(entries)
  const chunks = []
  let ctx = null

  const flush = () => {
    if (!ctx) return
    const content = ctx.parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    if (content) chunks.push({ chapter: ctx.chapter, section: ctx.section, subsection: ctx.subsection, heading: ctx.heading, content })
    ctx = null
  }

  const ensureCtx = (a, forceHeading) => {
    const chapter = a.unit ? a.unit.name : null
    const section = a.lesson ? a.lesson.name : null
    const subsection = a.item ? a.item.name : null
    if (!ctx || ctx.chapter !== chapter || ctx.section !== section || ctx.subsection !== subsection) {
      flush()
      ctx = { chapter, section, subsection, heading: subsection || section || chapter || '前言', parts: [] }
      if (forceHeading) ctx.heading = forceHeading
    } else if (forceHeading && ctx.parts.length === 0) {
      ctx.heading = forceHeading
    }
  }

  let prevA = null
  for (const p of pages) {
    // 目录页本身与封面/版权区(printPage < 1)不入切块
    const printPage = p.dataPage - offset
    if (printPage < 1 || (tocStart && p.dataPage >= tocStart && p.dataPage < tocStart + tocPages.length)) { prevA = null; continue }
    const a = assign(printPage)
    // 单元扉页/课首页(无框题或页码即单元起始):heading 兜底层级名
    const isUnitStart = a.unit && printPage === a.unit.printPage
    const isLessonStart = a.lesson && printPage === a.lesson.printPage
    let lines = p.lines
    // pagenum 前缀剥离(有的页「— N —」与标题同行);再剔除页眉行(「普通高中教科书…」)
    lines = lines.map((l) => l.replace(/^—\s*\d+\s*—/, '').trim()).filter(Boolean)
    lines = lines.filter((l) => !/^普通高中教科书/.test(l) || /单元|课/.test(l.slice(0, 12)))
    const parts = []
    for (const line of lines) {
      const col = columnLabel(line)
      if (col) { parts.push(col); continue }
      // 与当前层级名重复的标题行剔除(框题/课名/单元名在页内重现;去空白比较兼容目录折行名)
      if (a.item && norm(line) === norm(a.item.name)) continue
      if (isLessonStart && a.lesson && norm(line) === norm(a.lesson.name)) continue
      if (isUnitStart && a.unit && norm(line) === norm(a.unit.name)) continue
      // 中文断行拼接:PDF 文本层把词跨行切断(如「经济制/度」),行尾行首均为中文(或中文标点)时拼回一行,保检索连续命中
      const prev = parts[parts.length - 1]
      if (
        prev &&
        /[\u4e00-\u9fff，、；：]/.test(prev.slice(-1)) &&
        /^[\u4e00-\u9fff，。、；：！？””）】]/.test(line)
      ) {
        parts[parts.length - 1] = prev + line
      } else {
        parts.push(line)
      }
    }
    if (!parts.length) { prevA = a; continue }
    let forceHeading = null
    if (isUnitStart && !a.item && !a.lesson) forceHeading = `${a.unit.name}（扉页）`
    ensureCtx(a, forceHeading)
    ctx.parts.push(parts.join('\n'))
    prevA = a
  }
  flush()
  return chunks
}

/** 单块超限按段落边界续拆 */
function splitOversized(chunks) {
  const out = []
  for (const c of chunks) {
    if (c.content.length <= SOFT_CHUNK_LIMIT) { out.push(c); continue }
    const paras = c.content.split(/\n\n+/)
    let buf = [], part = 1
    const flushBuf = () => {
      if (!buf.length) return
      out.push({ ...c, heading: part === 1 ? c.heading : `${c.heading} ·续${part}`, content: buf.join('\n\n') })
      part++
      buf = []
    }
    for (const p of paras) {
      if (buf.join('\n\n').length + p.length > SOFT_CHUNK_LIMIT && buf.length) flushBuf()
      buf.push(p)
    }
    flushBuf()
  }
  return out
}

// —— 主流程 ——
async function main() {
  const html = fs.readFileSync(HTML_PATH, 'utf-8')
  const pages = parsePages(html)
  if (!pages.length) { console.error('未解析出任何 page section,请确认是 PDF 转换版 HTML'); process.exit(1) }
  for (const p of pages) {
    const r = splitFooter(p.rawLines)
    p.footer = r.footer
    p.lines = r.lines
  }
  const { entries, tocPages, tocStart } = parseToc(pages)
  const offset = calibrateOffset(pages, entries, tocStart)
  console.log(`页面: ${pages.length} | 目录条目: ${entries.length}(目录页 ${tocPages.map((p) => p.dataPage).join(',') || '无'}) | 偏移: dataPage - printPage = ${offset}`)

  // 书名:book-header h1「模块名 · 册别」+ 学段科目前缀
  const h1 = (html.match(/<h1>([\s\S]*?)<\/h1>/i) || [])[1] || ''
  const h1Text = htmlToText(h1).replace(/\s+/g, ' ').trim()
  const title = (typeof args.title === 'string' && args.title) || `思想政治 ${h1Text.split('·').map((s) => s.trim()).filter(Boolean).join(' ')}`.trim()
  const subject = SUBJECT_OVERRIDE || guessSubject(title)

  if (!entries.length || offset == null) {
    console.error('目录或偏移校准失败,中止(entries=' + entries.length + ', offset=' + offset + ')')
    process.exit(1)
  }
  const byLevel = {}
  for (const e of entries) byLevel[e.level] = (byLevel[e.level] || 0) + 1
  console.log('目录层级:', JSON.stringify(byLevel), '| 首条:', entries[0].name, '| 末条:', entries[entries.length - 1].name)
  const synths = entries.filter((e) => e.level === 'synth')
  if (synths.length) console.log('综合探究条目:', synths.map((e) => `${e.name}@${e.printPage}`).join(' | '))

  const chunks = splitOversized(buildChunks(pages, entries, offset, tocPages, tocStart))
  if (!chunks.length) { console.error('未解析出任何切块'); process.exit(1) }
  const charCount = chunks.reduce((n, c) => n + c.content.length, 0)

  const byChapter = {}
  for (const c of chunks) {
    const k = c.chapter || '(无章)'
    byChapter[k] = (byChapter[k] || 0) + 1
  }
  console.log(`\n${DRY ? '[DRY] ' : ''}解析结果: ${title} [${subject}]`)
  console.log(`切块: ${chunks.length} 块 / 共 ${charCount} 字符`)
  for (const [k, v] of Object.entries(byChapter)) console.log(`  ${k}: ${v} 块`)
  console.log('\n示例切块:')
  for (const c of [chunks[0], chunks[Math.floor(chunks.length / 2)], chunks[chunks.length - 1]]) {
    console.log(`  [${c.chapter} > ${c.section} > ${c.heading}] ${c.content.slice(0, 80).replace(/\n/g, ' ')}…`)
  }
  // 无章节归属的块告警
  const orphan = chunks.filter((c) => !c.chapter || !c.section)
  if (orphan.length) console.log(`\n⚠ 无单元/课归属的块: ${orphan.length} 个 → ${orphan.slice(0, 5).map((c) => c.heading).join(' | ')}`)
  if (DRY) return

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const u = await pool.query(`SELECT id FROM "User" WHERE email = $1`, [USER_EMAIL])
    if (!u.rowCount) { console.error(`用户不存在: ${USER_EMAIL}`); process.exit(1) }
    const userId = u.rows[0].id

    const del = await pool.query(`DELETE FROM "KnowledgeDoc" WHERE "userId" = $1 AND title = $2`, [userId, title])
    if (del.rowCount) console.log(`已删除旧资料 "${title}" x${del.rowCount}(含切块)`)

    const docId = crypto.randomUUID()
    await pool.query(
      `INSERT INTO "KnowledgeDoc" (id, "userId", title, subject, publisher, grade, "charCount", "chunkCount") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [docId, userId, title, subject, '人民教育出版社', h1Text.split('·')[1] ? h1Text.split('·')[1].trim() : null, charCount, chunks.length]
    )
    const COLS = 10
    const values = []
    const params = []
    chunks.forEach((c, i) => {
      const b = i * COLS
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`)
      params.push(crypto.randomUUID(), docId, userId, c.chapter, c.section, c.subsection, c.heading, c.content, i, c.content.length)
    })
    await pool.query(
      `INSERT INTO "KnowledgeChunk" (id, "docId", "userId", chapter, section, subsection, heading, content, "sortOrder", "charCount") VALUES ${values.join(',')}`,
      params
    )
    console.log(`\n导入完成: ${title} [${subject}] 归属用户: ${USER_EMAIL}`)
  } finally {
    await pool.end()
  }
}

main().catch((e) => { console.error('FAIL:', e.message); process.exitCode = 1 })
