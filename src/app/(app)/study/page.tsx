'use client'

import { NoteList } from '@/components/study/NoteList'
import { ReviewCard } from '@/components/study/ReviewCard'

export default function StudyPage() {
  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden">
      {/* 错题列表:桌面端左栏固定宽;移动端在复习卡下方 */}
      <div className="flex-1 min-h-0 order-2 md:order-1 md:w-[340px] md:flex-none border-t md:border-t-0 md:border-r border-line overflow-y-auto">
        <NoteList />
      </div>
      {/* 复习卡:桌面端右侧主区;移动端在上 */}
      <div className="flex-1 min-h-0 order-1 md:order-2 overflow-y-auto">
        <ReviewCard />
      </div>
    </div>
  )
}
