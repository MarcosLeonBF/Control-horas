'use client'

// Clase compartida por los <select> de filtro de /reportes y /admin/auditoria.
export const selectFiltroClass =
  'h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring'

// KPI de la fila de resumen de /reportes y de /admin/auditoria.
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="tabular-money mt-1 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  )
}
