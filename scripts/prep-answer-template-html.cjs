/**
 * 答题模板 HTML 预转换：豆包导出的「答题模板」类 HTML -> import-knowledge-html.cjs 标准结构
 *
 * 源结构（豆包 AI 生成的模板文件，与课本导出结构不同）：
 *   h1 专题 / h2 节 / h3 设问点·典例分析 / h4 常见问法 /
 *   div.template-card（内部 h4 答题模板N）/ div.highlight-tip / div.example-box
 * 目标结构（课本导入器可直接吃，能保留全部正文）：
 *   h2.chapter-title(专题) / h3(节) / h4(设问点·栏目 / 答题模板N) / div(正文)
 *
 * 关键转换：
 *   - 顶层 <ol> 列表（导入器只识别 div/p 包裹的正文，裸列表会丢）统一包成 <div>
 *   - ol/ul 补序号（有序列表编号由浏览器渲染，纯文本化时必须补「1. 」）
 *   - 每个 .template-card 提升为独立 h4 块（标题即「答题模板N …」，正文首行再带
 *     【答题模板N】前缀），保证：① 每块 ≤800 字（检索返回截断上限）② coarse 检索
 *     命中「答题模板」关键词
 *
 * 用法：node scripts/prep-answer-template-html.cjs <源html> [输出html]
 *   默认输出：同目录 <名字>-kb.html
 * 之后：node scripts/import-knowledge-html.cjs <输出html> --subject politics --title "…"
 */
const fs = require('fs')

const SRC = process.argv[2]
const OUT = process.argv[3] || (SRC ? SRC.replace(/\.html?$/i, '-kb.html') : '')
if (!SRC || !fs.existsSync(SRC)) {
  console.error('用法: node scripts/prep-answer-template-html.cjs <源html> [输出html]')
  process.exit(1)
}

const raw = fs.readFileSync(SRC, 'utf-8')
const body = rebalanceDivs((raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, raw])[1])
const srcTitle = ((raw.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').trim()

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&ldquo;': '“', '&rdquo;': '”' }

/** ol/ul 列表项补序号(浏览器自动编号,纯文本化时补齐) */
function numberLists(html) {
  return html
    .replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
      let n = 0
      return inner.replace(/<li\b[^>]*>/gi, () => `<li>${++n}. `)
    })
    .replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => inner.replace(/<li\b[^>]*>/gi, '<li>· '))
}

