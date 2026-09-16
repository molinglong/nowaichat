'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useChatStore } from '@/store/chat-store'

export default function SettingsPage() {
  const router = useRouter()
  const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)

  useEffect(() => {
    setSettingsOpen(true)
    router.replace('/chat')
  }, [router, setSettingsOpen])

  return null
}
