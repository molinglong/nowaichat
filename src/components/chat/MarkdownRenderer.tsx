'use client'

import React, { memo, useMemo, useState, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'
import type { PluggableList } from 'unified'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { BookPlus, Check, ChevronDown, ChevronUp, Copy, Sparkles, Wrench, StickyNote, Eye } from 'lucide-react'
import { parseExamSegments, parseChoice, parseEssay, parseTimeline, parseSentence, parseSourceRefLine, countEssayChars, essayToPlainText, type ExamKind, type ExamSourceRef, type ExamChoiceOption, type ExamSentencePart } from '@/lib/ai/exam-markdown'
import { useContextMenuStore, type ContextMenuItem } from '@/store/contextMenuStore'
import { insertTextToInput } from '@/lib/input-bridge'
import { useChatStore } from '@/store/chat-store'

// 可视化熔断开关: 一行降级——出现渲染死循环/性能退化时改 false,
// 全部消息回到纯文本渲染(两段式渲染的保险丝;历史坑: 流式重渲染 Maximum update depth)
const RICH_RENDER_ENABLED = true

interface MarkdownRendererProps {
  content: string
  className?: string
  messageId?: string
  /**
   * 富渲染开关(两段式策略):
   * - 流式期间传 false → 纯文本,与打字机/throttle 配合保持轻量
   * - 流式结束(含打字机追完)后传 true → react-markdown + KaTeX 一次性渲染
   * summary 卡片与「复制为 HTML」镜像始终传 true
   */
  rich?: boolean
}

// ── 试卷块（材料/设问/作答）与关键词双色标注 ────────────────────────
// 材料题里材料/设问/作答混在一坨难读。约定 AI 按试卷结构分块输出：
//   :::material …（材料原文）… :::   :::question …（设问+分值）… :::   :::answer …（分点作答）… :::
// 关键词标注：==教材术语== → 红（得分点）；@@材料信息@@ → 蓝（对应材料/时政）。
// 两者都渲染为受控 mark 元素，不引入原始 HTML（无 XSS 面）；katex/代码子树不做高亮。

// ==教材术语==(红) / @@材料信息@@(蓝)：要求成对闭合、内容不含同名符号与换行，防误伤
const INLINE_MARK_RE = /==([^=\n]+?)==|@@([^@\n]+?)@@/g

/** 单个字符串内的双色高亮切分；无命中时返回原字符串（引用不变） */
function highlightInlineText(text: string): React.ReactNode {
  INLINE_MARK_RE.lastIndex = 0
  const parts: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_MARK_RE.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(
      m[1] !== undefined ? (
        <mark key={m.index} className="exam-term">{m[1]}</mark>
      ) : (
        <mark key={m.index} className="exam-mat">{m[2]}</mark>
      ),
    )
    last = m.index + m[0].length
  }
  if (!parts.length) return text
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

// 行内 code 提为具名组件：withInlineMarks 靠引用比较跳过，代码内不做高亮
const CodeInline = ({ children }: { children?: React.ReactNode }) => (
  <code className="rounded border border-line bg-code-bg px-1 py-0.5 font-mono text-[13px]">{children}</code>
)

const MAX_MARK_DEPTH = 8

/** 递归给行内 children 接上双色高亮；katex/代码子树原样保留 */
function withInlineMarks(children: React.ReactNode): React.ReactNode {
  const walk = (node: React.ReactNode, depth: number): React.ReactNode => {
    if (depth > MAX_MARK_DEPTH) return node
    if (typeof node === 'string') return highlightInlineText(node)
    if (Array.isArray(node)) {
      let changed = false
      const out = node.map((n) => {
        const next = walk(n, depth + 1)
        if (next !== n) changed = true
        return next
      })
      return changed ? out : node
    }
    if (React.isValidElement(node)) {
      if (node.type === CodeInline) return node
      const props = node.props as { className?: string; children?: React.ReactNode }
      if (props.className && (props.className.includes('katex') || props.className.includes('language-'))) return node
      if (props.children === undefined) return node
      const nextChildren = walk(props.children, depth + 1)
      return nextChildren === props.children ? node : React.cloneElement(node, undefined, nextChildren)
    }
    return node
  }
  return walk(children, 0)
}

// ── 代码块右键菜单辅助:从 <pre> 的 children(<code class="language-x">…</code>)提取语言与纯文本代码 ──
// react-markdown 块级 code 走 CodeInline 组件,className 由 ast 属性透传,仍在 props 上
function codeNodeToText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(codeNodeToText).join('')
  if (React.isValidElement(node)) {
    return codeNodeToText((node.props as { children?: React.ReactNode }).children)
  }
  return ''
}

