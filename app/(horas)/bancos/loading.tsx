import { PageHeaderSkeleton, KpiRowSkeleton, FiltersSkeleton, TableSkeleton } from '@/components/skeletons'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <KpiRowSkeleton />
      <FiltersSkeleton />
      <TableSkeleton rows={8} />
    </div>
  )
}
