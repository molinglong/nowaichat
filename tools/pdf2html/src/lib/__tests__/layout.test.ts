import { describe, expect, it } from 'vitest'
import {
  buildLines,
  joinWrapped,
  matchListPrefix,
  orderPageSegments,
  segmentPage,
} from '../layout'
import type { TextItem, TextLine } from '../../types'

/** 合成 item:按字符估算宽度(CJK 1em,拉丁 0.5em) */
function item(str: string, x: number, y: number, fontSize = 12, fontName = 'Font'): TextItem {
  const width = Array.from(str).reduce(
    (sum, ch) => sum + (ch.codePointAt(0)! > 0x2e80 ? fontSize : fontSize * 0.5),
    0,
  )
  return { str, x, y, width, fontSize, fontName }
}

/** 快速造行(绕过 item 聚类,直接测段落/标题/列表逻辑) */
function line(text: string, y: number, x: number, right: number, fontSize = 12, bold = false): TextLine {
  return { text, y, x, right, fontSize, bold }
}

describe('buildLines 行重组', () => {
  it('同一基线聚成一行,CJK 之间绝不插空格', () => {
    const lines = buildLines([item('你好', 0, 100), item('世界', 24, 100)])
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('你好世界')
  })

  it('拉丁词间大间隙补一个空格', () => {
    // fontSize 10,"Hello" 宽 25,第二词起点 30 → gap 5 = 0.5em
    const lines = buildLines([item('Hello', 0, 100, 10), item('world', 30, 100, 10)])
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('Hello world')
  })

  it('不同基线拆成两行,按 y 从上到下输出', () => {
    const lines = buildLines([item('第二行', 0, 70), item('第一行', 0, 100)])
    expect(lines.map((l) => l.text)).toEqual(['第一行', '第二行'])
  })

  it('行内大间隙拆段:双栏/旁注不粘成一个长行', () => {
    // 左段宽 48pt,x=74 → gap 26 > max(10, 1.8*12=21.6) → 拆为两段
    const lines = buildLines([item('左栏内容', 0, 100), item('右栏内容', 74, 100)])
    expect(lines.map((l) => l.text)).toEqual(['左栏内容', '右栏内容'])
    expect(lines[0].y).toBe(lines[1].y)
  })

  it('加粗字体名触发 bold 标记', () => {
    const lines = buildLines([item('标题', 0, 100, 14, 'ABCDEE+SourceHanSansCN-Bold')])
    expect(lines[0].bold).toBe(true)
  })
})

describe('segmentPage 段落切分', () => {
  it('首行缩进触发分段', () => {
    const blocks = segmentPage(
      [
        line('第一段第一行', 700, 57, 200),
        line('第一段第二行', 686, 57, 200),
        line('第二段开始', 672, 81, 200), // 缩进 24pt ≥ 1.3em
      ],
      595,
    )
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ type: 'paragraph', text: '第一段第一行第一段第二行' })
    expect(blocks[1]).toEqual({ type: 'paragraph', text: '第二段开始' })
  })

  it('行距显著增大触发分段', () => {
    const blocks = segmentPage(
      [
        line('上一段结尾', 700, 57, 538),
        line('下一段开头', 668, 57, 538), // gap 32,pitch 14 → 32 > 14*1.45
        line('同段续行', 654, 57, 538),
      ],
      595,
    )
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ type: 'paragraph', text: '上一段结尾' })
    expect(blocks[1]).toEqual({ type: 'paragraph', text: '下一段开头同段续行' })
  })

  it('上行句末标点且提前收笔触发分段', () => {
    const blocks = segmentPage(
      [
        line('第一段结束了。', 700, 57, 300), // right 300 远小于 maxRight
        line('第二段开始了。', 686, 57, 538),
      ],
      595,
    )
    expect(blocks).toHaveLength(2)
  })

  it('段内换行的拉丁词界补空格,CJK 直接相连', () => {
    const blocks = segmentPage(
      [
        line('Hello world', 700, 57, 538),
        line('next sentence', 686, 57, 538),
        line('中文第二行', 672, 57, 538),
      ],
      595,
    )
    expect(blocks[0]).toEqual({ type: 'paragraph', text: 'Hello world next sentence中文第二行' })
  })
})

