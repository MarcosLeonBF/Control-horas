'use client'

import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import type { ReporteLine, GroupBy } from '@/lib/horas/reportes-types'
import { GROUP_LABELS, GROUP_ORDER, groupOf } from '@/lib/horas/reportes-types'
import { downloadXlsx, downloadCsv, type ExportRow } from '@/lib/export'
import { formatHoras, formatHorasTotal, mesCorto } from '@/lib/horas/format'
import { cn } from '@/lib/utils'

// El tiempo son las columnas: ni "Día" ni "Mes" tienen sentido como dimensión de fila
// (esta matriz ya tiene un mes por columna).
const DIMENSIONES = GROUP_ORDER.filter((g) => g !== 'date' && g !== 'month')

interface Fila {
  key: string
  label: string
  porMes: Map<string, number>
  total: number
}

export default function HistoricoMatriz({ lines }: { lines: ReporteLine[] }) {
  const [dim, setDim] = useState<GroupBy>('user')

  // Columnas: los meses con actividad, en orden cronológico.
  const meses = useMemo(
    () => [...new Set(lines.map((l) => l.date.slice(0, 7)))].sort(),
    [lines],
  )

  // Filas: agrupadas por la dimensión elegida, ordenadas por total desc.
  const filas = useMemo(() => {
    const by = new Map<string, Fila>()
    for (const l of lines) {
      const { key, label } = groupOf(l, dim)
      let f = by.get(key)
      if (!f) { f = { key, label, porMes: new Map(), total: 0 }; by.set(key, f) }
      const mes = l.date.slice(0, 7)
      f.porMes.set(mes, (f.porMes.get(mes) ?? 0) + l.hours)
      f.total += l.hours
    }
    return [...by.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
  }, [lines, dim])

  const totalPorMes = useMemo(() => {
    const t = new Map<string, number>()
    for (const l of lines) {
      const mes = l.date.slice(0, 7)
      t.set(mes, (t.get(mes) ?? 0) + l.hours)
    }
    return t
  }, [lines])

  const total = useMemo(() => lines.reduce((s, l) => s + l.hours, 0), [lines])
  const dimLabel = GROUP_LABELS[dim]

  // La descarga replica la matriz tal como se ve: una columna por mes + total.
  function buildExport(): ExportRow[] {
    return filas.map((f) => {
      const row: ExportRow = { [dimLabel]: f.label }
      for (const m of meses) row[mesCorto(m)] = Math.round((f.porMes.get(m) ?? 0) * 100) / 100
      row.Total = Math.round(f.total * 100) / 100
      return row
    })
  }
  const base = `historico-por-${dim}`

  if (lines.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-card px-5 py-12 text-center text-sm text-muted-foreground shadow-sm">
        No hay horas históricas cargadas.
      </p>
    )
  }

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <span className="shrink-0 text-sm text-muted-foreground">Filas por</span>
          <div className="flex min-w-0 overflow-x-auto rounded-full border border-border bg-card p-1">
            {DIMENSIONES.map((g) => (
              <button
                key={g}
                onClick={() => setDim(g)}
                className={cn(
                  'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                  dim === g ? 'bg-(--brand) text-white shadow-sm' : 'text-foreground/55 hover:text-foreground',
                )}
              >
                {GROUP_LABELS[g]}
              </button>
            ))}
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground">Descargar:</span>
          <button
            onClick={() => void downloadXlsx(`${base}.xlsx`, buildExport(), 'Histórico')}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-(--muted-surface) hover:text-foreground"
          >
            <Download className="size-3.5" /> Excel
          </button>
          <button
            onClick={() => downloadCsv(`${base}.csv`, buildExport())}
            className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-(--muted-surface) hover:text-foreground"
          >
            CSV
          </button>
        </span>
      </div>

      {/* Matriz dimensión × mes. Primera columna fija: con 20 meses hay scroll seguro. */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="bg-(--muted-surface) text-[0.7rem] uppercase tracking-[0.12em] text-muted-foreground">
              <th className="sticky left-0 z-10 bg-(--muted-surface) px-5 py-3 text-left font-medium">{dimLabel}</th>
              {meses.map((m) => (
                <th key={m} className="px-3 py-3 text-right font-medium whitespace-nowrap">{mesCorto(m)}</th>
              ))}
              <th className="px-5 py-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.key} className="border-t border-border/60 transition-colors hover:bg-(--muted-surface)/50">
                <td className="sticky left-0 z-10 max-w-64 truncate bg-card px-5 py-2.5 font-medium" title={f.label}>
                  {f.label}
                </td>
                {meses.map((m) => {
                  const h = f.porMes.get(m)
                  return (
                    <td key={m} className="tabular-money px-3 py-2.5 text-right whitespace-nowrap">
                      {h ? formatHoras(h) : <span className="text-muted-foreground/30">—</span>}
                    </td>
                  )
                })}
                <td className="tabular-money px-5 py-2.5 text-right font-semibold whitespace-nowrap">{formatHoras(f.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-(--muted-surface) font-semibold">
              <td className="sticky left-0 z-10 bg-(--muted-surface) px-5 py-3 font-display">Total</td>
              {meses.map((m) => (
                <td key={m} className="tabular-money px-3 py-3 text-right whitespace-nowrap">
                  {formatHoras(totalPorMes.get(m) ?? 0)}
                </td>
              ))}
              <td className="tabular-money px-5 py-3 text-right whitespace-nowrap">{formatHorasTotal(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
