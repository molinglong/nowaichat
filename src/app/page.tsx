'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    // 重定向到聊天页面
    router.push('/chat')
  }, [router])

  return null
}
