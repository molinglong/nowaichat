'use client'

/**
 * 项目检查卡片 —— 渲染 project_check 工具的结果。
 *
 * 三态(由 view.state 驱动):
 * - 流式/待执行(input-streaming/input-available): 一行式「正在运行检查命令…」+ spinner
 * - 通过(output-available + exitCode===0): 绿色一行「检查通过」+ 命令与耗时
 * - 未通过(ok && exitCode!==0): 红色一行 + 命令与退出码,输出可展开(默认收起)
 * - 未能执行(output-error 或 ok:false): 红色一行 + 原因(白名单拒绝/非桌面端等)
 *
 * AI 改完本地工作区文件后调 project_check → 前端经 Tauri lf_exec 真实运行检查命令
 * → 结果回填模型自修。卡片把验收结论可视化给用户看,配合收工验收门(verify-gate)。
 */
import { memo, useState } from 'react'
import {
  CircleCheck,
  CircleAlert,
  CircleX,
  Loader2,
  ChevronDown,
  ChevronRight,
  Terminal,
} from 'lucide-react'
import { isProjectCheckOutput } from '@/lib/ai/project-check-tool'
import type { ToolCallView } from './ToolCallCard'

interface ProjectCheckCardProps {
  view: ToolCallView
}

function ProjectCheckCardInner({ view }: ProjectCheckCardProps) {
  const [expanded, setExpanded] = useState(false)
  const parsed = isProjectCheckOutput(view.output) ? view.output : null
  const pending = view.state === 'input-streaming' || view.state === 'input-available'
  const input = view.input as { command?: string } | undefined
  const command = typeof input?.command === 'string' ? input.command : ''

  if (pending) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-surface-muted/50 text-xs text-content-secondary">
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-accent" />
        <span className="min-w-0 truncate">
          正在运行检查命令{command ? `:${command}` : '…'}
        </span>
      </div>
    )
  }

  if (view.state === 'output-error' || (parsed !== null && !parsed.ok)) {
    const msg =
      view.state === 'output-error'
        ? view.errorText || '项目检查未能执行'
        : parsed?.error || '项目检查未能执行'
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-500 dark:text-red-400">
        <CircleAlert className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 truncate">检查命令未能执行:{msg}</span>
      </div>
    )
  }

  const exitCode = parsed?.exitCode ?? 0
  const duration = parsed?.durationMs
  const durationText = typeof duration === 'number' && duration > 0 ? ` · ${(duration / 1000).toFixed(1)}s` : ''

  if (exitCode === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-xs text-emerald-600 dark:text-emerald-400">
        <CircleCheck className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          项目检查通过{command ? `:${command}` : ''} (exitCode=0{durationText})
        </span>
      </div>
    )
  }

  const output = parsed?.output ?? ''
  const lines = output
    ? output
        .split('\n')
        .map((l) => l.trimEnd())
        .filter((l) => l.trim())
        .slice(0, 30)
    : []

  return (
    <div className="px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 text-left text-red-500 dark:text-red-400"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0" />
        )}
        <CircleX className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          项目检查未通过 (exitCode={exitCode}){command ? ` · ${command}` : ''} · AI 修复中,可展开查看
        </span>
      </button>
      {expanded && (
        <div className="mt-1.5 pl-6 max-h-48 overflow-auto">
          {lines.length === 0 ? (
            <div className="text-[10px] text-content-muted">命令无输出</div>
          ) : (
            <ul className="space-y-0.5">
              {lines.map((l, i) => (
                <li
                  key={i}
                  className="font-mono text-[10px] leading-relaxed text-content-secondary break-all"
                >
                  {l}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1 flex items-center gap-1 text-[10px] text-content-muted">
            <Terminal className="w-3 h-3 shrink-0" />
            <span className="min-w-0 truncate">
              {output.length > 6000 ? `${output.slice(0, 6000)}…(已截断)` : '完整输出已回传模型'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export const ProjectCheckCard = memo(ProjectCheckCardInner)
