import { PageHeaderSkeleton, TableSkeleton } from '@/components/skeletons'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton eyebrow />
      <TableSkeleton rows={7} />
    </div>
  )
}
