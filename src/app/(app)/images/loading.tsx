import { Skeleton } from '@/components/ui/Skeleton'

/**
 * /images 路由的过渡占位。
 */
export default function ImagesLoading() {
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-line/50 flex items-center gap-2">
        <Skeleton className="w-4 h-4" rounded="full" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-6 w-28 ml-auto" />
      </div>
      <div className="flex-1 grid md:grid-cols-[40%_1fr] min-h-0">
        <div className="border-r border-line/50 p-4 space-y-3">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-28 w-full" rounded="lg" />
          <Skeleton className="h-9 w-full" rounded="lg" />
        </div>
        <div className="p-4">
          <Skeleton className="h-3 w-24 mb-3" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} rounded="lg" className="aspect-square" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
