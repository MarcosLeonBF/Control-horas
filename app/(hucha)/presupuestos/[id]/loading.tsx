import { Skeleton } from '@/components/ui/skeleton'
import { TableSkeleton } from '@/components/skeletons'

// Misma silueta que la página: cabecera, acciones, resumen con barra y el historial.
export default function Loading() {
  return (
    <div>
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 mb-8 h-8 w-56" />
      <Skeleton className="mb-8 h-10 w-48" />
      <div className="mb-10 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between px-5 pt-5">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="px-5 pb-5 pt-3">
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
        <div className="grid divide-y divide-border border-t border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-7 w-28" />
            </div>
          ))}
        </div>
      </div>
      <Skeleton className="mb-4 h-6 w-28" />
      <TableSkeleton rows={5} />
    </div>
  )
}
