/**
 * 产物层:PageResult[] → 单文件自包含 HTML(内嵌极简中文阅读 CSS)。
 * 无脚本、无外链,可直接下载保存或离线打开。
 */
import type { Block, PageResult } from '../types'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case 'title':
      return `<h1 class="doc-title">${escapeHtml(block.text)}</h1>`
    case 'heading':
      // title 占用 h1,heading 整体降一级,保证层级不冲突
      return `<h${block.level + 1}>${escapeHtml(block.text)}</h${block.level + 1}>`
    case 'paragraph':
      return `<p>${escapeHtml(block.text)}</p>`
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul'
      const items = block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')
      return `<${tag}>${items}</${tag}>`
    }
  }
}

function renderPage(page: PageResult): string {
  const head = `<div class="page-no">第 ${page.pageNumber} 页</div>`
  if (page.skipped === 'scanned') {
    return `<section class="page" data-page="${page.pageNumber}">${head}<div class="page-skipped">本页为扫描/图片页,没有可提取的文字。</div></section>`
  }
  const body = page.blocks.map(renderBlock).join('\n')
  return `<section class="page" data-page="${page.pageNumber}">${head}${body}</section>`
}

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 760px; padding: 40px 24px 64px;
    font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
    font-size: 16px; line-height: 1.85; color: #26282b; background: #ffffff; }
  .page { padding: 8px 0 28px; border-bottom: 1px solid #e6e7ea; }
  .page:last-child { border-bottom: none; }
  .page-no { font-size: 12px; color: #a2a6ad; margin-bottom: 14px; }
  .doc-title { font-size: 24px; line-height: 1.5; text-align: center; margin: 8px 0 28px; }
  h2, h3, h4 { line-height: 1.5; margin: 1.6em 0 0.7em; }
  p { margin: 0 0 1em; text-align: justify; }
  ul, ol { margin: 0 0 1em; padding-left: 1.8em; }
  li { margin-bottom: 0.4em; }
  .page-skipped { color: #a2a6ad; font-size: 14px; padding: 16px;
    border: 1px dashed #d8dadf; border-radius: 8px; }
  .warnings { background: #f6f7f8; border: 1px solid #e6e7ea; border-radius: 8px;
    padding: 12px 16px; margin-bottom: 24px; font-size: 13px; color: #6b7075; }
  .warnings div { margin: 2px 0 0; }
`

export function buildHtml(pages: PageResult[], title: string, warnings: string[] = []): string {
  const body = pages.map(renderPage).join('\n')
  const warnBox = warnings.length
    ? `<div class="warnings"><strong>转换提示</strong>${warnings
        .map((w) => `<div>${escapeHtml(w)}</div>`)
        .join('')}</div>`
    : ''
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${warnBox}
${body}
</body>
</html>`
}
