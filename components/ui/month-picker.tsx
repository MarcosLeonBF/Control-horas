'use client'

import { useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { CalendarRange, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatMes } from '@/lib/horas/format'

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const ym = (year: number, monthIdx: number) => `${year}-${String(monthIdx + 1).padStart(2, '0')}`

// Resumen para el disparador: un mes → "Julio 2026"; varios → "N meses"; nada → placeholder.
function resumen(selected: string[]): string {
  if (selected.length === 0) return 'Elegí meses'
  if (selected.length === 1) return formatMes(selected[0])
  const years = new Set(selected.map((m) => m.slice(0, 4)))
  return years.size === 1 ? `${selected.length} meses · ${[...years][0]}` : `${selected.length} meses`
}

interface MonthPickerProps {
  value: string[] // meses 'YYYY-MM' seleccionados
  onChange: (value: string[]) => void
  available: string[] // meses con datos (el resto se ve deshabilitado)
  className?: string
}

// Selector de meses estilo calendario: grilla de 12 meses por año, navegación de año y
// multi-selección. Los meses sin datos van deshabilitados. Mantiene al menos uno elegido.
export default function MonthPicker({ value, onChange, available, className }: MonthPickerProps) {
  const availableSet = new Set(available)
  const selectedSet = new Set(value)
  const years = [...new Set(available.map((m) => Number(m.slice(0, 4))))].sort((a, b) => a - b)
  const lastSelYear = value.length ? Number(value[value.length - 1].slice(0, 4)) : new Date().getFullYear()
  const [year, setYear] = useState(lastSelYear)

  const toggle = (month: string) => {
    if (!availableSet.has(month)) return
    if (selectedSet.has(month)) {
      if (value.length === 1) return // mantener al menos uno
      onChange(value.filter((m) => m !== month))
    } else {
      onChange([...value, month].sort())
    }
  }

  const yearMonths = MESES.map((_, i) => ym(year, i))
  const yearHasData = years.length > 0
  const minYear = years[0] ?? year
  const maxYear = years[years.length - 1] ?? year

  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-foreground shadow-sm transition-colors hover:bg-(--muted-surface) focus:outline-none focus:ring-2 focus:ring-ring data-popup-open:ring-2 data-popup-open:ring-ring',
          className,
        )}
      >
        <CalendarRange className="size-4 text-(--brand)" />
        <span className="font-medium">{resumen(value)}</span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup className="w-72 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-foreground/5 outline-none">
            {/* Navegación de año */}
            <div className="mb-2.5 flex items-center justify-between">
              <button
                type="button" aria-label="Año anterior" disabled={year <= minYear}
                onClick={() => setYear((y) => y - 1)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-(--muted-surface) hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="font-display text-sm font-semibold tracking-tight">{year}</span>
              <button
                type="button" aria-label="Año siguiente" disabled={year >= maxYear}
                onClick={() => setYear((y) => y + 1)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-(--muted-surface) hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            {/* Grilla de meses */}
            <div className="grid grid-cols-3 gap-1.5">
              {MESES.map((label, i) => {
                const month = yearMonths[i]
                const disabled = !availableSet.has(month)
                const selected = selectedSet.has(month)
                return (
                  <button
                    key={month}
                    type="button"
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => toggle(month)}
                    className={cn(
                      'rounded-md py-2 text-sm font-medium tabular-nums transition-colors',
                      selected && 'bg-(--brand) text-white shadow-sm',
                      !selected && !disabled && 'text-foreground hover:bg-(--brand)/10',
                      disabled && 'cursor-not-allowed text-muted-foreground/35',
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {/* Acciones rápidas */}
            <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5 text-xs">
              <button
                type="button"
                onClick={() => onChange(yearMonths.filter((m) => availableSet.has(m)))}
                disabled={!yearHasData}
                className="rounded px-1.5 py-1 text-muted-foreground transition-colors hover:text-(--brand) disabled:opacity-30"
              >
                Todo {year}
              </button>
              <span className="tabular-nums text-muted-foreground/70">
                {value.length} {value.length === 1 ? 'mes' : 'meses'}
              </span>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
