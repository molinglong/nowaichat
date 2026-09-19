/**
 * 页面骨架:左侧拖拽上传 + 任务卡列表,右侧转换结果预览。
 * 顶部切换文本/AI 两种管线;任务串行消费,AI 任务可取消。
 */
import { useCallback, useRef, useState } from 'react'
import DropZone from './components/DropZone'
import FileCard from './components/FileCard'
import PreviewPane from './components/PreviewPane'
import SettingsPanel from './components/SettingsPanel'
import { describeAiError } from './lib/ai/client'
import { isAiConfigured, loadAiSettings, saveAiSettings, type AiSettings } from './lib/ai/settings'
import { convertPdf } from './lib/convert'
import { convertPdfWithAi } from './lib/convert-ai'
import { describePdfError } from './lib/detect'
import type { AiProgress, ConvertJob, ConvertMode } from './types'

let idSeq = 0

export default function App() {
  const [jobs, setJobs] = useState<ConvertJob[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [mode, setMode] = useState<ConvertMode>('text')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aiSettings, setAiSettings] = useState<AiSettings>(() => loadAiSettings())
  const runningRef = useRef(false)
  const queueRef = useRef<{ id: string; file: File; mode: ConvertMode }[]>([])
  const abortMapRef = useRef(new Map<string, AbortController>())

  const patchJob = useCallback((id: string, patch: Partial<ConvertJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)))
  }, [])

  const patchAi = useCallback(
    (id: string, ai: AiProgress) => patchJob(id, { ai }),
    [patchJob],
  )

  const runQueue = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    while (queueRef.current.length > 0) {
      const task = queueRef.current.shift()!
      const controller = new AbortController()
      abortMapRef.current.set(task.id, controller)
      try {
        const buf = await task.file.arrayBuffer()
        if (task.mode === 'ai') {
          const settings = loadAiSettings()
          if (!isAiConfigured(settings)) {
            throw new Error('AI 模式尚未配置接口,请先点击右上角「接口设置」')
          }
          const result = await convertPdfWithAi(buf, task.file.name, settings, {
            onProgress: (ai) => patchAi(task.id, ai),
            signal: controller.signal,
          })
          patchJob(task.id, { status: 'done', progress: 1, result })
        } else {
          const result = await convertPdf(buf, task.file.name, (ratio) =>
            patchJob(task.id, { progress: ratio }),
          )
          patchJob(task.id, { status: 'done', progress: 1, result })
        }
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError'
        const message = aborted
          ? '已取消'
          : task.mode === 'ai'
            ? describeAiError(err)
            : describePdfError(err)
        patchJob(task.id, { status: 'error', error: message })
      } finally {
        abortMapRef.current.delete(task.id)
      }
    }
    runningRef.current = false
  }, [patchAi, patchJob])

  const handleFiles = useCallback(
    (files: File[]) => {
      const pdfFiles = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
      if (pdfFiles.length === 0) return
      const jobMode = mode
      const newJobs: ConvertJob[] = pdfFiles.map((file) => ({
        id: `job-${++idSeq}`,
        fileName: file.name,
        size: file.size,
        status: 'converting',
        mode: jobMode,
        progress: 0,
      }))
      setJobs((prev) => [...prev, ...newJobs])
      pdfFiles.forEach((file, i) => queueRef.current.push({ id: newJobs[i].id, file, mode: jobMode }))
      void runQueue()
    },
    [mode, runQueue],
  )

  const handleCancel = useCallback((id: string) => {
    abortMapRef.current.get(id)?.abort()
  }, [])

  const handleSaveSettings = useCallback((settings: AiSettings) => {
    saveAiSettings(settings)
    setAiSettings(settings)
    setSettingsOpen(false)
  }, [])

  const activeJob = jobs.find((j) => j.id === activeId && j.result) ?? null

  const modeBtnCls = (active: boolean) =>
    `rounded-md px-3 py-1.5 transition-colors ${
      active ? 'bg-neutral-800 text-white' : 'text-neutral-600 hover:text-neutral-900'
    }`

  return (
    <div className="flex h-screen flex-col bg-neutral-100 text-neutral-800">
      <header className="border-b border-neutral-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">PDF 转 HTML</h1>
            <p className="mt-0.5 text-xs text-neutral-500">
              {mode === 'ai'
                ? 'AI 结构化:整页截图交由视觉模型转录成语义 HTML + LaTeX,质量最高(消耗 token)'
                : '纯本地文本提取,文件不会离开你的设备'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 text-sm">
              <button className={modeBtnCls(mode === 'text')} onClick={() => setMode('text')}>
                文本模式
              </button>
              <button className={modeBtnCls(mode === 'ai')} onClick={() => setMode('ai')}>
                AI 结构化
              </button>
            </div>
            <button
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                isAiConfigured(aiSettings)
                  ? 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                  : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
              }`}
              onClick={() => setSettingsOpen(true)}
            >
              接口设置
            </button>
          </div>
        </div>
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
                onCancel={() => handleCancel(job.id)}
              />
            ))}
          </div>
        </div>
        <PreviewPane
          result={activeJob?.result ?? null}
          fileName={activeJob?.fileName ?? ''}
        />
      </main>
      <SettingsPanel
        open={settingsOpen}
        initial={aiSettings}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
      />
    </div>
  )
}
