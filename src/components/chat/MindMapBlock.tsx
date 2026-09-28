'use client'

/**
 * 思维导图块: 把 ```mindmap 围栏里的 Markdown 大纲渲染成可交互导图。
 *
 * 体积取舍: 只装 markmap-view(约 27KB gz)。markmap-lib 虽能直接吃 Markdown,
 * 但会连带 markdown-it / katex 0.16 / highlight.js / prism 再打一份 —— 与项目
 * 现有 remark/rehype/katex 链路完全重复,故大纲解析自写(只需标题+缩进列表)。
 * KaTeX(约 76KB gz)同理按需加载:大纲里真的出现 $公式$ 时才去取,普通大纲不背。
 *
 * 安全: 节点内容是模型输出,统一 escapeHtml 后只放行受控的 code/strong/公式,
 * 不引原始 HTML(markmap 用 innerHTML 注入 content,不转义就是 XSS 面)。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Copy } from 'lucide-react'
import { toast } from '@/lib/toast'
import type { INode, IPureNode } from 'markmap-common'
import type { IMarkmapOptions, Markmap } from 'markmap-view'

const LIGHT_PALETTE = ['#3f3f46', '#71717a', '#a1a1aa', '#c7c7cd']
const DARK_PALETTE = ['#d4d4d8', '#a1a1aa', '#71717a', '#52525b']

// ── Markdown 大纲 → markmap 数据树 ──────────────────────────────────

type TexRenderer = (tex: string) => string

interface OutlineItem {
  depth: number
  content: string
  children: OutlineItem[]
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 行内标记: `$公式$`(KaTeX) / `` `code` `` / **粗体**;公式先抽成哨兵占位,避免被转义和加粗规则误伤 */
function inlineHtml(text: string, renderTex: TexRenderer | null): string {
  const formulas: string[] = []
  let s = text.replace(/\$([^$\n]+?)\$/g, (raw, tex: string) => {
    if (!renderTex) return raw
    let html: string
    try {
      html = renderTex(tex)
    } catch {
      html = escapeHtml(raw)
    }
    formulas.push(html)
    return `\u0000${formulas.length - 1}\u0000`
  })
  s = escapeHtml(s)
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => formulas[Number(i)] ?? '')
}

function toPureNode(item: OutlineItem): IPureNode {
  return { content: item.content, children: item.children.map(toPureNode) }
}

/**
 * 解析面具约定的输出结构: `## 主题` 标题 + 两空格缩进列表。
 * 标题定层级基准(首个标题为根),列表项的深度 = 最近标题层 + 缩进层。
 */
