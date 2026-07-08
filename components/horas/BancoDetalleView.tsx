'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { BancoHorasDetalle } from '@/lib/horas/bancos-status'
import { computeHorasStatus, HORAS_BAR_COLOR } from '@/lib/horas/bancos-status'
import { formatHoras, formatMes, currentMonth, addMonths } from '@/lib/horas/format'
import { cn } from '@/lib/utils'
import HorasStatusBadge from '@/components/horas/HorasStatusBadge'
import AnularAmpliacionButton from '@/components/horas/AnularAmpliacionButton'

export default function BancoDetalleView({ d, isAdmin }: { d: BancoHorasDetalle; isAdmin: boolean }) {
  const [vista, setVista] = useState<'total' | 'mensual'>('total')
  const [mes, setMes] = useState(() => currentMonth())

  const meses = useMemo(() => d.monthly.map((m) => m.month), [d.monthly])
  const hayMensual = meses.length > 0
  const minMes = meses[0] ?? currentMonth()
  const maxMes = meses.length > 0 && meses[meses.length - 1] > currentMonth() ? meses[meses.length - 1] : currentMonth()
  const esMensual = vista === 'mensual'

  // Cifras de cabecera: total (como hoy) o las del mes elegido (Excel + ampliaciones del mes).
  const mm = d.monthly.find((m) => m.month === mes)
  const cab = esMensual
    ? { assigned: (mm?.excelAssigned ?? 0) + (mm?.ampliado ?? 0), excelBase: mm?.excelAssigned ?? 0, ampliado: mm?.ampliado ?? 0, consumed: mm?.consumed ?? 0 }
    : { assigned: d.assigned, excelBase: d.excelBase, ampliado: d.assigned - d.excelBase, consumed: d.consumed }
  const restante = cab.assigned - cab.consumed

  // Posiciones: en Mensual cada fila muestra su mes (0/0 se ve en cero, estado neutro '—').
  const posiciones = useMemo(() => {
    if (!esMensual) return d.posiciones
    return d.posiciones.map((p) => {
      const m = p.monthly.find((x) => x.month === mes)
      const assigned = m?.assigned ?? 0
      const consumed = m?.consumed ?? 0
      return { ...p, assigned, consumed, remaining: assigned - consumed, status: computeHorasStatus(assigned, consumed) }
    })
  }, [d.posiciones, esMensual, mes])

  // Ampliaciones y movimientos: en Mensual, solo los del mes elegido.
  const ampliaciones = esMensual ? d.ampliaciones.filter((a) => a.entry_date.slice(0, 7) === mes) : d.ampliaciones
  const movimientos = esMensual ? d.movimientos.filter((m) => m.date.slice(0, 7) === mes) : d.movimientos

  return (
    <div>
      {/* Vista Total | Mensual (spec §5.1). Solo si el Excel ya trae meses. */}
      {hayMensual && (
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Vista del banco" className="inline-flex rounded-lg bg-(--muted-surface) p-0.5">
            {(['total', 'mensual'] as const).map((v) => (
              <button
                key={v} type="button" onClick={() => setVista(v)} aria-pressed={vista === v}
                className={cn(
                  'rounded-md px-3.5 py-1.5 text-sm transition-colors',
                  vista === v ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {v === 'total' ? 'Total' : 'Mensual'}
              </button>
            ))}
          </div>
          {esMensual && (
            <div className="inline-flex items-center gap-1">
              <button
                type="button" aria-label="Mes anterior" disabled={mes <= minMes}
                onClick={() => setMes((m) => addMonths(m, -1))}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-(--brand) disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="min-w-30 text-center text-sm font-medium text-foreground">{formatMes(mes)}</span>
              <button
                type="button" aria-label="Mes siguiente" disabled={mes >= maxMes}
                onClick={() => setMes((m) => addMonths(m, 1))}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-(--brand) disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mb-10 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs text-foreground/50">Asignado</p>
          <p className="tabular-money mt-1 text-2xl font-semibold">{formatHoras(cab.assigned)}</p>
          <p className="mt-1 text-xs text-foreground/45">
            Excel {formatHoras(cab.excelBase)}{cab.ampliado > 0 && <> · ampliado +{formatHoras(cab.ampliado)}</>}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs text-foreground/50">Consumido</p>
          <p className="tabular-money mt-1 text-2xl font-semibold">{formatHoras(cab.consumed)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs text-foreground/50">Restante</p>
          <p className={`tabular-money mt-1 text-2xl font-semibold ${restante < 0 ? 'text-(--status-excedido)' : ''}`}>
            {formatHoras(restante)}
          </p>
        </div>
      </div>

      <section className="mb-10">
        <h2 className="font-display mb-4 text-xl font-semibold">Por posición</h2>
        {posiciones.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este proyecto no tiene posiciones con banco.</p>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-(--muted-surface) text-left text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Posición</th>
                  <th className="px-4 py-2.5 font-medium text-right">Asignado</th>
                  <th className="px-4 py-2.5 font-medium text-right">Consumido</th>
                  <th className="px-4 py-2.5 font-medium text-right">Restante</th>
                  <th className="px-4 py-2.5 font-medium text-right">Estado</th>
                </tr>
              </thead>
              <tbody>
                {posiciones.map((p) => (
                  <tr key={p.position} className="border-t border-border">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{p.position}</div>
                      {p.assigned > 0 && (
                        <div className="mt-1.5 h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-(--muted-surface)">
                          <div className={cn('h-full rounded-full', HORAS_BAR_COLOR[p.status])} style={{ width: `${Math.min((p.consumed / p.assigned) * 100, 100)}%` }} />
                        </div>
                      )}
                    </td>
                    <td className="tabular-money px-4 py-2.5 text-right">{formatHoras(p.assigned)}</td>
                    <td className="tabular-money px-4 py-2.5 text-right">{formatHoras(p.consumed)}</td>
                    <td className={`tabular-money px-4 py-2.5 text-right ${p.remaining < 0 ? 'text-(--status-excedido)' : ''}`}>{formatHoras(p.remaining)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {esMensual && p.assigned === 0 && p.consumed === 0
                        ? <span className="text-sm text-muted-foreground/50">—</span>
                        : <HorasStatusBadge status={p.status} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display mb-4 text-xl font-semibold">Ampliaciones</h2>
        {ampliaciones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {esMensual ? `Sin ampliaciones en ${formatMes(mes)}.` : 'Sin ampliaciones. El asignado es el del Excel.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-(--muted-surface) text-left text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Fecha</th>
                  <th className="px-4 py-2.5 font-medium text-right">Horas</th>
                  <th className="px-4 py-2.5 font-medium">Motivo</th>
                  <th className="px-4 py-2.5 font-medium">Por</th>
                  {isAdmin && <th className="px-4 py-2.5 font-medium text-right">Acción</th>}
                </tr>
              </thead>
              <tbody>
                {ampliaciones.map((a) => (
                  <tr key={a.id} className={`border-t border-border ${a.active ? '' : 'text-muted-foreground line-through'}`}>
                    <td className="px-4 py-2.5 whitespace-nowrap">{a.entry_date}</td>
                    <td className="tabular-money px-4 py-2.5 text-right whitespace-nowrap">+{formatHoras(Number(a.hours))}</td>
                    <td className="px-4 py-2.5">{a.reason}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{a.actor_name}</td>
                    {isAdmin && (
                      <td className="px-4 py-2.5 text-right">
                        {a.active ? <AnularAmpliacionButton id={a.id} project={d.project} /> : <span className="text-xs">anulada</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-display mb-1 text-xl font-semibold">Movimientos</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Consumos y ampliaciones en orden cronológico, con el saldo de horas disponibles antes y después.
        </p>
        {movimientos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {esMensual ? `Sin movimientos en ${formatMes(mes)}.` : 'Sin movimientos todavía.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
            <table className="w-full min-w-176 text-sm">
              <thead>
                <tr className="bg-(--muted-surface) text-left text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Fecha</th>
                  <th className="px-4 py-2.5 font-medium">Acción</th>
                  <th className="px-4 py-2.5 font-medium text-right">Horas</th>
                  <th className="px-4 py-2.5 font-medium text-right">Antes</th>
                  <th className="px-4 py-2.5 font-medium text-right">Después</th>
                  <th className="px-4 py-2.5 font-medium">Por</th>
                  <th className="px-4 py-2.5 font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-4 py-2.5 whitespace-nowrap">{m.date}</td>
                    <td className="px-4 py-2.5">
                      <span className={m.kind === 'ampliacion' ? 'text-(--brand)' : 'text-foreground/70'}>
                        {m.kind === 'ampliacion' ? 'Ampliación' : 'Consumo'}
                      </span>
                    </td>
                    <td className={`tabular-money px-4 py-2.5 text-right whitespace-nowrap ${m.kind === 'ampliacion' ? 'text-(--brand)' : ''}`}>
                      {m.kind === 'ampliacion' ? '+' : '−'}{formatHoras(m.hours)}
                    </td>
                    <td className="tabular-money px-4 py-2.5 text-right text-foreground/55 whitespace-nowrap">{formatHoras(m.saldoAntes)}</td>
                    <td className={`tabular-money px-4 py-2.5 text-right whitespace-nowrap ${m.saldoDespues < 0 ? 'text-(--status-excedido)' : ''}`}>{formatHoras(m.saldoDespues)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{m.actor}</td>
                    <td className="px-4 py-2.5 text-foreground/70">{m.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
