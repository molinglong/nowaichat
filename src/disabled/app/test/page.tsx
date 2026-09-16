'use client'

import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/** 截图结果 */
interface ScreenshotResult {
  data: string
  width: number
  height: number
  format: string
}

/** 屏幕信息 */
interface ScreenInfo {
  id: number
  x: number
  y: number
  width: number
  height: number
  scale_factor: number
  is_primary: boolean
}

/** 日志条目 */
interface LogEntry {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  source?: string
}

export default function TestPage() {
  const [screens, setScreens] = useState<ScreenInfo[]>([])
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  // 加载屏幕信息
  const loadScreens = useCallback(async () => {
    try {
      const info = await invoke<ScreenInfo[]>('get_screens_info')
      setScreens(info)
      await log('info', `发现 ${info.length} 个屏幕`)
    } catch (err) {
      await log('error', `获取屏幕信息失败: ${err}`)
    }
  }, [])

  // 截图
  const takeScreenshot = useCallback(async () => {
    setLoading(true)
    try {
      const result = await invoke<ScreenshotResult>('capture_full_screen')
      setScreenshot(result.data)
      await log('info', `截图成功: ${result.width}x${result.height}`)
    } catch (err) {
      await log('error', `截图失败: ${err}`)
    } finally {
      setLoading(false)
    }
  }, [])

  // 日志
  const log = async (level: string, msg: string) => {
    try {
      await invoke(`log_${level}`, { message: msg })
    } catch (err) {
      console.error('Log failed:', err)
    }
  }

  // 监听日志
  useEffect(() => {
    const unlisten = listen<{ type?: string; data?: unknown } | LogEntry>('log-entry', (event) => {
      const payload = event.payload
      // 兼容两种格式：直接是 LogEntry 或包装的 { type, data }
      if ('timestamp' in payload && 'level' in payload && 'message' in payload) {
        setLogs(prev => [...prev.slice(-99), payload as LogEntry])
      } else if ('type' in payload && 'data' in payload) {
        const typed = payload as { type: string; data: unknown }
        if (typed.type === 'log-entry' && typeof typed.data === 'object') {
          const data = typed.data as Record<string, unknown>
          setLogs(prev => [...prev.slice(-99), {
            timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
            level: (data.level as LogEntry['level']) || 'info',
            message: String(data.message || data.msg || data.text || JSON.stringify(data))
          }])
        }
      }
    })
    return () => { unlisten.then(fn => fn()) }
  }, [])

  // 初始化
  useEffect(() => {
    loadScreens()
  }, [loadScreens])

  // 测试键鼠
  const testKey = async (key: string) => {
    try {
      await invoke('key_press', { key })
      await log('info', `按键: ${key}`)
    } catch (err) {
      await log('error', `按键失败: ${err}`)
    }
  }

  const testMouse = async (action: string) => {
    try {
      switch (action) {
        case 'click':
          await invoke('mouse_click', { x: 500, y: 500 })
          await log('info', '鼠标点击 (500, 500)')
          break
        case 'scroll-up':
          await invoke('mouse_scroll', { lines: 3 })
          await log('info', '滚轮上滚 3 格')
          break
        case 'scroll-down':
          await invoke('mouse_scroll', { lines: -3 })
          await log('info', '滚轮下滚 3 格')
          break
      }
    } catch (err) {
      await log('error', `鼠标操作失败: ${err}`)
    }
  }

  // 遮罩测试
  const testOverlay = async () => {
    try {
      const visible = await invoke<boolean>('toggle_overlay')
      await log('info', `遮罩窗口: ${visible ? '显示' : '隐藏'}`)
    } catch (err) {
      await log('error', `遮罩操作失败: ${err}`)
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <h1 className="text-2xl font-bold mb-6 text-yellow-400">BetterGI 功能测试</h1>

      {/* 屏幕信息 */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">屏幕信息</h2>
        <div className="grid grid-cols-3 gap-4">
          {screens.map((screen) => (
            <div key={screen.id} className="bg-gray-800 rounded p-3">
              <div className="font-mono text-sm">
                <p>ID: {screen.id}</p>
                <p>{screen.width}x{screen.height}</p>
                <p className="text-gray-400">({screen.x}, {screen.y})</p>
                <p className="text-xs text-gray-500">缩放: {screen.scale_factor}x</p>
                {screen.is_primary && <span className="text-green-400 text-xs">主屏</span>}
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={loadScreens}
          className="mt-2 px-4 py-2 bg-blue-600 rounded hover:bg-blue-700"
        >
          刷新
        </button>
      </section>

      {/* 截图测试 */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">截图测试</h2>
        <button
          onClick={takeScreenshot}
          disabled={loading}
          className="px-4 py-2 bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? '截图中...' : '截取全屏'}
        </button>
        {screenshot && (
          <div className="mt-4">
            <img
              src={`data:image/png;base64,${screenshot}`}
              alt="Screenshot"
              className="max-w-full max-h-96 rounded border border-gray-600"
            />
          </div>
        )}
      </section>

      {/* 键鼠测试 */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">键鼠测试</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => testKey('space')} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600">空格</button>
          <button onClick={() => testKey('enter')} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600">回车</button>
          <button onClick={() => testKey('escape')} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600">ESC</button>
          <button onClick={() => testKey('f1')} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600">F1</button>
          <button onClick={() => testKey('w')} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600">W</button>
          <button onClick={() => testKey('a')} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600">A</button>
          <button onClick={() => testKey('s')} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600">S</button>
          <button onClick={() => testKey('d')} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600">D</button>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <button onClick={() => testMouse('click')} className="px-3 py-1 bg-blue-700 rounded hover:bg-blue-600">鼠标点击</button>
          <button onClick={() => testMouse('scroll-up')} className="px-3 py-1 bg-blue-700 rounded hover:bg-blue-600">滚轮上</button>
          <button onClick={() => testMouse('scroll-down')} className="px-3 py-1 bg-blue-700 rounded hover:bg-blue-600">滚轮下</button>
        </div>
      </section>

      {/* 遮罩测试 */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">遮罩窗口</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={testOverlay}
            className="px-4 py-2 bg-purple-600 rounded hover:bg-purple-700"
          >
            切换遮罩
          </button>
          <button
            onClick={async () => {
              await invoke('send_to_overlay', { event: 'log-entry', data: JSON.stringify({ timestamp: new Date().toLocaleTimeString(), level: 'info', message: '测试日志消息' }) })
              await log('info', '已发送测试日志到遮罩')
            }}
            className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700"
          >
            发送测试日志
          </button>
          <button
            onClick={async () => {
              await invoke('send_to_overlay', { event: 'task-progress', data: JSON.stringify({ type: 'progress', name: '测试任务', progress: 50, total: 100, status: '运行中' }) })
              await log('info', '已发送进度更新到遮罩')
            }}
            className="px-4 py-2 bg-green-600 rounded hover:bg-green-700"
          >
            发送进度更新
          </button>
        </div>
      </section>

      {/* 搭子测试 */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">搭子窗口</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={async () => {
              await invoke('toggle_buddy_window')
              await log('info', '已切换搭子窗口')
            }}
            className="px-4 py-2 bg-pink-600 rounded hover:bg-pink-700"
          >
            切换搭子
          </button>
          <button
            onClick={async () => {
              await invoke('send_to_buddy', { event: 'message', data: JSON.stringify({ text: '你好呀~' }) })
              await log('info', '已发送消息到搭子')
            }}
            className="px-4 py-2 bg-pink-600 rounded hover:bg-pink-700"
          >
            发送消息
          </button>
          <button
            onClick={async () => {
              await invoke('send_to_buddy', { event: 'mood', data: JSON.stringify({ mood: 'happy' }) })
              await log('info', '已发送情绪到搭子')
            }}
            className="px-4 py-2 bg-pink-600 rounded hover:bg-pink-700"
          >
            设置开心
          </button>
        </div>
      </section>

      {/* 日志 */}
      <section>
        <h2 className="text-lg font-semibold mb-2">日志</h2>
        <div className="bg-black rounded p-4 h-64 overflow-y-auto font-mono text-sm">
          {logs.length === 0 ? (
            <p className="text-gray-500">暂无日志</p>
          ) : (
            logs.map((log, i) => (
              <p key={i} className={
                log.level === 'error' ? 'text-red-400' :
                log.level === 'warn' ? 'text-yellow-400' :
                log.level === 'info' ? 'text-blue-300' : 'text-gray-400'
              }>
                <span className="text-gray-500">[{log.timestamp}]</span> {log.message}
              </p>
            ))
          )}
        </div>
        <button
          onClick={() => invoke('clear_logs')}
          className="mt-2 px-4 py-2 bg-red-600 rounded hover:bg-red-700"
        >
          清空日志
        </button>
      </section>
    </div>
  )
}
