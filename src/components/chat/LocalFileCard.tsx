'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getIsTauri } from '@/lib/tauri'
import {
  ArrowRightLeft,
  Check,
  ExternalLink,
  FilePlus2,
  FileText,
  FolderOpen,
  ListTree,
  Loader2,
  Pencil,
  Search,
  ShieldAlert,
  Terminal,
  Trash2,
  TriangleAlert,
  Undo2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  toLocalFileView,
  isLocalFileOutput,
  isExecAutoAllowed,
  type LocalFileToolOutput,
  type LocalFileDecision,
} from '@/lib/ai/local-file-tool'
import { fileExists, revealFile, undoFile } from '@/lib/tauri-files'
import { toast } from '@/lib/toast'
import type { ToolCallView } from './ToolCallCard'

/**
 * 本地文件操作卡片 —— 渲染 local_file 工具调用(AI 在授权工作区内生成/删除文件)。
 *
 * 判定以"是否有结构化结果对象 out"为主轴,兼容两种数据来源:
 * - 实时(tool part):create 由 onToolCall 自动执行→回填 out;delete 停在 input-available
 *   等待用户在卡片上确认,批准后 ChatPanel 执行删除并回填 out。
 * - 历史(metadata 回放):服务端对无 execute 工具只落 input、output 恒为 null,故 out=null,
 *   落"中性只读"分支——只展示动作与路径,不臆造成败(真实结果见后续助手回复)。
 *
 * 分支优先级:out(结果) > output-error(SDK 错误) > input-streaming(骨架)
 *   > input-available(实时待处理:delete 确认 / create 写入中) > 历史中性兜底。
 */
interface LocalFileCardProps {
  view: ToolCallView
  /** 决策回调(批准/拒绝);缺省(如历史回放)时待确认态只读、不显示按钮 */
  onDecision?: (
    toolCallId: string,
    path: string,
    approved: boolean,
    decision: LocalFileDecision
  ) => void
}

const CONTAINER = 'rounded-lg border border-line/60 bg-surface-muted overflow-hidden text-xs'

/** 各动作的动词与图标:结果态/执行中/历史兜底三处共用 */
const ACTION_META: Record<string, { verb: string; icon: typeof FilePlus2 }> = {
  create: { verb: '生成', icon: FilePlus2 },
  delete: { verb: '删除', icon: Trash2 },
  read: { verb: '读取', icon: FileText },
  list: { verb: '列目录', icon: FolderOpen },
  edit: { verb: '修改', icon: Pencil },
  move: { verb: '移动', icon: ArrowRightLeft },
  exec: { verb: '执行', icon: Terminal },
  overview: { verb: '概览', icon: ListTree },
  search: { verb: '搜索', icon: Search },
}

