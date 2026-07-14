'use client'

import { useMemo, useState } from 'react'
import { Clock } from 'lucide-react'
import type { BancoHorasDetalle } from '@/lib/horas/bancos-status'
import { HORAS_BAR_COLOR } from '@/lib/horas/bancos-status'
import { formatHoras, currentMonth, mesCorto } from '@/lib/horas/format'
import { cn } from '@/lib/utils'
import HorasStatusBadge from '@/components/horas/HorasStatusBadge'
import MonthPicker from '@/components/ui/month-picker'
import AnularAmpliacionButton from '@/components/horas/AnularAmpliacionButton'
import CarryForwardCharts, { HATCH } from '@/components/horas/CarryForwardCharts'

export default function BancoDetalleView({ d, isAdmin }: { d: BancoHorasDetalle; isAdmin: boolean }) {
  const [vista, setVista] = useState<'total' | 'mensual'>('total')

  const meses = useMemo(() => d.monthly.map((m) => m.month), [d.monthly])
  const [mesesSel, setMesesSel] = useState<string[]>(() => {
    const cm = currentMonth()
    const disp = d.monthly.map((m) => m.month)
    return disp.includes(cm) ? [cm] : disp.length ? [disp[disp.length - 1]] : [cm]
  })
  const selSet = useMemo(() => new Set(mesesSel), [mesesSel])
  const mesesOrden = useMemo(() => [...mesesSel].sort(), [mesesSel])
  const hayMensual = meses.length > 0
  const esMensual = vista === 'mensual'

  // Cabecera: total confirmado, o la suma de los meses elegidos (Excel + ampliaciones +
  // provisional). esProvisional cuando lo elegido es solo estimado (sin Excel real).
  const cab = useMemo(() => {
    if (!esMensual) return { assigned: d.assigned, excelBase: d.excelBase, ampliado: d.assigned - d.excelBase - d.provisional, consumed: d.consumed, provisional: d.provisional }
    let excelBase = 0, ampliado = 0, consumed = 0, provisional = 0
    for (const m of d.monthly) {
      if (!selSet.has(m.month)) continue
      excelBase += m.excelAssigned; ampliado += m.ampliado; consumed += m.consumed; provisional += m.provisional
    }
    return { assigned: excelBase + ampliado + provisional, excelBase, ampliado, consumed, provisional }
  }, [esMensual, d, selSet])
  const incluyeProv = cab.provisional > 0
  // Disponible real (vista Total): descuenta los inutilizables del carry forward
  // (spec 2026-07-14). En Mensual no aplica el corte. El desglose libres/inutilizables
  // vive en sus propias cards informativas (ya están sumadas/descontadas del total).
  const inutil = esMensual ? 0 : d.inutilizables
  const restante = cab.assigned - cab.consumed - inutil
  const hayCartasCarry = !esMensual && (d.carryNeto > 0 || d.inutilizables > 0)

  const mesEsProvisional = (month: string) => (d.monthly.find((m) => m.month === month)?.provisional ?? 0) > 0

  // Matriz posición × mes (vista Mensual): cada celda es consumido/asignado de ese mes.
  const matriz = useMemo(
    () =>
      d.posiciones.map((p) => {
        const porMes = mesesOrden.map((month) => {
          const m = p.monthly.find((x) => x.month === month)
          return { month, assigned: m?.assigned ?? 0, consumed: m?.consumed ?? 0 }
        })
        return {
          position: p.position,
          porMes,
          totAssigned: porMes.reduce((s, c) => s + c.assigned, 0),
          totConsumed: porMes.reduce((s, c) => s + c.consumed, 0),
        }
      }),
    [d.posiciones, mesesOrden],
  )

  // Ampliaciones y movimientos: en Mensual, solo los de los meses elegidos.
  const ampliaciones = esMensual ? d.ampliaciones.filter((a) => selSet.has(a.entry_date.slice(0, 7))) : d.ampliaciones
  const movimientos = esMensual ? d.movimientos.filter((m) => selSet.has(m.date.slice(0, 7))) : d.movimientos

  const celda = (assigned: number, consumed: number, bold = false) => {
    const sinDato = assigned === 0 && consumed === 0
    if (sinDato) return <span className="text-muted-foreground/40">—</span>
    return (
      <span className={cn('tabular-money', bold && 'font-medium', assigned - consumed < 0 && 'text-(--status-excedido)')}>
        {formatHoras(consumed)} <span className="text-muted-foreground/60">/ {formatHoras(assigned)}</span>
      </span>
    )
  }

  return (
    <div>
      {/* Vista Total | Mensual + selector de meses. Solo si el Excel ya trae meses. */}
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
          {esMensual && <MonthPicker value={mesesSel} onChange={setMesesSel} available={meses} />}
        </div>
      )}

      <div className={cn('mb-10 grid gap-4 sm:grid-cols-3', hayCartasCarry && 'lg:grid-cols-5')}>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs text-foreground/50">
            Asignado
            {incluyeProv && (
              <span className="inline-flex items-center gap-1 rounded-full bg-(--brand)/10 px-1.5 py-px text-[0.6rem] font-medium text-(--brand)">
                <Clock aria-hidden className="size-2.5 shrink-0" />
                Provisional
              </span>
            )}
          </p>
          <p className="tabular-money mt-1 text-2xl font-semibold">{formatHoras(cab.assigned)}</p>
          <p className="mt-1 text-xs text-foreground/45">
            {[
              cab.excelBase > 0 && `Excel ${formatHoras(cab.excelBase)}`,
              cab.provisional > 0 && `provisional +${formatHoras(cab.provisional)}`,
              cab.ampliado > 0 && `ampliado +${formatHoras(cab.ampliado)}`,
            ].filter(Boolean).join(' · ') || 'Sin asignación'}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs text-foreground/50">Consumido</p>
          <p className="tabular-money mt-1 text-2xl font-semibold">{formatHoras(cab.consumed)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs text-foreground/50">{esMensual ? 'Restante' : 'Disponible real'}</p>
          <p className={`tabular-money mt-1 text-2xl font-semibold ${restante < 0 ? 'text-(--status-excedido)' : ''}`}>
            {formatHoras(restante)}
          </p>
        </div>

        {/* Cards informativas del carry: ya sumadas/descontadas del disponible real.
            El swatch replica la leyenda de "Cierre de mes por posición". */}
        {hayCartasCarry && (
          <>
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <p className="flex items-center gap-1.5 text-xs text-foreground/50">
                <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] bg-(--status-disponible)" />
                Libres (carry)
              </p>
              <p className="tabular-money mt-1 text-2xl font-semibold text-(--status-disponible)">+{formatHoras(d.carryNeto)}</p>
              <p className="mt-1 text-xs text-foreground/45">Ya sumadas al disponible real</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <p className="flex items-center gap-1.5 text-xs text-foreground/50">
                <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] bg-foreground/10" style={HATCH} />
                Inutilizables
              </p>
              <p className="tabular-money mt-1 text-2xl font-semibold text-foreground/70">{formatHoras(d.inutilizables)}</p>
              <p className="mt-1 text-xs text-foreground/45">Ya descontadas del disponible real</p>
            </div>
          </>
        )}
      </div>

      <section className="mb-10">
        <h2 className="font-display mb-1 text-xl font-semibold">{esMensual ? 'Banco mensual por posición' : 'Por posición'}</h2>
        {esMensual && <p className="mb-4 text-sm text-muted-foreground">Consumido / asignado por mes. El asignado puede ser provisional (estimado) en los meses aún no cargados.</p>}
        {!esMensual && <div className="mb-4" />}

        {d.posiciones.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este proyecto no tiene posiciones con banco.</p>
        ) : esMensual ? (
          /* Matriz posición × mes */
          <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="bg-(--muted-surface) text-muted-foreground">
                  <th className="sticky left-0 bg-(--muted-surface) px-4 py-2.5 text-left font-medium">Posición</th>
                  {mesesOrden.map((month) => (
                    <th key={month} className="px-3 py-2.5 text-center font-medium whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        {mesCorto(month)}
                        {mesEsProvisional(month) && <span className="rounded-full bg-(--brand)/10 px-1 py-px text-[0.55rem] font-medium text-(--brand)">prov</span>}
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {matriz.map((row) => (
                  <tr key={row.position} className="border-t border-border">
                    <td className="sticky left-0 bg-card px-4 py-2.5 font-medium whitespace-nowrap">{row.position}</td>
                    {row.porMes.map((c) => (
                      <td key={c.month} className="px-3 py-2.5 text-center whitespace-nowrap">{celda(c.assigned, c.consumed)}</td>
                    ))}
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{celda(row.totAssigned, row.totConsumed, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Vista Total: tabla agregada por posición */
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
                {d.posiciones.map((p) => (
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
                    <td className="px-4 py-2.5 text-right"><HorasStatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!esMensual && <CarryForwardCharts posiciones={d.posiciones} />}

      <section>
        <h2 className="font-display mb-4 text-xl font-semibold">Ampliaciones</h2>
        {ampliaciones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {esMensual ? 'Sin ampliaciones en los meses elegidos.' : 'Sin ampliaciones. El asignado es el del Excel.'}
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
            {esMensual ? 'Sin movimientos en los meses elegidos.' : 'Sin movimientos todavía.'}
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
