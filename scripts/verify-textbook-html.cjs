/**
 * 课本 HTML 结构自动质检(转换器或 AI 兜底产出后、导入前跑)
 *
 * 用法: node scripts/verify-textbook-html.cjs <html路径>
 * 检查项:
 *   硬性(违例即 exit 1):
 *     - 禁用标签 h1/h5/h6/ul/ol/li/img(导入脚本会静默丢内容)
 *     - body 顶层包裹容器(会把整本书吞成一个 div)
 *     - cover 三字段缺失或嵌套标签(导入器取元数据会取空)
 *   报告项(供人工对照目录):
 *     - h2/h3/h4/栏目 div/段落/图注计数与占比、空图注、全文字符量、各章字数分布
 */
const fs = require('fs')

const ALLOWED_DIV_CLASSES = new Set([
  'cover', 'toc', 'example', 'exercise', 'think', 'explore',
  'reading', 'history', 'summary',
])

const file = process.argv[2]
if (!file || !fs.existsSync(file)) {
  console.error('用法: node scripts/verify-textbook-html.cjs <html路径>')
  process.exit(2)
}
const html = fs.readFileSync(file, 'utf-8')
const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, html])[1]

let hardFail = 0
const fail = (msg) => { console.error('  ✗ ' + msg); hardFail++ }

console.log(`质检: ${file}\n`)

// —— 硬性禁令 ——
for (const tag of ['h1', 'h5', 'h6', 'ul', 'ol', 'li', 'img']) {
  const n = (body.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length
  if (n) fail(`发现 ${n} 处 <${tag}>(导入脚本不识别,内容会丢)`)
}

// cover 元数据:三字段齐且为纯文本(与导入器 parseCover 同口径)。
// 捕获组必须包含最后一个字段的 </div>,否则字段正则找不到闭合 '<'(publisher 必踩)。
const coverBlock = (body.match(/<div class="cover">[\s\S]*?<\/div>\s*<\/div>/i) || [''])[0]
const coverM = body.match(/<div class="cover">([\s\S]*?<\/div>)\s*<\/div>/i)
if (!coverM) {
  fail('缺少 <div class="cover"> 元数据块(导入器取不到书名/册别/出版社)')
} else {
  for (const f of ['book-name', 'grade', 'publisher']) {
    const m = coverM[1].match(new RegExp(`class="${f}"[^>]*>([\\s\\S]*?)<`, 'i'))
    if (!m || !m[1].trim()) fail(`cover.${f} 缺失或为空`)
    else if (m[1].includes('<')) fail(`cover.${f} 内嵌套了标签(导入器会取空)`)
  }
}

// 包裹容器:div class 只允许 cover/toc/栏目/cover 内层字段;先剥掉 cover 块再扫
const bodyNoCover = coverBlock ? body.replace(coverBlock, '') : body
const divClasses = [...bodyNoCover.matchAll(/<div[^>]*class="([^"]*)"/gi)].map((m) => m[1])
const badClasses = [...new Set(divClasses.filter((c) => !ALLOWED_DIV_CLASSES.has(c)))]
if (badClasses.length) fail(`发现白名单之外的 div class: ${badClasses.join(', ')}`)

// —— 结构统计 ——
const count = (re) => (body.match(re) || []).length
const h2 = count(/<h2 class="chapter-title">/gi)
const h2plain = count(/<h2>(?!\s*<\/h2>)/gi)
const h3 = count(/<h3>/gi)
const h4 = count(/<h4>/gi)
const paras = count(/<p>/gi)
const figs = count(/<p>【图注:/g)
const emptyFigs = count(/【图注:\s*\(图略\)】/g)
const textLen = body.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length

console.log(`结构: h2单元 ${h2} + h2独立 ${h2plain} | h3课 ${h3} | h4小节 ${h4}`)
console.log(`正文: 段落 ${paras} | 图注 ${figs}${emptyFigs ? `(空图注 ${emptyFigs} ⚠)` : ''} | 正文约 ${textLen} 字符`)
const colLine = divClasses
  .filter((c) => !['cover', 'toc'].includes(c))
  .reduce((m, c) => ((m[c] = (m[c] || 0) + 1), m), {})
if (Object.keys(colLine).length) {
  console.log('栏目:', Object.entries(colLine).map(([k, v]) => `${k} ${v}`).join(' | '))
}

// 各章字数分布(粗分,供对照目录完整性)
const chapters = body.split(/<h2 class="chapter-title">/i).slice(1)
  .map((s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length)
if (chapters.length) {
  console.log(`各章字符量: ${chapters.join(', ')}`)
  const tiny = chapters.filter((n) => n < 800).length
  if (tiny) console.log(`  ⚠ ${tiny} 个章不足 800 字符,疑似转换丢内容,需对照 PDF 抽查`)
}

if (emptyFigs) console.log('⚠ 空图注需修复(图注文字被拆行丢弃)')
if (textLen < 50000) console.log(`⚠ 全文仅 ${textLen} 字符——整本教材通常 5 万字以上,疑转换不完整`)

console.log(hardFail ? `\n✗ ${hardFail} 项硬性检查未过,请修复后再导入` : '\n✓ 硬性检查全部通过,可导入')
process.exit(hardFail ? 1 : 0)
