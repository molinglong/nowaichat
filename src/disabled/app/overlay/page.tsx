'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** 日志条目 */
interface LogEntry {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  source?: string
}

/** 任务进度 */
interface TaskProgress {
  name: string
  progress: number
  total: number
  status: string
}

/** 快捷键配置 */
interface HotkeyConfig {
  key: string
  action: string
  description: string
}

const HOTKEYS: HotkeyConfig[] = [
  { key: '~', action: 'toggle', description: '切换遮罩' },
  { key: 'P', action: 'pause', description: '暂停' },
  { key: 'S', action: 'stop', description: '停止' },
  { key: 'H', action: 'hide', description: '隐藏面板' },
]

export default function OverlayPage() {
  const [isVisible, setIsVisible] = useState(true)
  const [isMinimized, setIsMinimized] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [currentTask, setCurrentTask] = useState<TaskProgress | null>(null)
  const [stats, setStats] = useState({
    elapsed: '00:00:00',
    processed: 0,
    failed: 0,
  })
  const logContainerRef = useRef<HTMLDivElement>(null)

  // 自动滚动日志
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs])

  // 监听日志事件
  useEffect(() => {
    const unlistenOverlay = listen<{ type: string; data: unknown }>('overlay-event', (event) => {
      const { type, data } = event.payload
      
      // 根据事件类型处理
      if (type === 'log-entry') {
        setLogs((prev) => {
          const newLogs = [...prev, data as LogEntry]
          if (newLogs.length > 100) {
            return newLogs.slice(-100)
          }
          return newLogs
        })
      } else if (type === 'task-progress' || type === 'progress') {
        setCurrentTask(data as TaskProgress)
      } else if (type === 'task-stats' || type === 'stats') {
        setStats(data as typeof stats)
      } else if (type === 'log' || type === 'info' || type === 'debug' || type === 'warn' || type === 'error') {
        // 通用日志事件
        const logData = data as { message?: string; msg?: string; text?: string }
        const message = logData.message || logData.msg || logData.text || String(data)
        setLogs((prev) => {
          const newLogs = [...prev, {
            timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
            level: type === 'error' ? 'error' : type === 'warn' ? 'warn' : type === 'debug' ? 'debug' : 'info',
            message
          }]
          if (newLogs.length > 100) {
            return newLogs.slice(-100)
          }
          return newLogs
        })
      }
    })

    return () => {
      unlistenOverlay.then((fn) => fn())
    }
  }, [])

  // 键盘事件
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const key = e.key.toUpperCase()
      
      switch (key) {
        case '~':
        case '`':
          // 切换遮罩
          try {
            const visible = await invoke<boolean>('toggle_overlay')
            setIsVisible(visible)
          } catch (err) {
            console.error('Toggle overlay failed:', err)
          }
          break
        case 'H':
          // 隐藏面板
          setIsMinimized((prev) => !prev)
          break
        case 'P':
          // 暂停/继续
          invoke('send_to_overlay', { event: 'pause', data: '{}' }).catch(console.error)
          break
        case 'S':
          // 停止任务
          invoke('send_to_overlay', { event: 'stop', data: '{}' }).catch(console.error)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 获取日志级别颜色
  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-red-400'
      case 'warn':
        return 'text-yellow-400'
      case 'info':
        return 'text-blue-300'
      case 'debug':
        return 'text-gray-400'
      default:
        return 'text-white'
    }
  }

  // 获取日志级别前缀
  const getLevelPrefix = (level: string) => {
    switch (level) {
      case 'error':
        return '❌'
      case 'warn':
        return '⚠️'
      case 'info':
        return 'ℹ️'
      case 'debug':
        return '🔍'
      default:
        return '📝'
    }
  }

  return (
    <div className="w-screen h-screen bg-transparent overflow-hidden pointer-events-none">
      {/* 主面板 */}
      <div
        className={`
          absolute transition-all duration-300 ease-in-out
          ${isMinimized ? 'bottom-4 right-4 w-48' : 'bottom-4 right-4 w-96'}
          pointer-events-auto
        `}
        style={{
          fontFamily: '"Zpix", "Consolas", monospace',
        }}
      >
        {/* 面板背景 */}
        <div
          className="bg-black/80 backdrop-blur-sm rounded-lg border-2 border-yellow-500/50 shadow-xl overflow-hidden"
          style={{
            boxShadow: '0 0 20px rgba(255, 200, 0, 0.2)',
          }}
        >
          {/* 标题栏 */}
          <div
            className="flex items-center justify-between px-3 py-2 border-b border-yellow-500/30"
            style={{ backgroundColor: 'rgba(50, 40, 0, 0.8)' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-yellow-400 text-sm font-bold">◆</span>
              <span className="text-yellow-400 text-sm font-bold">AICHATT ASSISTANT</span>
            </div>
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="text-yellow-400/70 hover:text-yellow-400 transition-colors text-xs"
            >
              {isMinimized ? '▲' : '▼'}
            </button>
          </div>

          {/* 内容区域 */}
          {!isMinimized && (
            <div className="p-3 space-y-3">
              {/* 进度条 */}
              {currentTask && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-yellow-200/80">
                    <span>{currentTask.name}</span>
                    <span>{currentTask.status}</span>
                  </div>
                  <div className="h-2 bg-black/50 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 transition-all duration-300"
                      style={{
                        width: `${(currentTask.processed / currentTask.total) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-yellow-200/60">
                    <span>{currentTask.processed}/{currentTask.total}</span>
                    <span>{Math.round((currentTask.processed / currentTask.total) * 100)}%</span>
                  </div>
                </div>
              )}

              {/* 统计信息 */}
              <div className="flex gap-4 text-xs text-yellow-200/80">
                <div>
                  <span className="opacity-60">已用:</span>
                  <span className="ml-1 font-mono">{stats.elapsed}</span>
                </div>
                <div>
                  <span className="opacity-60">完成:</span>
                  <span className="ml-1 text-green-400">{stats.processed}</span>
                </div>
                <div>
                  <span className="opacity-60">失败:</span>
                  <span className="ml-1 text-red-400">{stats.failed}</span>
                </div>
              </div>

              {/* 日志区域 */}
              <div
                ref={logContainerRef}
                className="h-32 overflow-y-auto bg-black/60 rounded p-2 space-y-0.5"
                style={{
                  fontFamily: '"Consolas", monospace',
                  fontSize: '11px',
                  lineHeight: '1.4',
                }}
              >
                {logs.length === 0 ? (
                  <div className="text-yellow-200/40 italic">等待日志...</div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className={`flex gap-1 ${getLevelColor(log.level)}`}>
                      <span className="opacity-50">{log.timestamp}</span>
                      <span>{getLevelPrefix(log.level)}</span>
                      <span className="flex-1 truncate">{log.message}</span>
                    </div>
                  ))
                )}
              </div>

              {/* 快捷键提示 */}
              <div className="flex flex-wrap gap-2 text-xs text-yellow-200/50">
                {HOTKEYS.map((hk) => (
                  <div key={hk.action} className="flex items-center gap-1">
                    <kbd className="px-1 py-0.5 bg-yellow-900/30 rounded border border-yellow-700/30 text-yellow-400/70">
                      {hk.key}
                    </kbd>
                    <span>{hk.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 最小化状态显示 */}
          {isMinimized && (
            <div className="px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {currentTask && (
                  <>
                    <span className="text-yellow-400 text-xs">{currentTask.name}</span>
                    <span className="text-yellow-200/60 text-xs">
                      {Math.round((currentTask.processed / currentTask.total) * 100)}%
                    </span>
                  </>
                )}
                {!currentTask && (
                  <span className="text-yellow-200/40 text-xs italic">空闲中</span>
                )}
              </div>
              <span className="text-yellow-200/50 text-xs font-mono">{stats.elapsed}</span>
            </div>
          )}
        </div>
      </div>

      {/* 调试信息 - 可点击隐藏 */}
      <div
        className="absolute top-4 left-4 pointer-events-auto cursor-pointer"
        onClick={() => setIsVisible(!isVisible)}
      >
        <div className="text-xs text-yellow-400/30">
          按 ~ 键切换遮罩 | 点击隐藏
        </div>
      </div>
    </div>
  )
}
