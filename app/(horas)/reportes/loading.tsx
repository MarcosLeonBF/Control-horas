import { Skeleton } from '@/components/ui/skeleton'
import { PageHeaderSkeleton, FiltersSkeleton, TableSkeleton } from '@/components/skeletons'

export default function Loading() {
  return (
    <div className="space-y-7">
      <PageHeaderSkeleton />
      <div className="grid gap-5 rounded-2xl border border-border bg-card px-6 py-5 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
      <FiltersSkeleton />
      <TableSkeleton rows={6} />
    </div>
  )
}
