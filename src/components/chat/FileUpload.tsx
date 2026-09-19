'use client'

import { useState, useRef, useCallback, DragEvent } from 'react'
import { Paperclip, X, Upload, FileText, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type { Attachment } from '@/lib/attachment-types'
import type { Attachment } from '@/lib/attachment-types'

interface UploadingFile {
  id: string
  name: string
  progress: number
  status: 'uploading' | 'done' | 'error'
  error?: string
}

interface FileUploadProps {
  attachments: Attachment[]
  onAttachmentsChange: React.Dispatch<React.SetStateAction<Attachment[]>>
  disabled?: boolean
  /** 隐藏已上传附件的预览(由 ChatInput 顶部统一展示),仅保留上传中进度 */
  hideAttachmentsPreview?: boolean
  /** 视觉变体: 'icon'(默认) 28px 圆形图标按钮; 'pill' 带文字的胶囊按钮(输入框下方) */
  variant?: 'icon' | 'pill'
  /** pill 变体的样式覆盖(twMerge 合并,后写优先),用于会话页紧凑胶囊 */
  pillClassName?: string
}

export function deleteUploadedFile(url: string) {
  try {
    const name = url.split('/').pop()
    if (!name) return
    fetch(`/api/upload?file=${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {
      // 删除失败不影响主流程,孤儿清理会兜底
    })
  } catch {
    // 忽略
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatChars(count: number): string {
  if (count < 1000) return `${count} 字`
  return `${(count / 1000).toFixed(1)}k 字`
}

function uploadFile(file: File, onProgress: (pct: number) => void): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    formData.append('file', file)

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new Error('Invalid response'))
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText)
          reject(new Error(err.error || 'Upload failed'))
        } catch {
          reject(new Error('Upload failed'))
        }
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Network error')))
    xhr.open('POST', '/api/upload')
    xhr.send(formData)
  })
}

let idCounter = 0

export function FileUpload({
  attachments,
  onAttachmentsChange,
  disabled,
  hideAttachmentsPreview = false,
  variant = 'icon',
  pillClassName,
}: FileUploadProps) {
  const [uploading, setUploading] = useState<UploadingFile[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files)
      if (fileArray.length === 0) return

      const tasks = fileArray.map(async (file) => {
        const id = `upload-${++idCounter}`
        const entry: UploadingFile = { id, name: file.name, progress: 0, status: 'uploading' }
        setUploading((prev) => [...prev, entry])

        try {
          const result = await uploadFile(file, (pct) => {
            setUploading((prev) =>
              prev.map((u) => (u.id === id ? { ...u, progress: pct } : u))
            )
          })
          setUploading((prev) => prev.filter((u) => u.id !== id))
          // 函数式更新,避免并发上传时覆盖彼此的结果
          onAttachmentsChange((prev) => [...prev, result])
        } catch (err) {
          setUploading((prev) =>
            prev.map((u) =>
              u.id === id
                ? { ...u, status: 'error', error: (err as Error).message }
                : u
            )
          )
          // Remove error entries after 3 seconds
          setTimeout(() => {
            setUploading((prev) => prev.filter((u) => u.id !== id))
          }, 3000)
        }
      })

      await Promise.all(tasks)
    },
    [onAttachmentsChange]
  )

  function handleRemove(index: number) {
    const removed = attachments[index]
    onAttachmentsChange((prev) => prev.filter((_, i) => i !== index))
    // 移除未发送的附件时同步删除服务端文件(已发送的文件会被接口拒绝删除)
    if (removed) {
      deleteUploadedFile(removed.url)
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(true)
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,text/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files)
          e.target.value = '' // reset
        }}
      />

      {/* Attachments preview */}
      {(!hideAttachmentsPreview || uploading.length > 0) &&
        (attachments.length > 0 || uploading.length > 0) && (
          <div className="flex flex-wrap gap-2 px-1">
            {!hideAttachmentsPreview &&
              attachments.map((att, idx) => (
                <div
                  key={att.url + idx}
                  className={cn(
                    'relative group flex items-center gap-2 rounded-lg border',
                    'border-line bg-surface-muted',
                    'px-2 py-1.5 max-w-[180px]'
                  )}
                >
                  {att.type.startsWith('image/') ? (
                    <ImageIcon className="w-4 h-4 text-content-secondary shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-content-muted shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-content-primary truncate">
                      {att.name}
                    </p>
                    {att.type === 'application/pdf' ? (
                      att.parseStatus === 'failed' ? (
                        <p className="text-[10px] text-red-500 truncate">
                          解析失败{att.parseError ? `：${att.parseError}` : ''}
                        </p>
                      ) : (
                        <p className="text-[10px] text-content-muted">
                          {att.pageCount ?? '?'} 页 · {formatChars(att.charCount ?? 0)}
                        </p>
                      )
                    ) : (
                      <p className="text-[10px] text-content-muted">
                        {formatSize(att.size)}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemove(idx)}
                    className={cn(
                      'shrink-0 p-0.5 rounded-md transition-colors',
                      'opacity-0 show-on-touch group-hover:opacity-100',
                      'hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500'
                    )}
                    aria-label="移除文件"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

          {uploading.map((u) => (
            <div
              key={u.id}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-2 py-1.5 max-w-[180px]',
                u.status === 'error'
                  ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30'
                  : 'border-line bg-surface-muted'
              )}
            >
              <Upload className={cn('w-4 h-4 shrink-0', u.status === 'error' ? 'text-red-400' : 'text-content-muted animate-pulse')} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-content-primary truncate">{u.name}</p>
                {u.status === 'uploading' && (
                  <div className="mt-0.5 w-full h-1 rounded-full bg-surface-subtle overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all duration-200"
                      style={{ width: `${u.progress}%` }}
                    />
                  </div>
                )}
                {u.status === 'error' && (
                  <p className="text-[10px] text-red-500">{u.error}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drag overlay hint / attach button row */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative',
          dragging && 'ring-2 ring-line-strong rounded-lg bg-surface-muted/50'
        )}
      >
        <button
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className={cn(
            'flex items-center justify-center transition-colors',
            variant === 'pill'
              ? cn(
                  // 胶囊态: 与相邻胶囊同规格(h-8 全圆角 + 细边框);pillClassName 可覆盖为紧凑款
                  'gap-1.5 h-8 px-3.5 rounded-full border text-xs font-medium shrink-0',
                  'border-line bg-surface text-content-secondary',
                  'hover:bg-surface-subtle hover:text-content-primary hover:border-line-strong',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  pillClassName
                )
              : cn(
                  // 图标态: 28px 圆形按钮(输入框内联使用)
                  'h-7 w-7 rounded-full',
                  'text-content-muted hover:text-content-primary',
                  'hover:bg-surface-subtle',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )
          )}
          aria-label="添加附件"
          title="添加附件 (图片、文本、PDF, 最大10MB)"
        >
          <Paperclip className="w-3.5 h-3.5" />
          {variant === 'pill' && <span>上传附件</span>}
        </button>

        {dragging && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-content-secondary font-medium">松开以上传文件</p>
          </div>
        )}
      </div>
    </div>
  )
}