function htmlToText(html) {
  let s = numberLists(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, '\n')
    .replace(/<(td|th)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  for (const [ent, ch] of Object.entries(ENTITIES)) s = s.split(ent).join(ch)
  return s
    .split('\n').map((l) => l.replace(/[ \t\u3000]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 源 body 顶层元素扫描（div 平衡匹配防嵌套截断；裸文本段落收为 loose） */
function tokenize(bodyHtml) {
  const tokens = []
  const re = /<(h1|h2|h3|h4)([^>]*)>([\s\S]*?)<\/\1>|<div([^>]*)>/gi
  let m, last = 0
  const pushLoose = (seg) => {
    const t = htmlToText(seg)
    if (t) tokens.push({ type: 'loose', text: t })
  }
  while ((m = re.exec(bodyHtml))) {
    pushLoose(bodyHtml.slice(last, m.index))
    if (m[1]) {
      tokens.push({ type: m[1].toLowerCase(), inner: m[3] })
      last = re.lastIndex
      continue
    }
    const start = m.index
    let depth = 0, end = -1
    const tagRe = /<\/?div\b[^>]*>/g
    tagRe.lastIndex = start
    let t
    while ((t = tagRe.exec(bodyHtml))) {
      depth += t[0].startsWith('</div') ? -1 : 1
      if (depth === 0) { end = tagRe.lastIndex; break }
    }
    if (end === -1) end = bodyHtml.length
    const divHtml = bodyHtml.slice(start, end)
    const cls = (divHtml.match(/^<div[^>]*class="([^"]*)"/i) || [])[1] || ''
    const inner = divHtml.replace(/^<div[^>]*>/, '').replace(/<\/div>\s*$/, '')
    tokens.push({ type: 'div', cls, inner })
    re.lastIndex = end
    last = end
  }
  pushLoose(bodyHtml.slice(last))
  return tokens
}

/** AI 生成 HTML 常见漏闭合修复:① 章节标题 h1/h2/h3 出现在未闭合 div 内 ② div 关闭时
 *  列表(ol/ul)仍开放。在边界处补插缺失的 </ol>/</div>——模板块 div 只应包裹 h4 正文,
 *  章节级标题必属顶层,列表不可跨出 div 边界;不修则平衡扫描把后续整段文档吞进一个
 *  div(h2/h3 降级为正文、节结构丢失),列表项丢失序号。 */
function rebalanceDivs(html) {
  const re = /<\/?div\b[^>]*>|<(h1|h2|h3)\b[^>]*>|<\/?(?:ol|ul)\b[^>]*>/gi
  const lists = []
  const closeLists = () => {
    const n = lists.length
    const s = lists.splice(0).reverse().map((t) => `</${t}>`).join('')
    return { n, s }
  }
  let depth = 0, fixed = 0, last = 0, out = '', m
  while ((m = re.exec(html))) {
    const tag = m[0]
    if (tag.startsWith('</div')) {
      if (lists.length) { // 列表不可跨出 div 边界
        const { n, s } = closeLists()
        out += html.slice(last, m.index) + s
        fixed += n
        last = m.index
      }
      if (depth > 0) depth--
      continue
    }
    if (tag.startsWith('<div')) { depth++; continue }
    const lm = tag.match(/^<(ol|ul)\b/i)
    if (lm) { lists.push(lm[1].toLowerCase()); continue }
    if (/^<\/(ol|ul)\b/i.test(tag)) { if (lists.length) lists.pop(); continue }
    if (depth > 0 || lists.length) { // 章节标题边界:强制闭合
      const { n, s } = closeLists()
      out += html.slice(last, m.index) + s + '</div>'.repeat(depth)
      fixed += n + depth
      depth = 0
      last = m.index
    }
  }
  if (depth > 0 || lists.length) {
    const { n, s } = closeLists()
    out += html.slice(last) + s + '</div>'.repeat(depth)
    fixed += n + depth
  } else out += html.slice(last)
  if (fixed) console.warn(`[warn] 源 HTML 标签不平衡:已补插 ${fixed} 个闭合标签`)
  return out
}

const out = []
let h3ctx = ''
let stats = { chapter: 0, section: 0, question: 0, template: 0, tip: 0, example: 0, other: 0 }

for (const tk of tokenize(body)) {
  if (tk.type === 'h1') {
    out.push(`<h2 class="chapter-title">${htmlToText(tk.inner)}</h2>`)
    stats.chapter++
    continue
  }
  if (tk.type === 'h2') {
    out.push(`<h3>${htmlToText(tk.inner)}</h3>`)
    h3ctx = ''
    stats.section++
    continue
  }
  if (tk.type === 'h3') {
    h3ctx = htmlToText(tk.inner)
    out.push(`<h4>${h3ctx}</h4>`)
    stats.question++
    continue
  }
  if (tk.type === 'h4') {
    const t = htmlToText(tk.inner)
    out.push(`<h4>${h3ctx ? `${h3ctx} · ${t}` : t}</h4>`)
    stats.question++
    continue
  }
  if (tk.type === 'div') {
    if (/template-card/i.test(tk.cls)) {
      const mt = tk.inner.match(/^\s*<h4[^>]*>([\s\S]*?)<\/h4>/i)
      const title = mt ? htmlToText(mt[1]) : '答题模板'
      const rest = mt ? tk.inner.slice(mt[0].length) : tk.inner
      const lm = title.match(/^(答题模板\s*\d+)\s*(.*)$/)
      const label = lm ? lm[1] : '答题模板'
      const name = lm ? lm[2] : title
      out.push(`<h4>${title}</h4>`)
      out.push(`<div>【${label}】${name}\n${htmlToText(rest)}</div>`)
      stats.template++
      continue
    }
    if (/highlight-tip/i.test(tk.cls)) {
      const mt = tk.inner.match(/^\s*<h4[^>]*>([\s\S]*?)<\/h4>/i)
      const title = mt ? htmlToText(mt[1]) : '提示'
      const rest = mt ? tk.inner.slice(mt[0].length) : tk.inner
      out.push(`<h4>${h3ctx ? `${h3ctx} · ${title}` : title}</h4>`)
      out.push(`<div>${htmlToText(rest)}</div>`)
      stats.tip++
      continue
    }
    if (/example-box/i.test(tk.cls)) {
      const tt = (tk.inner.match(/<div class="title">([\s\S]*?)<\/div>/i) || [])[1]
      const titleText = tt ? htmlToText(tt) : '典例'
      const rest = tk.inner.replace(/<div class="title">[\s\S]*?<\/div>/i, '')
      const idx1 = rest.search(/<h4[^>]*>/i)
      const head = idx1 >= 0 ? rest.slice(0, idx1) : rest
      let cursor = idx1 >= 0 ? rest.slice(idx1) : ''
      out.push(`<h4>典例分析 · 材料</h4>`)
      out.push(`<div>【${titleText}】\n${htmlToText(head)}</div>`)
      while (cursor) {
        const mHead = cursor.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i)
        if (!mHead) break
        const name = htmlToText(mHead[1])
        const after = cursor.slice(mHead.index + mHead[0].length)
        const nextIdx = after.search(/<h4[^>]*>/i)
        const segHtml = nextIdx >= 0 ? after.slice(0, nextIdx) : after
        out.push(`<h4>典例分析 · ${name}</h4>`)
        out.push(`<div>${htmlToText(segHtml)}</div>`)
        cursor = nextIdx >= 0 ? after.slice(nextIdx) : ''
      }
      stats.example++
      continue
    }
    // 裸 div 内嵌答题模板(无 class 的导出变体):按 h4 边界拆为标准模板块
    if (/<h4[^>]*>\s*答题模板\s*\d+/.test(tk.inner)) {
      let cursor = tk.inner
      const preIdx = cursor.search(/<h4[^>]*>/i)
      if (preIdx > 0) {
        const t = htmlToText(cursor.slice(0, preIdx))
        if (t) out.push(`<div>${t}</div>`)
      }
      while (cursor) {
        const mHead = cursor.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i)
        if (!mHead) break
        const title = htmlToText(mHead[1])
        const after = cursor.slice(mHead.index + mHead[0].length)
        const nextIdx = after.search(/<h4[^>]*>/i)
        const segHtml = nextIdx >= 0 ? after.slice(0, nextIdx) : after
        const lm = title.match(/^(答题模板\s*\d+)\s*(.*)$/)
        out.push(`<h4>${title}</h4>`)
        out.push(lm ? `<div>【${lm[1]}】${lm[2]}\n${htmlToText(segHtml)}</div>` : `<div>${htmlToText(segHtml)}</div>`)
        stats.template++
        cursor = nextIdx >= 0 ? after.slice(nextIdx) : ''
      }
      continue
    }
    out.push(`<div>${htmlToText(tk.inner)}</div>`)
    stats.other++
    continue
  }
  if (tk.type === 'loose') {
    out.push(`<div>${tk.text}</div>`)
    stats.other++
  }
}

const html = `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<title>${srcTitle}</title>\n</head>\n<body>\n\n${out.join('\n\n')}\n\n</body>\n</html>\n`
fs.writeFileSync(OUT, html, 'utf-8')

console.log(`已生成: ${OUT}`)
console.log(`源标题: ${srcTitle}`)
console.log(`统计: 专题x${stats.chapter} 节x${stats.section} 设问点/栏目x${stats.question} 答题模板x${stats.template} 提示x${stats.tip} 典例x${stats.example} 其他x${stats.other}`)
console.log('标题清单:')
for (const s of out) {
  if (s.startsWith('<h')) console.log(`  ${s.replace(/<[^>]+>/g, '')}`)
}
