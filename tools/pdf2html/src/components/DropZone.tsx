/** 拖拽/点击上传区:支持多选,非 PDF 文件由 App 侧过滤 */
import { useRef, useState, type DragEvent } from 'react'

interface Props {
  onFiles: (files: File[]) => void
}

export default function DropZone({ onFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    onFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <div
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
        dragging
          ? 'border-neutral-400 bg-neutral-50'
          : 'border-neutral-300 bg-white hover:border-neutral-400'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className="text-sm text-neutral-600">把 PDF 拖到这里,或点击选择文件</div>
      <div className="mt-1 text-xs text-neutral-400">支持多选,转换全程在本地完成</div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </div>
  )
}
