import { describe, expect, it } from 'vitest'
import { assembleAiHtml, extractTitleFromFragments, sanitizeFragment } from '../assemble'
import { buildPageInstruction, AI_SYSTEM_PROMPT } from '../prompt'
import { parsePageRange } from '../settings'

describe('sanitizeFragment', () => {
  it('剥离 markdown 代码围栏', () => {
    const raw = '```html\n<p>例1</p>\n```'
    expect(sanitizeFragment(raw)).toBe('<p>例1</p>')
  })

  it('整页骨架取 body 内部并去掉 head/script', () => {
    const raw =
      '<!DOCTYPE html><html><head><style>p{}</style><script>evil()</script></head><body><p class="formula">\\[x\\]</p></body></html>'
    const out = sanitizeFragment(raw)
    expect(out).toContain('<p class="formula">')
    expect(out).not.toContain('evil')
    expect(out).not.toContain('<body')
    expect(out).not.toContain('<style>')
  })

  it('保留 LaTeX 反斜杠不被转义破坏', () => {
    const out = sanitizeFragment('<p>\\(\\frac{1}{2}\\)</p>')
    expect(out).toContain('\\frac{1}{2}')
  })
})

describe('extractTitleFromFragments', () => {
  it('优先取第一个 h1/h2 标题文本', () => {
    const frags = [
      { page: 1, html: '<div class="cover"><h1>义务教育教科书</h1></div>' },
      { page: 2, html: '<h2 class="chapter-title">第一章 有理数</h2>' },
    ]
    expect(extractTitleFromFragments(frags)).toBe('义务教育教科书')
  })

  it('无标题返回空串', () => {
    expect(extractTitleFromFragments([{ page: 1, html: '<p>正文</p>' }])).toBe('')
  })
})

describe('assembleAiHtml', () => {
  const frags = [
    { page: 1, html: '<h2 class="chapter-title">第一章 有理数</h2>' },
    { page: 2, html: '<p>零上3摄氏度用3℃表示</p>' },
  ]

  it('包含 MathJax 脚本、逐页注释与标题', () => {
    const html = assembleAiHtml(frags, '教材.pdf', [])
    expect(html).toContain('mathjax@3.2.2')
    expect(html).toContain('<!-- ===== 第 1 页 ===== -->')
    expect(html).toContain('<!-- ===== 第 2 页 ===== -->')
    expect(html).toContain('<title>第一章 有理数</title>')
  })

  it('警告渲染为提示框并转义 HTML', () => {
    const html = assembleAiHtml(frags, '教材', ['第 3 页转换失败已跳过:<script>x</script>'])
    expect(html).toContain('class="warnings"')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>x</script></li>')
  })

  it('无警告时不输出提示框', () => {
    expect(assembleAiHtml(frags, '教材', [])).not.toContain('<div class="warnings">')
  })
})

describe('prompt', () => {
  it('系统提示词约定豆包标准类名与 LaTeX 规则', () => {
    expect(AI_SYSTEM_PROMPT).toContain('chapter-title')
    expect(AI_SYSTEM_PROMPT).toContain('class="example"')
    expect(AI_SYSTEM_PROMPT).toContain('\\( ... \\)')
    expect(AI_SYSTEM_PROMPT).toContain('页眉、页脚、页码一律丢弃')
  })

  it('用户消息携带页码与上一页衔接片段', () => {
    const msg = buildPageInstruction(12, 'x'.repeat(700))
    expect(msg).toContain('第 12 页')
    expect(msg).toContain('上一页结尾的 HTML')
    expect(msg.length).toBeLessThan(900)
    expect(buildPageInstruction(1, '  ')).toContain('起始页')
  })
})

describe('parsePageRange', () => {
  it('解析区间并收紧到文档页数', () => {
    expect(parsePageRange('20-35', 200)).toEqual([20, 35])
    expect(parsePageRange('20 – 35', 200)).toEqual([20, 35])
    expect(parsePageRange('199-999', 200)).toEqual([199, 200])
    expect(parsePageRange('35-20', 200)).toEqual([20, 35])
    expect(parsePageRange('7', 200)).toEqual([7, 7])
  })

  it('空串与非法输入返回 null', () => {
    expect(parsePageRange('', 200)).toBeNull()
    expect(parsePageRange('abc', 200)).toBeNull()
    expect(parsePageRange('300-400', 200)).toBeNull()
  })
})
