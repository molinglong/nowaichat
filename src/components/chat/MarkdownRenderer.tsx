'use client'

import React, { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { Components } from 'react-markdown'
import type { PluggableList } from 'unified'
import { cn } from '@/lib/utils'

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

// markdown 元素 → 项目中性灰 token 样式。只映射视觉关键元素,
// strong/em 等走浏览器默认;不引入 @tailwindcss/typography(依赖与样式都可控)
const mdComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-2 mt-4 text-base font-semibold text-content-primary first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-[15px] font-semibold text-content-primary first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-sm font-semibold text-content-primary first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1.5 mt-3 text-sm font-semibold text-content-secondary first:mt-0">{children}</h4>
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
    return <p className="my-2 first:mt-0 last:mb-0">{children}</p>
  },
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
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
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-code-header/50">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-line px-2.5 py-1.5 text-left font-medium text-content-secondary">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-line px-2.5 py-1.5 align-top">{children}</td>,
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-lg border border-line bg-code-bg p-3 text-[13px] leading-relaxed">
      {children}
    </pre>
  ),
  // 行内 code 样式;块级 code 在 pre 内由 globals.css 的 .rich-md pre code 覆盖为无背景无边框
  code: ({ children }) => (
    <code className="rounded border border-line bg-code-bg px-1 py-0.5 font-mono text-[13px]">{children}</code>
  ),
  img: ({ src, alt }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt ?? ''} className="my-2 max-w-full rounded-lg border border-line" />
  ),
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

function RichMarkdown({ content }: { content: string }) {
  // 插件数组引用固定(memo),避免父组件重渲染导致 ReactMarkdown 反复重新解析
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], [])
  const rehypePlugins = useMemo<PluggableList>(() => [[rehypeKatex, { throwOnError: false, strict: false }]], [])
  // 内容稳定后才进富渲染,预处理只跑一次
  const promoted = useMemo(() => promoteStandaloneMath(content), [content])
  return (
    <div className="rich-md">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={mdComponents}
      >
        {promoted}
      </ReactMarkdown>
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