function parseOutline(source: string, renderTex: TexRenderer | null): IPureNode {
  const items: OutlineItem[] = []
  let headingBase = -1

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    const text = line.trim()
    if (!text || /^`{3,}/.test(text)) continue

    const heading = /^(#{1,6})\s+(.+)$/.exec(text)
    if (heading) {
      headingBase = heading[1].length - 1
      items.push({ depth: headingBase, content: inlineHtml(heading[2].trim(), renderTex), children: [] })
      continue
    }

    const bullet = /^([ \t]*)(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line)
    if (bullet) {
      const indent = bullet[1].replace(/\t/g, '  ').length
      const base = headingBase < 0 ? 0 : headingBase + 1
      items.push({
        depth: base + Math.floor(indent / 2),
        content: inlineHtml(bullet[2].trim(), renderTex),
        children: [],
      })
      continue
    }

    // 兜底: 非结构化行(模型偶尔补一句说明)并入上一节点;没有任何节点时自成根
    if (items.length) items[items.length - 1].content += ' ' + inlineHtml(text, renderTex)
    else items.push({ depth: 0, content: inlineHtml(text, renderTex), children: [] })
  }

  if (!items.length) return { content: '（空大纲）', children: [] }

  const root: OutlineItem = { depth: -1, content: '', children: [] }
  const stack: OutlineItem[] = [root]
  for (const item of items) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= item.depth) stack.pop()
    stack[stack.length - 1].children.push(item)
    stack.push(item)
  }

  const tops = root.children
  if (tops.length === 1) return toPureNode(tops[0])
  // 退化输出(整篇没有标题): 首个顶层项提升为根,其余挂到它下面,内容零丢失
  const [first, ...rest] = tops
  first.children = [...first.children, ...rest]
  return toPureNode(first)
}

function cloneTree(node: IPureNode): IPureNode {
  return { ...node, payload: { ...node.payload }, children: node.children.map(cloneTree) }
}

/** 从第 from 层起折叠(from 按本树自身层级,根为 0) */
function foldFrom(node: IPureNode, from: number, depth = 0): void {
  node.payload = { ...node.payload, fold: depth >= from ? 1 : 0 }
  node.children.forEach((c) => foldFrom(c, from, depth + 1))
}

function countNodes(node: IPureNode): number {
  return 1 + node.children.reduce((n, c) => n + countNodes(c), 0)
}

// ── 组件 ────────────────────────────────────────────────────────────

function optionsFor(dark: boolean): Partial<IMarkmapOptions> {
  const palette = dark ? DARK_PALETTE : LIGHT_PALETTE
  return {
    color: (node: INode) =>
      palette[Math.min(Math.max(node.state.depth - 1, 0), palette.length - 1)],
    duration: 320,
    maxWidth: 200,
    spacingHorizontal: 84,
    spacingVertical: 10,
    paddingX: 8,
    autoFit: true,
    fitRatio: 0.94,
    maxInitialScale: 1.5,
    // 折叠状态完全由 payload.fold 掌握,关掉按层级自动折叠
    initialExpandLevel: 999,
    zoom: true,
    // 聊天流里不要抢页面滚动: 平移只认拖拽,滚轮缩放只认 Ctrl/⌘ + 滚轮
    pan: false,
    scrollForPan: true,
    toggleRecursively: false,
  }
}

const MindMapBlock = memo(function MindMapBlock({ source }: { source: string }) {
  const [tree, setTree] = useState<IPureNode | null>(null)
  const [dark, setDark] = useState(false)
  const [failed, setFailed] = useState(false)

  const svgRef = useRef<SVGSVGElement | null>(null)
  const mmRef = useRef<Markmap | null>(null)

  const nodeCount = useMemo(() => (tree ? countNodes(tree) : 0), [tree])
  const height = tree ? Math.min(520, Math.max(220, (nodeCount + 1) * 22)) : 220

  // 解析大纲: 只有真出现 $公式$ 时才去取 KaTeX,普通大纲零额外字节
  useEffect(() => {
    let alive = true
    const build = (renderTex: TexRenderer | null) => {
      if (alive) setTree(parseOutline(source, renderTex))
    }
    if (!source.includes('$')) {
      build(null)
      return () => {
        alive = false
      }
    }
    void (async () => {
      try {
        const mod = await import('katex')
        const renderToString = mod.default?.renderToString ?? mod.renderToString
        build((tex) => renderToString(tex, { throwOnError: false, output: 'html' }))
      } catch (err) {
        console.error('[MindMapBlock] katex load failed:', err)
        build(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [source])

  // 主题跟随: 线条/圆点是渲染期写死的 SVG 属性,切主题只能重建整个图
  useEffect(() => {
    const el = document.documentElement
    const sync = () => setDark(el.classList.contains('dark'))
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !tree) return
    let alive = true
    let mm: Markmap | null = null
    void (async () => {
      try {
        const { Markmap } = await import('markmap-view')
        if (!alive) return
        svg.innerHTML = ''
        mm = Markmap.create(svg, optionsFor(dark), tree)
        mmRef.current = mm
      } catch (err) {
        console.error('[MindMapBlock] render failed:', err)
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
      mmRef.current = null
      mm?.destroy()
    }
  }, [tree, dark])

  // markmap 自带的 ResizeObserver 只盯节点尺寸;容器变宽变窄后需要重新贴合视口
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || failed) return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => void mmRef.current?.fit())
    })
    ro.observe(svg)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [failed])

  const applyFold = useCallback(
    (from: number) => {
      const mm = mmRef.current
      if (!mm || !tree) return
      const next = cloneTree(tree)
      foldFrom(next, from)
      void mm.setData(next)
    },
    [tree],
  )

  const handleCopy = useCallback(() => {
    if (!navigator.clipboard?.writeText) {
      toast.error('当前浏览器不支持自动复制', { title: '复制失败' })
      return
    }
    navigator.clipboard
      .writeText(source)
      .then(() => toast.success('已复制大纲', { title: '复制' }))
      .catch((err) => {
        console.error('[MindMapBlock] copy failed:', err)
        toast.error('复制失败', { title: '复制' })
      })
  }, [source])

  const btnCls =
    'px-1.5 py-0.5 rounded-md text-[11px] text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors'

  const svgStyle = {
    height,
    '--markmap-font': '400 13px/19px var(--font-sans)',
    '--markmap-text-color': 'rgb(var(--content-primary))',
    '--markmap-max-width': '200px',
  } as CSSProperties

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-line bg-code-bg">
      <div className="flex items-center justify-between gap-2 pl-3 pr-1.5 py-1 bg-code-header border-b border-line">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-[10px] text-content-muted font-mono uppercase tracking-wider truncate select-none">
            mindmap
          </span>
          <span className="hidden sm:inline text-[10px] text-content-muted/70 truncate select-none">
            {nodeCount} 节点 · 拖拽平移 · Ctrl 滚轮缩放
          </span>
        </span>
        <div className="flex items-center gap-0.5 shrink-0">
          <button type="button" onClick={() => applyFold(999)} className={btnCls} title="展开全部节点">
            展开全部
          </button>
          <button type="button" onClick={() => applyFold(1)} className={btnCls} title="只保留一级分支">
            收起到一层
          </button>
          <button
            type="button"
            onClick={handleCopy}
            title="复制大纲"
            aria-label="复制大纲"
            className="p-1.5 rounded-md text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {failed ? (
        <pre className="p-3 overflow-x-auto text-[13px] leading-relaxed whitespace-pre-wrap">{source}</pre>
      ) : (
        <svg
          ref={svgRef}
          role="img"
          aria-label="思维导图"
          className="block w-full"
          style={svgStyle}
        />
      )}
    </div>
  )
})

export default MindMapBlock
