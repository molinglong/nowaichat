'use client'

import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useBuddyStore } from '@/store/buddy-store'
import { sendToBuddy } from '@/lib/tauri'

/**
 * 桌面搭子控制器
 * 
 * 这个组件在网页端不显示搭子头像，而是通过 Tauri 命令控制桌面原生搭子窗口。
 * 当用户在设置中启用搭子时，会在桌面上显示一个小窗口作为搭子头像。
 */
export function BuddyAvatar() {
  const {
    enabled,
    config,
    mood,
    isSpeaking,
    clickCount,
    settingsOpen,
    unreadCount,
    toggleEnabled,
    toggleSettings,
    recordClick,
    clearUnread,
  } = useBuddyStore()

  const prevEnabled = useRef(enabled)

  // 切换搭子窗口显示
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    const updateBuddyWindow = async () => {
      try {
        if (enabled) {
          // 开启:每次都确保窗口是显示的(防止页面刷新后窗口未显示)
          await invoke('show_buddy_window')
          // 发送显示事件(仅在从关到开时发,避免重复)
          if (!prevEnabled.current) {
            await sendToBuddy('show')
          }
        } else {
          // 关闭
          await invoke('hide_buddy_window')
        }
        prevEnabled.current = enabled
      } catch (err) {
        console.error('Failed to update buddy window:', err)
      }
    }

    updateBuddyWindow()
  }, [enabled])

  // 同步配置到桌面搭子
  useEffect(() => {
    if (!enabled) return
    
    const syncConfig = async () => {
      try {
        await sendToBuddy('update')
      } catch (err) {
        console.error('Failed to sync config:', err)
      }
    }

    syncConfig()
  }, [config, enabled])

  // 同步情绪状态
  useEffect(() => {
    if (!enabled) return
    
    const syncMood = async () => {
      try {
        await sendToBuddy('mood', { mood })
      } catch (err) {
        console.error('Failed to sync mood:', err)
      }
    }

    syncMood()
  }, [mood, enabled])

  // 同步说话状态
  useEffect(() => {
    if (!enabled) return
    
    const syncSpeaking = async () => {
      try {
        if (isSpeaking) {
          await sendToBuddy('speaking')
        }
      } catch (err) {
        console.error('Failed to sync speaking:', err)
      }
    }

    syncSpeaking()
  }, [isSpeaking, enabled])

  // 页面卸载时隐藏搭子窗口
  useEffect(() => {
    return () => {
      invoke('hide_buddy_window').catch(() => {})
    }
  }, [])

  return null // 不渲染任何 UI
}

/** 发送气泡消息到桌面搭子 */
export async function sendBubbleToDesktop(text: string) {
  try {
    await sendToBuddy('message', { text })
  } catch (err) {
    console.error('Failed to send bubble:', err)
  }
}

/** 导出添加气泡的方法，方便其他地方调用 */
export function useBuddyBubble() {
  const addBubbleRef = useRef<((text: string) => void) | null>(null)
  
  return {
    addBubble: (text: string) => {
      addBubbleRef.current?.(text)
      // 同时发送到桌面
      sendBubbleToDesktop(text)
    },
    registerAddBubble: (fn: (text: string) => void) => {
      addBubbleRef.current = fn
    },
  }
}
