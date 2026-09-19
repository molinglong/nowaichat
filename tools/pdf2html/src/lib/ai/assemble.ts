/**
 * AI 片段组装:逐页 HTML 片段 → 单文件成品 HTML。
 * 样式与结构对齐豆包参照标准(语义卡片 + MathJax 公式)。
 * 注:不引 polyfill.io(该域名 2024 年已被收购投毒,现代浏览器无需它)。
 */

export interface AiFragment {
  page: number
  html: string
}

/** 模型偶尔无视约定输出 ```html 围栏或整页骨架,统一清洗为 body 片段 */
export function sanitizeFragment(raw: string): string {
  let html = raw.trim()
  // 剥 markdown 代码围栏
  html = html.replace(/^```(?:html)?\s*\n?/i, '').replace(/```\s*$/, '')
  // 若输出整页骨架,取 <body> 内部
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (bodyMatch) html = bodyMatch[1]
  html = html
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .trim()
  return html.replace(/\n{3,}/g, '\n\n')
}

/** 从片段中提取标题(h1/h2 优先),失败返回空串 */
export function extractTitleFromFragments(fragments: AiFragment[]): string {
  for (const frag of fragments) {
    const m = frag.html.match(/<(?:h1|h2)[^>]*>([\s\S]*?)<\/(?:h1|h2)>/i)
    if (m) {
      const text = m[1]
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (text) return text.slice(0, 80)
    }
  }
  return ''
}

export const AI_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { max-width: 900px; margin: 30px auto; padding: 0 20px; font-family: "Microsoft YaHei", "SimSun", sans-serif; line-height: 1.8; color: #333; }
.cover { text-align: center; padding: 50px 0; border-bottom: 1px solid #eee; margin-bottom: 30px; }
.cover h1 { font-size: 32px; margin-bottom: 15px; }
.cover .book-name { font-size: 36px; margin: 10px 0; font-weight: bold; }
.cover .grade { font-size: 20px; margin: 10px 0; }
.cover .publisher { font-size: 18px; margin-top: 30px; }
.copyright-info { font-size: 14px; text-align: center; margin-bottom: 30px; color: #666; line-height: 2; }
.copyright-info p, .copyright-info .no-indent { text-indent: 0; }
h2 { font-size: 24px; margin: 30px 0 15px; color: #222; border-bottom: 2px solid #e0e0e0; padding-bottom: 5px; }
h3 { font-size: 20px; margin: 25px 0 12px; color: #333; }
h4 { font-size: 17px; margin: 20px 0 10px; }
p { text-indent: 2em; margin-bottom: 10px; }
.no-indent { text-indent: 0; }
p.note { text-indent: 0; font-size: 13px; color: #777; margin: 4px 0 12px; }
table { width: 100%; border-collapse: collapse; margin: 15px 0; text-indent: 0; }
table td, table th { border: 1px solid #d0d0d0; padding: 8px 12px; vertical-align: middle; }
.chapter-title { text-align: center; font-size: 28px; margin: 40px 0 20px; border: none; }
.section-title { font-size: 22px; margin: 30px 0 15px; }
.formula { text-align: center; margin: 10px 0; text-indent: 0; }
.figure { margin: 15px 0; text-align: center; text-indent: 0; border: 1px dashed #d9d9d9; padding: 14px 10px; background: #fafafa; border-radius: 4px; }
.figure-caption { text-indent: 0; font-size: 13px; color: #777; }
.example, .exercise, .think, .explore, .reading, .history, .summary {
  margin: 15px 0; padding: 10px 15px;
}
.example p, .exercise p, .think p, .explore p, .reading p, .history p, .summary p { text-indent: 2em; margin-bottom: 10px; }
.example { background-color: #f8f9fa; border-left: 4px solid #4a90e2; }
.exercise { background-color: #f0f7f0; border-left: 4px solid #5cb85c; }
.think { background-color: #fcf8e3; border-left: 4px solid #f0ad4e; }
.explore { background-color: #f0f0fa; border-left: 4px solid #7968b0; }
.reading { background-color: #eef5f9; border-left: 4px solid #31708f; }
.history { background-color: #f5f0f5; border-left: 4px solid #926aa6; }
.summary { background-color: #f5f5f5; border-radius: 4px; padding: 15px; }
.toc { margin: 20px 0; }
.toc ul { list-style: none; padding-left: 0; }
.toc li { margin: 5px 0; padding-left: 20px; position: relative; }
.toc li::before { content: "\\00B7"; position: absolute; left: 5px; color: #666; }
.toc .level2 { padding-left: 40px; font-size: 15px; }
.warnings { margin: 20px 0; padding: 12px 15px; background: #fff7e6; border-left: 4px solid #e6a23c; font-size: 14px; color: #8c5a00; }
.warnings ul { margin: 6px 0 0 18px; }
`.trim()

/** 组装单文件成品(含 MathJax CDN) */
export function assembleAiHtml(fragments: AiFragment[], fallbackTitle: string, warnings: string[]): string {
  const body = fragments
    .map((f) => `\n<!-- ===== 第 ${f.page} 页 ===== -->\n${sanitizeFragment(f.html)}`)
    .join('\n')
  const title = extractTitleFromFragments(fragments) || fallbackTitle
  const warningBox =
    warnings.length > 0
      ? `<div class="warnings"><strong>转换提示</strong><ul>${warnings
          .map((w) => `<li>${escapeHtml(w)}</li>`)
          .join('')}</ul></div>`
      : ''
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<script>window.MathJax = { tex: { inlineMath: [['\\\\(', '\\\\)']], displayMath: [['\\\\[', '\\\\]']] } };</script>
<script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-mml-chtml.js" crossorigin="anonymous"></script>
<!-- 注:MathJax 固定 3.2.2;离线使用请自行替换为本地文件 -->
<style>
${AI_CSS}
</style>
</head>
<body>
${warningBox}
${body}
<!-- 内容由 AI 辅助转录(本地 pdf2html 工具),请核对后使用 -->
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