function extractCodeInfo(children: React.ReactNode): { language: string; code: string } {
  const child = Array.isArray(children) ? children[0] : children
  if (React.isValidElement<{ className?: string; children?: React.ReactNode }>(child)) {
    const m = /language-([\w+#.-]+)/.exec(child.props.className ?? '')
    return {
      language: m ? m[1] : '',
      code: codeNodeToText(child.props.children),
    }
  }
  return { language: '', code: typeof child === 'string' ? child : '' }
}

/**
 * 代码块:常驻工具行(语言 badge / 复制 / 预览)+ 右键菜单(复制 / 交给 AI / 预览)。
 * 性能红线:本组件随每条消息渲染 —— memo + 轻量常驻 DOM,菜单状态全在
 * 全局 contextMenuStore,不在本组件持有;流式纯文本分支不经过这里。
 * 「交给 AI」走 input-bridge 事件注入输入框,不新增 props 链;
 * 「预览」写 chat-store 的 previewCode,由 ChatPreviewPanel 滑出渲染。
 */
const CodeBlock = memo(function CodeBlock({ children }: { children?: React.ReactNode }) {
  const { language, code } = useMemo(() => extractCodeInfo(children), [children])
  // 「交给 AI」类操作只在聊天页有意义(其他 surface 的输入桥接不存在);
  // 非聊天页仅保留复制,避免点击后无响应
  const pathname = usePathname()
  const inChat = !!pathname?.startsWith('/chat')

  const handleCopy = useCallback(() => {
    if (!navigator.clipboard?.writeText) {
      toast.error('当前浏览器不支持自动复制', { title: '复制失败' })
      return
    }
    navigator.clipboard.writeText(code)
      .then(() => toast.success('已复制代码', { title: '复制' }))
      .catch((err) => {
        console.error('[CodeBlock] copy failed:', err)
        toast.error('复制失败', { title: '复制' })
      })
  }, [code])

  // HTML/SVG 代码块 → 滑出预览面板(移动端全宽覆盖,桌面端侧栏)
  const canPreview = language === 'html' || language === 'svg'
  const handlePreview = useCallback(() => {
    useChatStore.getState().setPreviewCode(code)
  }, [code])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!code.trim()) return
    e.preventDefault()
    const langLabel = language || '这段'
    const mdSource = '```' + language + '\n' + code + '\n```'
    const candidates: (ContextMenuItem | false | undefined)[] = [
      {
        id: 'copy',
        label: '复制代码',
        icon: <Copy className="w-3.5 h-3.5" />,
        onSelect: handleCopy,
      },
      inChat && {
        id: 'explain',
        label: '让 AI 解释这段代码',
        icon: <Sparkles className="w-3.5 h-3.5" />,
        dividerBefore: true,
        onSelect: () => insertTextToInput(`请解释以下${langLabel}代码:\n\n${mdSource}`),
      },
      inChat && {
        id: 'fix',
        label: '让 AI 修复 / 优化这段代码',
        icon: <Wrench className="w-3.5 h-3.5" />,
        onSelect: () => insertTextToInput(`请修复并优化以下${langLabel}代码,指出问题所在:\n\n${mdSource}`),
      },
      inChat && {
        id: 'comment',
        label: '让 AI 为代码添加注释',
        icon: <StickyNote className="w-3.5 h-3.5" />,
        onSelect: () => insertTextToInput(`请为以下${langLabel}代码添加逐段注释:\n\n${mdSource}`),
      },
      inChat && canPreview && {
        id: 'preview',
        label: '预览',
        icon: <Eye className="w-3.5 h-3.5" />,
        dividerBefore: true,
        onSelect: handlePreview,
      },
    ]
    const items = candidates.filter((it): it is ContextMenuItem => !!it)
    if (!items.length) return
    const { openContextMenu } = useContextMenuStore.getState()
    openContextMenu({ x: e.clientX, y: e.clientY }, items, language ? language.toUpperCase() : undefined)
  }, [code, language, handleCopy, handlePreview, canPreview, inChat])

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-line bg-code-bg">
      {language && (
        <div className="flex items-center justify-between gap-2 pl-3 pr-1.5 py-1 bg-code-header border-b border-line">
          <span className="text-[10px] text-content-muted font-mono uppercase tracking-wider truncate select-none">
            {language}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            {canPreview && (
              <button
                type="button"
                onClick={handlePreview}
                title="预览"
                aria-label="预览"
                className="p-1.5 rounded-md text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={handleCopy}
              title="复制代码"
              aria-label="复制代码"
              className="p-1.5 rounded-md text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
      <pre onContextMenu={handleContextMenu} className="p-3 overflow-x-auto text-[13px] leading-relaxed">
        {children}
      </pre>
    </div>
  )
})

// markdown 元素 → 项目中性灰 token 样式。只映射视觉关键元素,
// strong/em 等走浏览器默认;不引入 @tailwindcss/typography(依赖与样式都可控)
// 行内容器(h1-h4/p/li/a/th/td/strong/em)的 children 统一过 withInlineMarks 接上双色高亮
const mdComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-2 mt-4 text-base font-semibold text-content-primary first:mt-0">{withInlineMarks(children)}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-[15px] font-semibold text-content-primary first:mt-0">{withInlineMarks(children)}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-sm font-semibold text-content-primary first:mt-0">{withInlineMarks(children)}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1.5 mt-3 text-sm font-semibold text-content-secondary first:mt-0">{withInlineMarks(children)}</h4>
  ),
  p: ({ children }) => {
    // 独立成段的行内公式(模型常把 $..$ 单独成行,看起来夹在正文里很难受):
    // 段内仅一个 .katex 元素、其余为空白 → 渲染成公式卡片(样式见 globals.css .math-card);
    // 「文字+公式」混排段不命中,保持普通段落
    const nodes = React.Children.toArray(children)
    const math = nodes.find(
      (n): n is React.ReactElement<{ className?: string }> =>
        React.isValidElement(n) && n.props.className === 'katex',
    )
    if (math && nodes.every((n) => n === math || (typeof n === 'string' && !n.trim()))) {
      return <p className="math-card">{math}</p>
    }
    return <p className="my-2 first:mt-0 last:mb-0">{withInlineMarks(children)}</p>
  },
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{withInlineMarks(children)}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-line pl-3 text-content-secondary">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-line" />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-line underline-offset-2 hover:decoration-content-secondary"
    >
      {withInlineMarks(children)}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-code-header/50">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-line px-2.5 py-1.5 text-left font-medium text-content-secondary">{withInlineMarks(children)}</th>
  ),
  td: ({ children }) => <td className="border-b border-line px-2.5 py-1.5 align-top">{withInlineMarks(children)}</td>,
  pre: CodeBlock,
  // 行内 code 样式;块级 code 在 pre 内由 globals.css 的 .rich-md pre code 覆盖为无背景无边框
  code: CodeInline,
  img: ({ src, alt }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt ?? ''} className="my-2 max-w-full rounded-lg border border-line" />
  ),
  // strong/em 接入高亮管线(视觉仍走浏览器默认,如 **加粗==术语==** 也能标红)
  strong: ({ children }) => <strong>{withInlineMarks(children)}</strong>,
  em: ({ children }) => <em>{withInlineMarks(children)}</em>,
}

