/** 右侧预览:iframe srcdoc 渲染转换产物;文本模式关脚本防注入,AI 产物需放行脚本让 MathJax 渲染公式 */
import type { ConvertResult } from '../types'

interface Props {
  result: ConvertResult | null
  fileName: string
}

export default function PreviewPane({ result, fileName }: Props) {
  if (!result) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-neutral-200 bg-white">
        <p className="text-sm text-neutral-400">转换完成后在这里预览</p>
      </div>
    )
  }
  // AI 产物含 MathJax,需要脚本+同源(localStorage);模型输出的 <script> 已在片段清洗层全部剥除
  const sandbox = result.html.includes('MathJax') ? 'allow-scripts allow-same-origin' : ''
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="shrink-0 border-b border-neutral-100 px-4 py-2.5 text-xs text-neutral-500">
        预览:{fileName} → {result.title}.html
      </div>
      <iframe
        title="HTML 预览"
        sandbox={sandbox}
        srcDoc={result.html}
        className="min-h-0 w-full flex-1"
      />
    </div>
  )
}
