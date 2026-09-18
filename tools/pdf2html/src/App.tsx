/**
 * 页面骨架:左侧拖拽上传 + 任务卡列表,右侧转换结果预览。
 * 状态收敛在 App,子组件只做展示与回调;任务串行消费避免 worker 过载。
 */
import { useCallback, useRef, useState } from 'react'
import DropZone from './components/DropZone'
import FileCard from './components/FileCard'
import PreviewPane from './components/PreviewPane'
import { convertPdf } from './lib/convert'
import { describePdfError } from './lib/detect'
import type { ConvertJob } from './types'

let idSeq = 0

export default function App() {
  const [jobs, setJobs] = useState<ConvertJob[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const runningRef = useRef(false)
  const queueRef = useRef<{ id: string; file: File }[]>([])

  const patchJob = useCallback((id: string, patch: Partial<ConvertJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)))
  }, [])

  const runQueue = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    while (queueRef.current.length > 0) {
      const task = queueRef.current.shift()!
      try {
        const buf = await task.file.arrayBuffer()
        const result = await convertPdf(buf, task.file.name, (ratio) =>
          patchJob(task.id, { progress: ratio }),
        )
        patchJob(task.id, { status: 'done', progress: 1, result })
      } catch (err) {
        patchJob(task.id, { status: 'error', error: describePdfError(err) })
      }
    }
    runningRef.current = false
  }, [patchJob])

  const handleFiles = useCallback(
    (files: File[]) => {
      const pdfFiles = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
      if (pdfFiles.length === 0) return
      const newJobs: ConvertJob[] = pdfFiles.map((file) => ({
        id: `job-${++idSeq}`,
        fileName: file.name,
        size: file.size,
        status: 'converting',
        progress: 0,
      }))
      setJobs((prev) => [...prev, ...newJobs])
      pdfFiles.forEach((file, i) => queueRef.current.push({ id: newJobs[i].id, file }))
      void runQueue()
    },
    [runQueue],
  )

  const activeJob = jobs.find((j) => j.id === activeId && j.result) ?? null

  return (
    <div className="flex h-screen flex-col bg-neutral-100 text-neutral-800">
      <header className="border-b border-neutral-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold">PDF 转 HTML</h1>
        <p className="mt-0.5 text-xs text-neutral-500">纯本地转换,文件不会离开你的设备</p>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
        <div className="flex w-full min-w-0 flex-col gap-3 lg:w-[380px] lg:shrink-0">
          <DropZone onFiles={handleFiles} />
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {jobs.map((job) => (
              <FileCard
                key={job.id}
                job={job}
                active={job.id === activeId}
                onSelect={() => setActiveId(job.id)}
              />
            ))}
          </div>
        </div>
        <PreviewPane
          result={activeJob?.result ?? null}
          fileName={activeJob?.fileName ?? ''}
        />
      </main>
    </div>
  )
}
