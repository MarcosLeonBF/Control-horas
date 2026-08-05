'use client'

import { cn } from '@/lib/utils'

// Clase compartida por los <select> de filtro de /reportes y /admin/auditoria.
export const selectFiltroClass =
  'h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring'

// KPI con la barrita de acento a la izquierda. Lo comparten la fila de resumen de
// /reportes y la de /admin/auditoria.
export function Stat({ label, value, accent }: { label: string; value: string; accent?: 'brand' | 'wine' | 'muted' }) {
  return (
    <div className="relative">
      <div
        className={cn(
          'absolute left-0 top-1 h-9 w-1 rounded-full',
          accent === 'brand' && 'bg-(--brand)',
          accent === 'wine' && 'bg-(--wine)',
          accent === 'muted' && 'bg-foreground/15',
        )}
      />
      <div className="pl-4">
        <p className="text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="tabular-money mt-1 font-display text-2xl font-semibold tracking-tight">{value}</p>
      </div>
    </div>
  )
}
