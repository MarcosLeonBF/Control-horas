import { Skeleton } from '@/components/ui/skeleton'
import { CardGridSkeleton } from '@/components/skeletons'

export default function Loading() {
  return (
    <div>
      <header className="mb-8 space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-44" />
      </header>
      <CardGridSkeleton count={6} />
    </div>
  )
}
