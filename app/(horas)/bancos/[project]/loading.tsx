import { Skeleton } from '@/components/ui/skeleton'
import { KpiRowSkeleton, TableSkeleton } from '@/components/skeletons'

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
      </div>
      <KpiRowSkeleton count={3} />
      <TableSkeleton rows={6} />
    </div>
  )
}
