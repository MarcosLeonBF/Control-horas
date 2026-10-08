'use client'

import MonthPicker from '@/components/ui/month-picker'
import { formatMes } from '@/lib/horas/format'
import { cn } from '@/lib/utils'

export type Vista = 'total' | 'mensual'

// Periodo que gobierna la pantalla de bancos (lista y detalle): Mensual | Total y, en
// Mensual, los meses elegidos. Mensual va primero porque es la vista por defecto; el
// selector de meses va a la derecha del switch, así el switch no se mueve al aparecer.
export default function VistaPeriodo({ vista, onVista, meses, mesesSel, onMesesSel, className }: {
  vista: Vista
  onVista: (v: Vista) => void
  meses: string[] // meses con datos
  mesesSel: string[]
  onMesesSel: (m: string[]) => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <div role="group" aria-label="Vista del banco" className="inline-flex rounded-lg bg-(--muted-surface) p-0.5">
        {(['mensual', 'total'] as const).map((v) => (
          <button
            key={v} type="button" onClick={() => onVista(v)} aria-pressed={vista === v}
            className={cn(
              'rounded-md px-3.5 py-1.5 text-sm transition-colors',
              vista === v ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {v === 'total' ? 'Total' : 'Mensual'}
          </button>
        ))}
      </div>
      {vista === 'mensual' && <MonthPicker value={mesesSel} onChange={onMesesSel} available={meses} />}
    </div>
  )
}

// Periodo en palabras, para rotular cifras: "Octubre de 2026", "3 meses", "Todo el banco".
export function periodoEnPalabras(vista: Vista, mesesSel: string[]): string {
  if (vista === 'total') return 'Todo el banco'
  return mesesSel.length === 1 ? formatMes(mesesSel[0]) : `${mesesSel.length} meses`
}
