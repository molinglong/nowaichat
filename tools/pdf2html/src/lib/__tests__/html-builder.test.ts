import { describe, expect, it } from 'vitest'
import { buildHtml } from '../html-builder'

describe('html-builder 产物', () => {
  it('生成自包含 HTML,特殊字符正确转义', () => {
    const html = buildHtml(
      [
        {
          pageNumber: 1,
          blocks: [{ type: 'paragraph', text: '<script>alert(1)</script> & 特殊' }],
          charCount: 10,
        },
      ],
      '测试 & 文档',
    )
    expect(html).toContain('<p>&lt;script&gt;')
    expect(html).toContain('<title>测试 &amp; 文档</title>')
    expect(html).toContain('data-page="1"')
    expect(html).not.toContain('<script>alert')
  })

  it('扫描页渲染占位提示,文档级警告进提示盒', () => {
    const html = buildHtml(
      [{ pageNumber: 2, blocks: [], charCount: 0, skipped: 'scanned' }],
      '扫描件',
      ['2 页为扫描/图片页,无法提取文本'],
    )
    expect(html).toContain('page-skipped')
    expect(html).toContain('warnings')
  })
})
