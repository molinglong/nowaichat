/** 右侧预览:iframe srcdoc 渲染转换产物,sandbox 关脚本防注入 */
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
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="shrink-0 border-b border-neutral-100 px-4 py-2.5 text-xs text-neutral-500">
        预览:{fileName} → {result.title}.html
      </div>
      <iframe
        title="HTML 预览"
        sandbox=""
        srcDoc={result.html}
        className="min-h-0 w-full flex-1"
      />
    </div>
  )
}