/**
 * 把「独占一行」的行内公式($..$)提升为块级($$..$$):
 * 行内公式走 KaTeX textstyle,分数/求和类被渲染得非常紧凑(分子分母挤在分数线两侧);
 * displayStyle 用全尺寸参数,上下舒展。模型单行输出 $..$ 很常见,语义上就是展示公式。
 * 逐行扫描,跳过 fenced code block 内的行,避免误改代码示例;
 * 单行的 $$x$$ 也顺手展开为三行(标准 flow 语法),防 micromark 解析异常。
 */
function promoteStandaloneMath(md: string): string {
  const lines = md.split('\n')
  let inFence = false
  let fenceChar = ''
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].trim().match(/^(`{3,}|~{3,})/)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceChar = fence[1][0]
      } else if (fence[1][0] === fenceChar) {
        inFence = false
        fenceChar = ''
      }
      continue
    }
    if (inFence) continue
    // $$x$$ 单行 → 三行块级
    const block = lines[i].match(/^\s*\$\$(.+)\$\$\s*$/)
    if (block) {
      lines[i] = `$$\n${block[1]}\n$$`
      continue
    }
    // 单 $ 包裹且独占一行(内容不含裸 $,支持 \\ 转义)
    const inline = lines[i].match(/^\s*\$(?!\$)((?:\\.|[^$\\])+?)\$\s*$/)
    if (inline) lines[i] = `$$\n${inline[1]}\n$$`
  }
  return lines.join('\n')
}

/**
 * LaTeX 原生定界符归一化: \(...\) → $...$、\[...\] → $$...$$
 * 课本 chunk 与部分模型(GLM 系)用 \( \) 风格写公式,remarkMath 只认 $ 定界符——
 * 不转换会整段漏渲染,且 \\ 换行被 markdown 转义吞成鬼画符;fenced code 内不处理
 */
function normalizeMathDelimiters(md: string): string {
  if (!md.includes('\\(') && !md.includes('\\[')) return md
  const segs = md.split(/(`{3,}[\s\S]*?`{3,}|~{3,}[\s\S]*?~{3,})/g)
  return segs
    .map((seg, i) =>
      i % 2 === 1
        ? seg
        : seg
            .replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => `$${inner}$`)
            .replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => `$$${inner}$$`),
    )
    .join('')
}

function RichSegment({ content, promote = true }: { content: string; promote?: boolean }) {
  // 插件数组引用固定(memo),避免父组件重渲染导致 ReactMarkdown 反复重新解析
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], [])
  // rehype-highlight 只认 language-* 标注(detect:false 防误染普通文本),未注册语言静默跳过
  const rehypePlugins = useMemo<PluggableList>(
    () => [
      [rehypeKatex, { throwOnError: false, strict: false }],
      [rehypeHighlight, { detect: false, ignoreMissing: true }],
    ],
    [],
  )
  // 内容稳定后才进富渲染,预处理只跑一次;先归一化定界符再决定是否块级升级
  // promote=false 用于选择题选项/诗行等短文本行——单行纯公式升级成块级卡片(math-card/katex-display)
  // 在正文里是美化,在选项里每个选项一张大卡是灾难;定界符归一化对选项同样需要,不受 promote 开关影响
  const promoted = useMemo(() => {
    const normalized = normalizeMathDelimiters(content)
    return promote ? promoteStandaloneMath(normalized) : normalized
  }, [content, promote])
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={mdComponents}>
      {promoted}
    </ReactMarkdown>
  )
}

const EXAM_TAG: Record<ExamKind, string> = { choice: '选择题', material: '材料', question: '设问', answer: '作答', poem: '诗句', lyrics: '歌词', essay: '作文', timeline: '时间轴', translate: '译文', sentence: '成分分析' }

/** 单组题面: 题干 + 试卷式选项（长选项通栏，全部短选项时自动两列）；选项内高亮照常生效 */
function ChoiceGroupView({ stem, options }: { stem: string; options: ExamChoiceOption[] }) {
  if (!options.length) return <RichSegment content={stem} />
  // 试卷排版启发: 短选项（如古文化常识/词语判断）两列更像卷面，长句选项通栏易读
  const twoCol = options.length > 2 && options.every((o) => o.text.length <= 14)
  return (
    <div className="exam-choice-group">
      {stem && <RichSegment content={stem} />}
      <div className={cn('exam-options', twoCol && 'exam-options-2col')}>
        {options.map((o) => (
          <div key={o.letter} className="exam-option">
            <span className="exam-option-letter" aria-hidden>{o.letter}</span>
            <div className="flex-1 min-w-0">
              <RichSegment content={o.text} promote={false} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 选择题块渲染: 单题直渲；模型把多题塞进一个块时（parseChoice 拆组成功）逐组渲染，组间虚线分隔 */
function ExamChoiceBody({ text }: { text: string }) {
  const { stem, options, groups } = useMemo(() => parseChoice(text), [text])
  if (!options.length) return <RichSegment content={text} />
  if (groups.length > 1) {
    return groups.map((g, i) => <ChoiceGroupView key={i} stem={g.stem} options={g.options} />)
  }
  return <ChoiceGroupView stem={stem} options={options} />
}

/** 译文块分区: 英文题目的中文翻译卡(首行题干+逐选项中文)，复用 parseChoice 的选项行解析;
 * 无选项行时整块按普通文本渲染(语法填空整篇译文等场景)；配色弱化为注释层，不抢英文题面 */
function ExamTranslateBody({ text }: { text: string }) {
  const { stem, options } = useMemo(() => parseChoice(text), [text])
  if (!options.length) return <RichSegment content={text} promote={false} />
  return (
    <>
      {stem && <div className="exam-translate-stem"><RichSegment content={stem} promote={false} /></div>}
      <div className="exam-translate-options">
        {options.map((o) => (
          <div key={o.letter} className="exam-translate-option">
            <span className="exam-translate-letter" aria-hidden>{o.letter}</span>
            <div className="flex-1 min-w-0"><RichSegment content={o.text} promote={false} /></div>
          </div>
        ))}
      </div>
    </>
  )
}

/** 成分配色映射: 每种成分一色，从句按句法功能继承同色(定语从句=定语色、状语从句=状语色…)；
 * 色值见 globals.css 的 --sent-* 色板，键对应 .exam-sent-c-* 变量类 */
const SENTENCE_ROLE_COLOR: Record<string, string> = {
  主语: 'subj', 主语从句: 'subj',
  谓语: 'pred', 谓语动词: 'pred',
  宾语: 'obj', 宾语从句: 'obj',
  表语: 'preci', 表语从句: 'preci',
  定语: 'attr', 定语从句: 'attr',
  状语: 'adv', 状语从句: 'adv',
  补语: 'comp',
  同位语: 'appo', 同位语从句: 'appo',
  插入语: 'pare',
  中心语: 'head',
  从句: 'attr',
}

function sentenceRoleColor(role: string): string {
  return SENTENCE_ROLE_COLOR[role] ?? ''
}

/** 成分回标: 把明细行的成分片段在原句中定位(找不到再试大小写不敏感),
 * 重叠消解后按区间切分渲染——每成分一色底色+下划线(课本图解思路)。
 * 回标是纯展示增强: 匹配失败只是不着色,不吞内容;主干行不参与(内容为主干提炼非原句片段) */
interface SentenceMark { start: number; end: number; color: string }

function collectSentenceMarks(sentence: string, parts: ExamSentencePart[]): SentenceMark[] {
  if (!sentence) return []
  const plain = sentence.replace(/(==+|@@+)/g, '')
  const marks: SentenceMark[] = []
  for (const p of parts) {
    if (p.backbone || !p.text) continue
    const color = sentenceRoleColor(p.role)
    if (!color) continue
    const needle = p.text.trim()
    if (needle.length < 2) continue
    let idx = plain.indexOf(needle)
    if (idx < 0) {
      const li = plain.toLowerCase().indexOf(needle.toLowerCase())
      if (li >= 0) idx = li
    }
    if (idx < 0) continue
    marks.push({ start: idx, end: idx + needle.length, color })
  }
  marks.sort((a, b) => a.start - b.start || b.end - a.end)
  const out: SentenceMark[] = []
  let lastEnd = -1
  for (const m of marks) {
    if (m.start >= lastEnd) {
      out.push(m)
      lastEnd = m.end
    }
  }
  return out
}

function SentenceAnnotated({ sentence, marks }: { sentence: string; marks: SentenceMark[] }) {
  const nodes: React.ReactNode[] = []
  let cursor = 0
  marks.forEach((m, i) => {
    if (m.start > cursor) nodes.push(<span key={`t${i}`}>{sentence.slice(cursor, m.start)}</span>)
    nodes.push(
      <span key={`m${i}`} className={cn('exam-sentence-hl-c', `exam-sent-c-${m.color}`)}>
        {sentence.slice(m.start, m.end)}
      </span>,
    )
    cursor = m.end
  })
  if (cursor < sentence.length) nodes.push(<span key="tail">{sentence.slice(cursor)}</span>)
  return <>{nodes}</>
}

/** 句子成分块分区: 首行原句(成分内容自动回标着色) + 成分明细列表(徽标+内容+说明);
 * 徽标分档同源双色(主干红/修饰蓝),保持卷面两色纪律;无原句或成分行时回退普通文本 */
function ExamSentenceBody({ text }: { text: string }) {
  const { sentence, parts, note } = useMemo(() => parseSentence(text), [text])
  const marks = useMemo(() => collectSentenceMarks(sentence, parts), [sentence, parts])
  if (!sentence && !parts.length) return <RichSegment content={text} promote={false} />
  return (
    <>
      {sentence && <div className="exam-sentence-raw"><SentenceAnnotated sentence={sentence} marks={marks} /></div>}
      {parts.length > 0 && (
        <div className="exam-sentence-rows">
          {parts.map((p, i) => (
            <div key={i} className={cn('exam-sentence-row', p.backbone && 'exam-sentence-row-bb')}>
              <span
                className={
                  p.backbone
                    ? 'exam-sentence-role exam-sentence-role-bb'
                    : cn('exam-sentence-role exam-sentence-role-c', `exam-sent-c-${sentenceRoleColor(p.role)}`)
                }
              >
                {p.role}
              </span>
              <div className="exam-sentence-text">
                {p.text && <RichSegment content={p.text} promote={false} />}
                {p.note && <span className="exam-sentence-note">｜{p.note}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {note && <div className="exam-sentence-footnote"><RichSegment content={note} promote={false} /></div>}
    </>
  )
}

/** 时间轴块分区: 左侧年份列+竖轴+节点事件流,行首 * 为关键节点(红点);
 * 事件名/标题/尾注走行内高亮,说明行走 RichSegment(双色标注/行内公式照常生效) */
function ExamTimelineBody({ text }: { text: string }) {
  const { title, events, note } = useMemo(() => parseTimeline(text), [text])
  return (
    <>
      {title && <div className="exam-timeline-title">{withInlineMarks(title)}</div>}
      <div className="exam-timeline-body">
        <div className="exam-timeline-axis" aria-hidden />
        {events.map((ev, i) => (
          <div key={i} className={cn('exam-timeline-item', ev.key && 'exam-timeline-item-key')}>
            <span className="exam-timeline-year" aria-hidden>{ev.year}</span>
            <span className="exam-timeline-node" aria-hidden />
            <div className="exam-timeline-head">
              {ev.era && <span className="exam-timeline-era">{ev.era}</span>}
              <span className="exam-timeline-name">{withInlineMarks(ev.name)}</span>
            </div>
            {ev.desc && <div className="exam-timeline-desc"><RichSegment content={ev.desc} promote={false} /></div>}
            {ev.src && <div className="exam-timeline-src">{ev.src}</div>}
          </div>
        ))}
      </div>
      {note && <div className="exam-timeline-note">{withInlineMarks(note)}</div>}
    </>
  )
}

/** 诗块分区: 逐行居中疏排;markdown 单换行不产生换行,故按物理行切分,每行独立渲染(保留行内加粗/高亮) */
function ExamPoemBody({ text }: { text: string }) {
  const lines = useMemo(() => text.split('\n').map((l) => l.trim()).filter(Boolean), [text])
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className="exam-poem-line">
          <RichSegment content={line} promote={false} />
        </div>
      ))}
    </>
  )
}

/** 作文纸分区: 首行标题居中疏排,正文走完整 markdown(双色标注生效);字数徽标为前端实时计数(占格口径:含标题含标点,剔除行内语法符);右上角一键复制纯文本(标题+正文,已剥语法符) */
function ExamEssayBody({ text }: { text: string }) {
  const { title, body } = useMemo(() => parseEssay(text), [text])
  const charCount = useMemo(() => countEssayChars(title, body), [title, body])
  const plainText = useMemo(() => essayToPlainText(title, body), [title, body])
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    if (!navigator.clipboard?.writeText) {
      toast.error('当前浏览器不支持自动复制', { title: '复制失败' })
      return
    }
    navigator.clipboard.writeText(plainText)
      .then(() => {
        setCopied(true)
        toast.success('已复制作文全文', { title: '复制' })
        setTimeout(() => setCopied(false), 2000)
      })
      .catch((err) => {
        console.error('[ExamEssay] copy failed:', err)
        toast.error('复制失败', { title: '复制' })
      })
  }, [plainText])

  return (
    <>
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-2 top-2 p-1 rounded-md text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors"
        title="复制作文全文"
        aria-label="复制作文"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      {title && <div className="exam-essay-title">{title}</div>}
      {body && <RichSegment content={body} />}
      {charCount > 0 && <div className="exam-essay-wc">全文 {charCount} 字</div>}
    </>
  )
}

/** 设问小问拆行: (1)/(2) 或 ①② 这类编号在一段内出现≥2个时,每个小问独立成行(试卷惯例);
 * 编号后括号必须纯数字,避免误伤 f(x)/(1+x) 这类数学式 */
const QUESTION_PART_SPLIT_RE = /(?=[(（]\s*\d{1,2}\s*[)）]|[①-⑫])/

function ExamQuestionBody({ text }: { text: string }) {
  const parts = useMemo(() => text.split(QUESTION_PART_SPLIT_RE).map((s) => s.trim()).filter(Boolean), [text])
  // 拆行用行尾双空格硬换行:小问问距保持行内紧凑,不产生段落级大空隙
  return <RichSegment content={parts.length >= 2 ? parts.join('  \n') : text} />
}

/** 出题场景的作答块:默认收起防剧透,点击展开(仅当同组题块带出处徽标时启用);流式期间折叠状态不重置。
 * 折叠态按钮提到块头行(与「作答」标签同一水平线,与参考徽标同位),块塌缩成薄条;展开后右上角提供收起,防剧透闭环 */
function ExamAnswerBody({ text, collapsible }: { text: string; collapsible: boolean }) {
  const [open, setOpen] = useState(false)
  if (!collapsible) return <RichSegment content={text} />
  const toggle = () => setOpen((v) => !v)
  if (open)
    return (
      <>
        <RichSegment content={text} />
        <button type="button" onClick={toggle} className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[11px] text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors" aria-label="收起答案">
          <ChevronUp className="w-3 h-3" />
          收起
        </button>
      </>
    )
  return (
    <button type="button" onClick={toggle} className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-line bg-surface-subtle px-2.5 py-1 text-[11px] text-content-muted hover:text-content-primary transition-colors" aria-label="显示答案">
      <ChevronDown className="w-3 h-3" />
      显示答案
    </button>
  )
}

/** 出处行学科中文标签 → 题库 subject 英文枚举(save route 白名单只收英文,直传中文会被 skip) */
const SUBJECT_ENUM: Record<string, string> = {
  数学: 'math',
  语文: 'chinese',
  英语: 'english',
  物理: 'physics',
  化学: 'chemistry',
  生物: 'biology',
  历史: 'history',
  政治: 'politics',
  地理: 'geography',
}

/** 题卡右上角:出处徽标 + 收进题库(题块与紧邻答案块齐备才显示按钮);入库后变绿勾禁用 */
function QuizRefBadge({
  refName,
  subject,
  quizKind,
  stem,
  answerText,
}: {
  refName: string
  subject: string | null
  quizKind: 'choice' | 'answer'
  stem: string
  answerText: string
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle')

  const handleSave = useCallback(async () => {
    if (state !== 'idle') return
    setState('saving')
    try {
      const res = await fetch('/api/study/quiz/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: [
            {
              subject: (subject && SUBJECT_ENUM[subject]) || 'other',
              kind: quizKind,
              stem,
              answer: answerText,
              sourceRef: refName,
              source: 'ai_generated',
            },
          ],
        }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setState('done')
      toast.success('已收进题库', { title: '题库' })
    } catch (err) {
      setState('idle')
      console.error('[QuizRefBadge] save failed:', err)
      toast.error(err instanceof Error ? err.message : '入库失败', { title: '收进题库' })
    }
  }, [state, subject, quizKind, stem, answerText, refName])

  return (
    <span className="absolute right-2 top-2 inline-flex items-center gap-1">
      <span className="text-[11px] leading-none text-content-muted whitespace-nowrap">参考 {refName}</span>
      <button
        type="button"
        onClick={handleSave}
        disabled={state !== 'idle'}
        className="p-1 rounded-md text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors"
        title={state === 'done' ? '已在题库' : '收进题库'}
        aria-label="收进题库"
      >
        {state === 'done' ? <Check className="w-3.5 h-3.5 text-green-500" /> : <BookPlus className="w-3.5 h-3.5" />}
      </button>
    </span>
  )
}

/** 试卷分区: 材料(浅底纹)/设问(深角标)/作答;相邻块经 join-* 接成一张“试卷纸”;内部仍走完整 markdown 渲染。
 *  出题扩展: 题块(choice/question)首行「参考 §x.x·学科」剥出为右上徽标;带徽标的题块其紧邻答案块默认折叠; */
function ExamBlock({
  kind,
  text,
  joinTop,
  joinBottom,
  answerCollapsible,
  quizAnswerText,
}: {
  kind: ExamKind
  text: string
  joinTop?: boolean
  joinBottom?: boolean
  /** answer 块专用:前块为带出处的题块时 true(默认收起防剧透) */
  answerCollapsible?: boolean
  /** 题块专用:紧邻 answer 块原文(齐备才显示收进题库按钮) */
  quizAnswerText?: string
}) {
  const isQuizStem = kind === 'choice' || kind === 'question'
  const { sourceRef, body } = isQuizStem ? parseSourceRefLine(text) : { sourceRef: null as ExamSourceRef | null, body: text }
  const displayText = isQuizStem ? body : text
  return (
    <div
      className={cn(
        'exam-block',
        'relative',
        `exam-${kind}`,
        joinTop && 'exam-join-top',
        joinBottom && 'exam-join-bottom',
      )}
    >
      <span className="exam-block-tag">{EXAM_TAG[kind]}</span>
      {sourceRef && quizAnswerText && (
        <QuizRefBadge
          refName={sourceRef.ref}
          subject={sourceRef.subject}
          quizKind={kind === 'choice' ? 'choice' : 'answer'}
          stem={body}
          answerText={quizAnswerText}
        />
      )}
      {sourceRef && !quizAnswerText && (
        <span className="absolute right-2 top-2 text-[11px] leading-none text-content-muted whitespace-nowrap">参考 {sourceRef.ref}</span>
      )}
      {kind === 'choice' ? (
        <ExamChoiceBody text={displayText} />
      ) : kind === 'timeline' ? (
        <ExamTimelineBody text={text} />
      ) : kind === 'poem' || kind === 'lyrics' ? (
        <ExamPoemBody text={text} />
      ) : kind === 'essay' ? (
        <ExamEssayBody text={text} />
      ) : kind === 'question' ? (
        <ExamQuestionBody text={displayText} />
      ) : kind === 'translate' ? (
        <ExamTranslateBody text={text} />
      ) : kind === 'sentence' ? (
        <ExamSentenceBody text={text} />
      ) : kind === 'answer' ? (
        <ExamAnswerBody text={text} collapsible={!!answerCollapsible} />
      ) : (
        <RichSegment content={displayText} />
      )}
    </div>
  )
}

function RichMarkdown({ content }: { content: string }) {
  // 试卷块切分: 无 ::: 时单段,与旧版渲染结构一致
  const segments = useMemo(() => parseExamSegments(content), [content])
  return (
    <div className="rich-md">
      {segments.map((seg, i) => {
        if (seg.type === 'md') return <RichSegment key={i} content={seg.text} />
        // 出题组判定: answer 块向前回溯连续 exam 块(材料/设问/选择题),任一块首行带出处即整组视为出题;
        // md 段或 answer 块截断回溯(跨过 answer 就是下一道题,避免出处串组)。
        // 语文主观题是 material+question+answer 三连,出处常写在 material 首行——只看紧邻前块会漏判,答案不折叠
        const prevQuizRef = (() => {
          for (let j = i - 1; j >= 0; j--) {
            const s = segments[j]
            if (s.type !== 'exam' || s.kind === 'answer') break
            const ref = parseSourceRefLine(s.text).sourceRef
            if (ref) return ref
          }
          return null
        })()
        // 出题组联动: 题块向后找紧邻 answer(允许中间隔 translate 译文块)——齐备才显示「收进题库」;
        // 跨过其他块截断,避免出处串组
        const nextAnswerText = (() => {
          for (let j = i + 1; j < segments.length; j++) {
            const s = segments[j]
            if (s.type !== 'exam') break
            if (s.kind === 'answer') return s.text
            if (s.kind !== 'translate') break
          }
          return null
        })()
        const isQuizStem = seg.kind === 'choice' || seg.kind === 'question'
        const stemRef = isQuizStem ? parseSourceRefLine(seg.text).sourceRef : null
        return (
          <ExamBlock
            key={i}
            kind={seg.kind}
            text={seg.text}
            joinTop={i > 0 && segments[i - 1].type === 'exam'}
            joinBottom={i < segments.length - 1 && segments[i + 1].type === 'exam'}
            answerCollapsible={seg.kind === 'answer' && !!prevQuizRef}
            quizAnswerText={isQuizStem && stemRef && nextAnswerText ? nextAnswerText : undefined}
          />
        )
      })}
    </div>
  )
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
  rich,
}: MarkdownRendererProps) {
  // 纯文本模式: 流式期间/熔断时走这里,与旧版行为完全一致(whitespace-pre-wrap 保留换行)
  if (!RICH_RENDER_ENABLED || !rich) {
    return (
      <div
        className={cn('text-sm text-content-primary leading-relaxed break-words whitespace-pre-wrap', className)}
      >
        {content}
      </div>
    )
  }
  // 富渲染: 仅内容稳定后触发(content 固定 → 外层 memo 拦截父组件重渲染,只渲染一次)
  return (
    <div className={cn('text-sm text-content-primary leading-relaxed break-words', className)}>
      <RichMarkdown content={content} />
    </div>
  )
})
