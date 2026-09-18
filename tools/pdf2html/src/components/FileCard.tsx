/** 单文件任务卡:状态/进度/质量提示与下载入口,点击切换右侧预览 */
import type { ConvertJob } from '../types'

interface Props {
  job: ConvertJob
  active: boolean
  onSelect: () => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function downloadHtml(job: ConvertJob) {
  if (!job.result) return
  const blob = new Blob([job.result.html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = job.fileName.replace(/\.pdf$/i, '') + '.html'
  a.click()
  URL.revokeObjectURL(url)
}

export default function FileCard({ job, active, onSelect }: Props) {
  const warnCount =
    (job.result?.warnings.length ?? 0) +
    (job.result?.pages.reduce((sum, p) => sum + (p.warnings?.length ?? 0), 0) ?? 0)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect()
      }}
      className={`cursor-pointer rounded-xl border bg-white px-4 py-3 text-left transition-colors ${
        active ? 'border-neutral-400' : 'border-neutral-200 hover:border-neutral-300'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{job.fileName}</span>
        {job.status === 'done' && (
          <span
            className="shrink-0 rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
            onClick={(e) => {
              e.stopPropagation()
              downloadHtml(job)
            }}
          >
            下载 HTML
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
        <span>{formatSize(job.size)}</span>
        {job.status === 'converting' && (
          <span className="text-neutral-400">转换中 {Math.round(job.progress * 100)}%</span>
        )}
        {job.status === 'done' && (
          <>
            <span>{job.result?.pageCount} 页</span>
            {warnCount > 0 && <span className="text-amber-600">{warnCount} 条质量提示</span>}
          </>
        )}
        {job.status === 'error' && <span className="text-red-500">{job.error}</span>}
      </div>
      {job.status === 'converting' && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-neutral-400 transition-all"
            style={{ width: `${job.progress * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}