function LocalFileCardInner({ view, onDecision }: LocalFileCardProps) {
  const info = useMemo(() => toLocalFileView(view.input), [view.input])
  const [busy, setBusy] = useState(false)

  const isDelete = info.action === 'delete'
  const out: LocalFileToolOutput | null = isLocalFileOutput(view.output) ? view.output : null
  const relPath = info.path
  const meta = ACTION_META[info.action]
  const verb = meta?.verb ?? '操作'
  const ActionIcon = meta?.icon ?? FilePlus2

  // 覆盖确认检查:create 停在待执行态时查目标是否存在——存在则升级为覆盖确认卡
  // (ChatPanel 对已存在目标不自动写入,停等本卡片决策),不存在则保持"写入中"转圈。
  // hooks 必须在所有分支 return 之前,故置于组件顶部。
  const pendingCreate = view.state === 'input-available' && info.action === 'create' && !out
  const [coverExists, setCoverExists] = useState(false)
  useEffect(() => {
    if (!pendingCreate) return
    let cancelled = false
    setCoverExists(false)
    void fileExists(relPath).then((r) => {
      if (!cancelled) setCoverExists(r.exists)
    })
    return () => {
      cancelled = true
    }
  }, [pendingCreate, relPath])

  // exec 待处理:非白名单命令停在待执行态升级为确认卡(白名单命令由 ChatPanel 直接自动执行,
  // 卡片只短暂经过"正在执行命令…"态);判定复用与 ChatPanel 同一纯函数,双端一致。
  // "命令始终运行"开启时 ChatPanel 对所有命令直接执行,这里读同一 react-query 缓存
  // 同步免确认,避免确认卡在结果回填前一闪而过
  const lfSettingsQuery = useQuery<{
    localFilesEnabled: boolean
    localFilesExecAutoRun?: boolean
  }>({
    queryKey: ['settings', 'local-files'],
    queryFn: () => fetch('/api/settings/local-files').then((r) => r.json()),
    enabled: getIsTauri(),
    retry: false,
    staleTime: 60_000,
  })
  const execAutoRun = lfSettingsQuery.data?.localFilesExecAutoRun ?? false
  const pendingExec = view.state === 'input-available' && info.action === 'exec' && !out
  const execNeedsConfirm =
    pendingExec && !!info.command && !execAutoRun && !isExecAutoAllowed(info.command)

  // 打开所在位置(explorer /select):纯 UI 动作,失败仅 toast 不打断对话
  const handleReveal = () => {
    // move 后源路径已不存在,用目标路径定位
    const p = info.action === 'move' && info.toPath ? info.toPath : relPath
    if (!p) return
    void revealFile(p).then((r) => {
      if (!r.ok) toast.error(r.error || '打开位置失败')
    })
  }

  // 一键撤销:覆盖写入/编辑把文件恢复到操作前内容;新建文件移入回收站。
  // 纯 UI 动作不进对话链路;撤销后卡片定格为已撤销,不再重复触发
  const [undone, setUndone] = useState(false)
  const [undoBusy, setUndoBusy] = useState(false)
  const canUndo =
    out?.ok !== false &&
    out?.denied !== true &&
    !undone &&
    !!out?.undoId &&
    (info.action === 'edit' || info.action === 'create')
  const handleUndo = () => {
    if (!out?.undoId || undone || undoBusy) return
    setUndoBusy(true)
    void undoFile(out.undoId).then((r) => {
      setUndoBusy(false)
      if (r.ok) {
        setUndone(true)
        toast.success('已撤销，文件已恢复到操作前状态')
      } else {
        toast.error(r.error || '撤销失败')
      }
    })
  }

  const decide = (approved: boolean) => {
    if (!view.toolCallId || busy || !onDecision) return
    setBusy(true)
    onDecision(view.toolCallId, relPath, approved, {
      action: info.action === 'create' ? 'create' : info.action === 'exec' ? 'exec' : 'delete',
      content: info.content || undefined,
      command: info.action === 'exec' ? info.command : undefined,
    })
  }

  // ---- A. 已有结构化结果(实时回填后)----
  if (out) {
    const denied = out.denied === true
    const failed = out.ok === false
    let Icon = Check
    let iconCls = 'text-content-muted'
    let head = ''
    if (failed) {
      Icon = TriangleAlert
      iconCls = 'text-red-500'
      head = `${verb}未生效`
    } else if (denied) {
      Icon = ShieldAlert
      iconCls = 'text-amber-500'
      head = isDelete ? '已拒绝删除' : info.action === 'exec' ? '已拒绝执行' : '已拒绝覆盖'
    } else if (isDelete) {
      head = '已移入回收站'
    } else if (info.action === 'read') {
      head = '已读取文件'
    } else if (info.action === 'list') {
      head = '已列出目录'
    } else if (info.action === 'edit') {
      head = '已修改文件'
    } else if (info.action === 'move') {
      head = '已移动文件'
    } else if (info.action === 'exec') {
      head = `命令已执行 · 退出码 ${typeof out.exitCode === 'number' ? out.exitCode : '?'}`
    } else if (info.action === 'overview') {
      head = '已生成目录树'
    } else if (info.action === 'search') {
      head = `已搜索 · 命中 ${typeof out.hits === 'number' ? out.hits : '?'} 处`
    } else {
      head = '已生成文件'
    }
    const abs = out.absPath ?? relPath
    let detail: string
    if (failed) {
      detail = out.error || '操作失败'
    } else if (isDelete) {
      detail = abs
    } else if (info.action === 'read') {
      const lines = typeof out.totalLines === 'number' ? ` · 共 ${out.totalLines} 行` : ''
      const more =
        typeof out.nextOffset === 'number'
          ? ` · 未完,可从第 ${out.nextOffset} 行续读`
          : out.truncated
            ? ' · 内容过长已截断'
            : ''
      detail = `${relPath} · ${typeof out.bytes === 'number' ? `${out.bytes} 字节` : ''}${lines}${more}`
    } else if (info.action === 'list' && Array.isArray(out.entries)) {
      const names = out.entries.map((e) => (e.kind === 'dir' ? `${e.name}/` : e.name))
      const preview = names.slice(0, 6).join('  ')
      detail =
        `${out.entries.length} 项${out.truncated ? '(已截断)' : ''}` +
        (preview ? ` · ${preview}${names.length > 6 ? ' …' : ''}` : '')
    } else if (info.action === 'move') {
      detail = `${relPath} → ${abs}`
    } else if (info.action === 'exec') {
      detail = `耗时 ${typeof out.durationMs === 'number' ? out.durationMs : '?'}ms${out.truncated ? ' · 输出已截断' : ''}`
    } else if (info.action === 'overview') {
      detail = `${typeof out.totalFiles === 'number' ? out.totalFiles : '?'} 个文件 / ${typeof out.totalDirs === 'number' ? out.totalDirs : '?'} 个目录${out.truncated ? ' · 已截断' : ''}`
    } else if (info.action === 'search') {
      detail = `扫描 ${typeof out.scannedFiles === 'number' ? out.scannedFiles : '?'} 个文件${out.truncated ? ' · 已截断' : ''}${info.pattern ? ` · “${info.pattern}”` : ''}`
    } else {
      detail = `${abs}${typeof out.bytes === 'number' ? ` · ${out.bytes} 字节` : ''}`
    }
    return (
      <div className={CONTAINER}>
        <div className="flex items-start gap-1.5 px-2.5 py-1.5">
          <Icon className={cn('w-3.5 h-3.5 shrink-0 mt-0.5', iconCls)} />
          <div className="min-w-0 flex-1">
            <div className={cn('truncate', failed ? 'text-red-500' : 'text-content-primary')}>
              {head}
              {!failed && !denied && relPath ? (
                <span className="text-content-secondary"> · {relPath}</span>
              ) : null}
            </div>
            {detail && (
              <div
                className={cn(
                  'mt-0.5 break-all font-mono text-[11px] leading-relaxed',
                  failed ? 'text-red-500/90' : 'text-content-muted'
                )}
              >
                {detail}
              </div>
            )}
            {!denied && info.action === 'exec' && (info.command || out.execOutput) && (
              <div className="mt-1.5 flex min-w-0 flex-col gap-1.5">
                {info.command && (
                  <pre className="max-h-20 overflow-hidden whitespace-pre-wrap break-all rounded-md bg-surface-subtle px-2 py-1.5 font-mono text-[11px] leading-relaxed text-content-secondary">
                    {info.command}
                  </pre>
                )}
                {out.execOutput && (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-subtle px-2 py-1.5 font-mono text-[11px] leading-relaxed text-content-secondary">
                    {out.execOutput}
                  </pre>
                )}
              </div>
            )}
            {!failed && !denied && (info.action === 'overview' || info.action === 'search') && out.text && (
              <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-subtle px-2 py-1.5 font-mono text-[11px] leading-relaxed text-content-secondary">
                {out.text}
              </pre>
            )}
            {!failed && !denied && info.action === 'create' && info.hasContent && (
              <pre className="mt-1.5 max-h-20 overflow-hidden whitespace-pre-wrap break-all rounded-md bg-surface-subtle px-2 py-1.5 font-mono text-[11px] leading-relaxed text-content-secondary">
                {info.content.slice(0, 160)}
                {info.content.length > 160 ? '…' : ''}
              </pre>
            )}
            {!failed && !denied && !isDelete && (relPath || (info.action === 'move' && info.toPath)) && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleReveal}
                  className="inline-flex items-center gap-1 rounded-md border border-line/60 px-2 py-1 text-[11px] text-content-secondary hover:bg-surface-subtle hover:text-content-primary transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  打开位置
                </button>
                {canUndo && (
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={undoBusy}
                    title={info.action === 'edit' ? '恢复本次修改前的内容' : info.hasContent ? '恢复被覆盖前的原文件' : '删除本次新建的文件'}
                    className="inline-flex items-center gap-1 rounded-md border border-line/60 px-2 py-1 text-[11px] text-content-secondary hover:bg-surface-subtle hover:text-content-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {undoBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                    撤销本次操作
                  </button>
                )}
                {undone && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-content-muted">
                    <Undo2 className="w-3 h-3" />
                    已撤销
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ---- B. SDK 层错误(无结果对象)----
  if (view.state === 'output-error') {
    return (
      <div className={CONTAINER}>
        <div className="flex items-start gap-1.5 px-2.5 py-1.5">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-500" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-red-500">{verb}未生效</div>
            <div className="mt-0.5 break-all text-[11px] leading-relaxed text-red-500/90">
              {view.errorText || '操作失败'}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- C. 流式骨架:参数尚未成形 ----
  if (view.state === 'input-streaming') {
    return (
      <div className={CONTAINER}>
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-content-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="truncate">正在准备文件操作…</span>
        </div>
      </div>
    )
  }

  // ---- D. 实时待处理(input-available,无结果对象)----
  if (view.state === 'input-available') {
    // create: 目标已存在时 ChatPanel 不自动写入,这里升级为覆盖确认卡;
    // 目标不存在(或尚未查到)则展示"写入中"直到 out 到达
    if (!isDelete) {
      if (pendingCreate && coverExists) {
        const canAct = !!onDecision && !!view.toolCallId && !busy
        return (
          <div className={cn(CONTAINER, 'border-amber-500/40')}>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-content-secondary border-b border-line/40">
              <TriangleAlert className="w-3.5 h-3.5 shrink-0 text-amber-500" />
              <span className="min-w-0 truncate">AI 请求覆盖已有文件</span>
            </div>
            <div className="px-2.5 py-2 flex flex-col gap-2">
              <div className="break-all font-mono text-[11px] leading-relaxed text-content-primary">
                {relPath || '(未知路径)'}
              </div>
              <p className="text-content-muted leading-relaxed">
                该文件已存在,批准后内容会被完整覆盖(不可还原);拒绝则原文件保持不变。
              </p>
              {busy ? (
                <div className="flex items-center gap-1.5 text-content-muted">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span>正在处理…</span>
                </div>
              ) : (
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => decide(false)}
                    disabled={!canAct}
                    className="inline-flex items-center gap-1 rounded-md border border-line/60 px-3 py-1.5 text-xs text-content-secondary hover:bg-surface-subtle hover:text-content-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    拒绝
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(true)}
                    disabled={!canAct}
                    className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-3 py-1.5 text-xs text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <TriangleAlert className="w-3.5 h-3.5" />
                    批准覆盖
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      }
      if (execNeedsConfirm) {
        const canAct = !!onDecision && !!view.toolCallId && !busy
        return (
          <div className={cn(CONTAINER, 'border-amber-500/40')}>
            <div className="flex items-center gap-1.5 border-b border-line/40 px-2.5 py-1.5 text-content-secondary">
              <Terminal className="w-3.5 h-3.5 shrink-0 text-amber-500" />
              <span className="min-w-0 truncate">AI 请求执行命令</span>
            </div>
            <div className="flex flex-col gap-2 px-2.5 py-2">
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-subtle px-2 py-1.5 font-mono text-[11px] leading-relaxed text-content-primary">
                {info.command || '(空命令)'}
              </pre>
              <p className="leading-relaxed text-content-muted">
                命令将在授权工作区目录内执行。涉及写入、删除、联网等操作请确认安全后批准。
              </p>
              {busy ? (
                <div className="flex items-center gap-1.5 text-content-muted">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  <span>正在处理…</span>
                </div>
              ) : (
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => decide(false)}
                    disabled={!canAct}
                    className="inline-flex items-center gap-1 rounded-md border border-line/60 px-3 py-1.5 text-xs text-content-secondary hover:bg-surface-subtle hover:text-content-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    拒绝
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(true)}
                    disabled={!canAct}
                    className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-3 py-1.5 text-xs text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Terminal className="h-3.5 w-3.5" />
                    批准执行
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      }
      const pendingLabel =
        info.action === 'create'
          ? `正在生成 ${relPath || '文件'} …`
          : info.action === 'read'
            ? `正在读取 ${relPath || '文件'} …`
            : info.action === 'list'
              ? `正在列出 ${relPath || '工作区'} …`
              : info.action === 'overview'
                ? '正在生成目录树…'
                : info.action === 'search'
                  ? `正在搜索 ${info.pattern || '关键词'}…`
                  : info.action === 'edit'
                    ? `正在修改 ${relPath || '文件'} …`
                    : info.action === 'move'
                      ? `正在移动 ${relPath || '文件'} …`
                      : info.action === 'exec'
                        ? '正在执行命令…'
                        : '正在准备文件操作…'
      return (
        <div className={CONTAINER}>
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-content-secondary">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <ActionIcon className="w-3.5 h-3.5 shrink-0 text-content-muted" />
            <span className="truncate">{pendingLabel}</span>
          </div>
        </div>
      )
    }
    // delete: 待确认态(高危操作强制人工确认)
    const canAct = !!onDecision && !!view.toolCallId && !busy
    return (
      <div className={cn(CONTAINER, 'border-amber-500/40')}>
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-content-secondary border-b border-line/40">
          <Trash2 className="w-3.5 h-3.5 shrink-0 text-amber-500" />
          <span className="min-w-0 truncate">AI 请求删除文件</span>
        </div>
        <div className="px-2.5 py-2 flex flex-col gap-2">
          <div className="break-all font-mono text-[11px] leading-relaxed text-content-primary">
            {relPath || '(未知路径)'}
          </div>
          <p className="text-content-muted leading-relaxed">
            删除会把文件移入系统回收站(可还原)。仅在你确认无误后批准。
          </p>
          {busy ? (
            <div className="flex items-center gap-1.5 text-content-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>正在处理…</span>
            </div>
          ) : (
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => decide(false)}
                disabled={!canAct}
                className="inline-flex items-center gap-1 rounded-md border border-line/60 px-3 py-1.5 text-xs text-content-secondary hover:bg-surface-subtle hover:text-content-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                拒绝
              </button>
              <button
                type="button"
                onClick={() => decide(true)}
                disabled={!canAct}
                className="inline-flex items-center gap-1 rounded-md bg-red-500 px-3 py-1.5 text-xs text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                批准删除
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---- E. 历史回放兜底(output-available 但无持久化结果):中性只读,不臆造成败 ----
  return (
    <div className={CONTAINER}>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-content-muted">
        <ActionIcon className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">
          {info.action === 'exec' && info.command
            ? `执行 · ${info.command}`
            : info.action === 'search' && info.pattern
              ? `搜索 · ${info.pattern}${info.glob ? `(${info.glob})` : ''}`
              : `${verb}${info.action === 'list' || info.action === 'move' ? '' : '文件'}${
                  info.action === 'move' && info.toPath ? ` → ${info.toPath}` : ''
                }${relPath ? ` · ${relPath}` : ''}`}
        </span>
      </div>
    </div>
  )
}

export const LocalFileCard = memo(LocalFileCardInner)