describe('segmentPage 标题与文档标题', () => {
  it('字号显著大于正文识别为二级标题,正文合并为段落', () => {
    const blocks = segmentPage(
      [
        line('第一章 引言', 700, 57, 200, 20),
        line('正文内容一小段。', 672, 57, 300),
        line('继续正文。', 658, 57, 300),
      ],
      595,
    )
    expect(blocks[0]).toEqual({ type: 'heading', level: 2, text: '第一章 引言' })
    expect(blocks[1]).toEqual({ type: 'paragraph', text: '正文内容一小段。继续正文。' })
  })

  it('首页居中大字短行识别为文档标题,加粗短行识别为三级标题', () => {
    const blocks = segmentPage(
      [
        line('高等数学期末试卷', 750, 168, 428, 16),
        line('一、选择题', 700, 57, 130, 12, true),
      ],
      595,
      { firstPage: true },
    )
    expect(blocks[0]).toEqual({ type: 'title', text: '高等数学期末试卷' })
    expect(blocks[1]).toEqual({ type: 'heading', level: 3, text: '一、选择题' })
  })
})

describe('segmentPage 列表', () => {
  it('连续符号行合并为无序列表,编号行合并为有序列表', () => {
    const blocks = segmentPage(
      [
        line('• 苹果', 700, 57, 120),
        line('• 香蕉', 686, 57, 120),
        line('1. 第一步', 672, 57, 120),
      ],
      595,
    )
    expect(blocks[0]).toEqual({ type: 'list', ordered: false, items: ['苹果', '香蕉'] })
    expect(blocks[1]).toEqual({ type: 'list', ordered: true, items: ['第一步'] })
  })

  it('页眉页脚纯页码行被剔除', () => {
    const blocks = segmentPage(
      [
        line('正文内容', 700, 57, 538),
        line('3', 640, 290, 305),
      ],
      595,
    )
    expect(blocks).toEqual([{ type: 'paragraph', text: '正文内容' }])
  })
})

describe('orderPageSegments 分栏重排', () => {
  it('双栏页面:先左栏后右栏', () => {
    const left = [
      line('左栏第一行内容较多字', 700, 57, 260),
      line('左栏第二行内容较多字', 686, 57, 260),
    ]
    const right = [
      line('右栏甲行内容', 700, 300, 540),
      line('右栏乙行内容', 686, 300, 540),
    ]
    const out = orderPageSegments([...left, ...right], 595)
    expect(out.map((l) => l.text)).toEqual(['左栏第一行内容较多字', '左栏第二行内容较多字', '右栏甲行内容', '右栏乙行内容'])
  })

  it('旁注栏(窄且靠边)殿后,主栏顺序不变', () => {
    const left = [
      line('正文第一行内容', 700, 57, 260),
      line('正文第二行内容', 686, 57, 260),
    ]
    const right = [
      line('续栏甲行内容', 700, 300, 540),
      line('续栏乙行内容', 686, 300, 540),
    ]
    const note = [line('旁注补充说明文字', 700, 560, 620)]
    const out = orderPageSegments([...left, ...right, ...note], 595)
    expect(out.map((l) => l.text)).toEqual([
      '正文第一行内容',
      '正文第二行内容',
      '续栏甲行内容',
      '续栏乙行内容',
      '旁注补充说明文字',
    ])
  })

  it('单栏页面保持原序不变', () => {
    const segs = [line('甲行内容', 700, 57, 538), line('乙行内容', 686, 57, 538)]
    expect(orderPageSegments(segs, 595).map((l) => l.text)).toEqual(['甲行内容', '乙行内容'])
  })
})

describe('matchListPrefix 前缀识别', () => {
  it('识别各类前缀并剥除', () => {
    expect(matchListPrefix('一、总则')).toEqual({ ordered: true, content: '总则' })
    expect(matchListPrefix('（3）选项')).toEqual({ ordered: true, content: '选项' })
    expect(matchListPrefix('① 第一小点')).toEqual({ ordered: true, content: '第一小点' })
    expect(matchListPrefix('- 直连内容')).toEqual({ ordered: false, content: '直连内容' })
  })

  it('普通文本与年份不开误报', () => {
    expect(matchListPrefix('2016年发生的事')).toBeNull()
    expect(matchListPrefix('普通正文一行')).toBeNull()
  })
})

describe('joinWrapped 拼行', () => {
  it('CJK 直接相连,拉丁补空格', () => {
    expect(joinWrapped('第一行', '第二行')).toBe('第一行第二行')
    expect(joinWrapped('Hello', 'world')).toBe('Hello world')
  })
})
