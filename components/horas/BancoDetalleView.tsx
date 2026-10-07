'use client'

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Clock, ChevronRight, ChevronDown, Info } from 'lucide-react'
import type { BancoHorasDetalle } from '@/lib/horas/bancos-status'
import { computeHorasStatus, estadoProyectoBadgeClass, HORAS_BAR_COLOR } from '@/lib/horas/bancos-status'
import { formatHoras, formatFechaISO, currentMonth, mesCorto } from '@/lib/horas/format'
import { cn } from '@/lib/utils'
import HorasStatusBadge from '@/components/horas/HorasStatusBadge'
import VistaPeriodo, { periodoEnPalabras, type Vista } from '@/components/horas/VistaPeriodo'
import AmpliarHorasDialog from '@/components/horas/AmpliarHorasDialog'
import AnularAmpliacionButton from '@/components/horas/AnularAmpliacionButton'
import type { BancoMensual } from '@/lib/horas/bancos-status'
import { HATCH, LeyendaCierre, CierrePosicionPanel, BarraComposicion, BarraMes, tieneCierre } from '@/components/horas/CarryForwardCharts'

// Metadatos del proyecto (Excel Clientes_Proyectos) para la cabecera.
export interface MetaProyecto { estado: string; manager: string; fechaAuditoria: string }

const PCT = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 0 })
// Movimientos visibles de entrada: los más recientes; el resto, a demanda.
const MOVIMIENTOS_INICIALES = 10

// Una cifra del resumen: rótulo, valor y, si hace falta, de qué se compone.
function Cifra({ label, extra, value, caption, excedido }: { label: string; extra?: ReactNode; value: string; caption?: string; excedido?: boolean }) {
  return (
    <div className="p-5">
      <dt className="flex items-center gap-1.5 text-xs text-foreground/50">{label}{extra}</dt>
      <dd className={cn('tabular-money mt-1 text-2xl font-semibold', excedido && 'text-(--status-excedido)')}>{value}</dd>
      {caption && <dd className="mt-1 text-xs text-foreground/45">{caption}</dd>}
    </div>
  )
}

// Las explicaciones de cómo se calculan las cifras, plegadas: quien ya lo sabe no tiene
// que leer un párrafo cada vez, y quien no, lo tiene a un clic.
function ComoSeLee({ children }: { children: ReactNode }) {
  return (
    <details className="group mb-4 text-sm">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <Info aria-hidden className="size-3.5" />
        ¿Cómo se lee?
        <ChevronDown aria-hidden className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <p className="mt-2 max-w-prose text-muted-foreground">{children}</p>
    </details>
  )
}

export default function BancoDetalleView({ d, isAdmin, meta }: { d: BancoHorasDetalle; isAdmin: boolean; meta?: MetaProyecto }) {
  // Como la lista: se entra en Mensual, en el mes en curso; Total si no hay meses.
  const [vista, setVista] = useState<Vista>(() => (d.monthly.length > 0 ? 'mensual' : 'total'))

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
  // Con un solo mes, la matriz posición × mes quedaría en una columna: se muestra la
  // misma tabla que en Total, con las cifras de ese mes.
  const mesUnico = esMensual && mesesOrden.length === 1 ? mesesOrden[0] : null

  // Cabecera: total confirmado, o la suma de los meses elegidos (Excel + ampliaciones +
  // provisional + carry de esos meses). En Total, libres = carryNeto (neteado de excesos);
  // en Mensual, libres = Σ bruto de los meses elegidos.
  const cab = useMemo(() => {
    if (!esMensual) return { assigned: d.assigned, excelBase: d.excelBase, ampliado: d.assigned - d.excelBase - d.provisional, consumed: d.consumed, provisional: d.provisional, inutilizables: d.inutilizables, libres: d.carryNeto }
    let excelBase = 0, ampliado = 0, consumed = 0, provisional = 0, inutilizables = 0, libres = 0
    for (const m of d.monthly) {
      if (!selSet.has(m.month)) continue
      excelBase += m.excelAssigned; ampliado += m.ampliado; consumed += m.consumed; provisional += m.provisional
      inutilizables += m.inutilizables; libres += m.libres
    }
    return { assigned: excelBase + ampliado + provisional, excelBase, ampliado, consumed, provisional, inutilizables, libres }
  }, [esMensual, d, selSet])
  const incluyeProv = cab.provisional > 0
  // Disponible real (ambas vistas): descuenta los inutilizables del carry forward
  // (spec 2026-07-14). El desglose libres/inutilizables va al pie del resumen
  // (ya están sumadas/descontadas del total).
  const restante = cab.assigned - cab.consumed - cab.inutilizables
  const hayCartasCarry = cab.libres > 0 || cab.inutilizables > 0
  // Estado del periodo que se mira (mismo cálculo que el del proyecto), para que el badge
  // no diga "Disponible" del total mientras las cifras son de un mes excedido.
  const estadoPeriodo = computeHorasStatus(cab.assigned - cab.inutilizables, cab.consumed)
  // Barra del resumen: gastado = consumido + inutilizables, sobre el asignado.
  const fracConsumo = cab.assigned > 0 ? Math.min(cab.consumed / cab.assigned, 1) : cab.consumed > 0 ? 1 : 0
  const fracInutil = cab.assigned > 0 ? Math.min(cab.inutilizables / cab.assigned, 1 - fracConsumo) : 0

  // Cierre de mes integrado en "Por posición": cada fila con meses se despliega y
  // muestra su cierre ahí mismo (leyenda junto al título; sin sección aparte).
  const hayCierre = d.posiciones.some(tieneCierre)
  const [posAbiertas, setPosAbiertas] = useState<Set<string>>(new Set())
  const togglePos = (pos: string) =>
    setPosAbiertas((prev) => {
      const next = new Set(prev)
      if (next.has(pos)) next.delete(pos)
      else next.add(pos)
      return next
    })

  const mesEsProvisional = (month: string) => (d.monthly.find((m) => m.month === month)?.provisional ?? 0) > 0

  // Matriz posición × mes (vista Mensual): cada celda lleva el BancoMensual completo
  // (para la micro-barra de composición del cierre) además de las cifras.
  const cmAct = currentMonth()
  const matriz = useMemo(
    () =>
      d.posiciones.map((p) => {
        const porMes = mesesOrden.map((month) => ({ month, m: p.monthly.find((x) => x.month === month) }))
        // Disponible real de los meses elegidos: asignado − consumido − inutilizables.
        // LA MISMA cifra (y formato) que la columna Disponible real de la vista Total.
        const totBruto = porMes.reduce((s, c) => s + (c.m?.assigned ?? 0), 0)
        const totInutil = porMes.reduce((s, c) => s + (c.m?.inutilizables ?? 0), 0)
        const totConsumed = porMes.reduce((s, c) => s + (c.m?.consumed ?? 0), 0)
        return {
          position: p.position,
          porMes,
          disponible: totBruto - totConsumed - totInutil,
          sinDatos: totBruto === 0 && totConsumed === 0,
        }
      }),
    [d.posiciones, mesesOrden],
  )

  // Ampliaciones y movimientos: en Mensual, solo los de los meses elegidos.
  const ampliaciones = esMensual ? d.ampliaciones.filter((a) => selSet.has(a.entry_date.slice(0, 7))) : d.ampliaciones
  const movimientos = esMensual ? d.movimientos.filter((m) => selSet.has(m.date.slice(0, 7))) : d.movimientos
  // Del más reciente al más antiguo, como un extracto; de entrada solo los últimos.
  const [verTodosMovs, setVerTodosMovs] = useState(false)
  const movsRecientes = [...movimientos].reverse()
  const movsVisibles = verTodosMovs ? movsRecientes : movsRecientes.slice(0, MOVIMIENTOS_INICIALES)

  // Celda de un mes en la matriz: GASTADO (consumido + inutilizables) / asignado —
  // la diferencia es siempre lo disponible ("restante y disponible son lo mismo",
  // Marcos 2026-07-14). La micro-barra reparte la distribución; excedido en rojo.
  const celdaMes = (month: string, m?: BancoMensual) => {
    if (!m || (m.assigned === 0 && m.consumed === 0)) return <span className="text-muted-foreground/40">—</span>
    const enCurso = month >= cmAct
    const excedido = m.consumed > m.assigned
    return (
      <span className="inline-flex flex-col items-center gap-1">
        <span className={cn('tabular-money', excedido && 'text-(--status-excedido)')}>
          {formatHoras(m.consumed + (m.inutilizables ?? 0))} <span className="text-muted-foreground/60">/ {formatHoras(m.assigned)}</span>
        </span>
        <BarraMes m={m} enCurso={enCurso} className="h-1.5 w-24 max-w-full" />
      </span>
    )
  }

  // Consumido e Inutilizables son restas del asignado: rojo + signo −.
  const celdaResta = (h: number) =>
    h > 0 ? <span className="text-(--status-excedido)">−{formatHoras(h)}</span> : <span className="text-muted-foreground/40">—</span>

  return (
    <div>
      <Link href="/bancos" className="text-xs text-foreground/55 hover:text-foreground">← Bancos de horas</Link>

      {/* Cabecera: el periodo gobierna todo lo de abajo, así que va junto al título, igual
          que en la lista. Ampliar horas es ocasional: un botón, no un formulario fijo. */}
      <header className="mt-3 mb-8 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{d.project}</h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
            {meta?.estado && (
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', estadoProyectoBadgeClass(meta.estado))}>{meta.estado}</span>
            )}
            <span className="text-muted-foreground">
              Manager <span className="font-medium text-foreground/85">{meta?.manager || '—'}</span>
            </span>
            {meta?.fechaAuditoria && (
              <span className="text-muted-foreground">
                Auditoría <span className="font-medium text-foreground/85">{formatFechaISO(meta.fechaAuditoria)}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {hayMensual && <VistaPeriodo vista={vista} onVista={setVista} meses={meses} mesesSel={mesesSel} onMesesSel={setMesesSel} />}
          {isAdmin && <AmpliarHorasDialog project={d.project} />}
        </div>
      </header>

      {/* Resumen del periodo: estado, cuánto se gastó y las tres cifras. El carry
          (libres / inutilizables) ya está dentro del disponible: va al pie, como detalle. */}
      <section aria-label="Resumen del banco" className="mb-10 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-5">
          <div className="flex items-center gap-2.5">
            <HorasStatusBadge status={estadoPeriodo} />
            <span className="text-sm text-muted-foreground">{periodoEnPalabras(vista, mesesSel)}</span>
          </div>
          <span className="tabular-money text-sm text-muted-foreground" title="Gastado = consumido + inutilizables">
            {cab.assigned > 0
              ? <><strong className={cn('font-semibold text-foreground', restante < 0 && 'text-(--status-excedido)')}>{PCT.format((cab.consumed + cab.inutilizables) / cab.assigned)}</strong> del asignado gastado</>
              : cab.consumed > 0 ? 'Consumo sin horas asignadas' : 'Sin horas en este periodo'}
          </span>
        </div>
        <div className="px-5 pb-5 pt-3">
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-(--muted-surface)">
            {fracConsumo > 0 && <span className={cn('h-full', HORAS_BAR_COLOR[estadoPeriodo])} style={{ width: `${fracConsumo * 100}%` }} />}
            {fracInutil > 0 && <span className="h-full bg-foreground/10" style={{ width: `${fracInutil * 100}%`, ...HATCH }} />}
          </div>
        </div>
        <dl className="grid divide-y divide-border border-t border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Cifra
            label="Asignado"
            extra={incluyeProv && (
              <span className="inline-flex items-center gap-1 rounded-full bg-(--brand)/10 px-1.5 py-px text-[0.6rem] font-medium text-(--brand)">
                <Clock aria-hidden className="size-2.5 shrink-0" />
                Provisional
              </span>
            )}
            value={formatHoras(cab.assigned)}
            caption={[
              cab.excelBase > 0 && `Excel ${formatHoras(cab.excelBase)}`,
              cab.provisional > 0 && `provisional +${formatHoras(cab.provisional)}`,
              cab.ampliado > 0 && `ampliado +${formatHoras(cab.ampliado)}`,
            ].filter(Boolean).join(' · ') || 'Sin asignación'}
          />
          <Cifra label="Consumido" value={formatHoras(cab.consumed)} />
          <Cifra label="Disponible real" value={formatHoras(restante)} excedido={restante < 0} />
        </dl>
        {hayCartasCarry && (
          <div className="flex flex-wrap gap-x-8 gap-y-2 border-t border-border bg-(--muted-surface)/40 px-5 py-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] bg-(--status-disponible)" />
              Libres (carry)
              <strong className="tabular-money font-semibold text-(--status-disponible)">+{formatHoras(cab.libres)}</strong>
              <span className="text-foreground/45">ya sumadas al disponible real</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] bg-foreground/10" style={HATCH} />
              Inutilizables
              <strong className="tabular-money font-semibold text-foreground/70">{formatHoras(cab.inutilizables)}</strong>
              <span className="text-foreground/45">ya descontadas del disponible real</span>
            </span>
          </div>
        )}
      </section>

      <section className="mb-10">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h2 className="font-display text-xl font-semibold">{esMensual ? 'Banco mensual por posición' : 'Por posición'}</h2>
          {hayCierre && <LeyendaCierre />}
        </div>
        {mesUnico ? (
          <ComoSeLee>Disponible real = asignado − consumido − inutilizables. En los meses cerrados, lo que sobra se reparte: 75% inutilizables y 25% libres, que pasan como carry forward. El asignado puede ser provisional (estimado) si el mes aún no está cargado.</ComoSeLee>
        ) : esMensual ? (
          <ComoSeLee>Cada mes muestra gastado (consumido + inutilizables) / asignado: la diferencia es lo disponible — en meses cerrados, las horas libres del carry, como reparte su barra. El asignado puede ser provisional (estimado) en los meses aún no cargados.</ComoSeLee>
        ) : hayCierre ? (
          <ComoSeLee>Desplegá una posición para ver su cierre mes a mes: consumido, inutilizables (75% del sobrante) y libres (25%, arrastran como carry forward). El mes en curso aún no sufre el corte.</ComoSeLee>
        ) : (
          <div className="mb-4" />
        )}

        {d.posiciones.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este proyecto no tiene posiciones con banco.</p>
        ) : mesUnico ? (
          /* Un solo mes: las cifras de ese mes por posición */
          <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
            <table className="w-full min-w-176 text-sm">
              <thead>
                <tr className="bg-(--muted-surface) text-left text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Posición</th>
                  <th className="px-4 py-2.5 font-medium text-right">
                    <span className="inline-flex items-center gap-1">
                      Asignado
                      {mesEsProvisional(mesUnico) && <span className="rounded-full bg-(--brand)/10 px-1 py-px text-[0.55rem] font-medium text-(--brand)">prov</span>}
                    </span>
                  </th>
                  <th className="px-4 py-2.5 font-medium text-right">Consumido</th>
                  <th className="px-4 py-2.5 font-medium text-right">Inutilizables</th>
                  <th className="px-4 py-2.5 font-medium text-right">Disponible real</th>
                  <th className="px-4 py-2.5 font-medium text-right">Estado</th>
                </tr>
              </thead>
              <tbody>
                {d.posiciones.map((p) => {
                  const m = p.monthly.find((x) => x.month === mesUnico)
                  const inutil = m?.inutilizables ?? 0
                  const sinDatos = !m || (m.assigned === 0 && m.consumed === 0)
                  const disponible = sinDatos ? 0 : m.assigned - m.consumed - inutil
                  return (
                    <tr key={p.position} className="border-t border-border">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{p.position}</div>
                        {!sinDatos && <BarraMes m={m} enCurso={mesUnico >= cmAct} className="mt-1.5 h-1.5 w-48 max-w-full" />}
                      </td>
                      <td className="tabular-money px-4 py-2.5 text-right">{sinDatos ? <span className="text-muted-foreground/40">—</span> : formatHoras(m.assigned)}</td>
                      <td className="tabular-money px-4 py-2.5 text-right">{sinDatos ? <span className="text-muted-foreground/40">—</span> : celdaResta(m.consumed)}</td>
                      <td className="tabular-money px-4 py-2.5 text-right">{sinDatos ? <span className="text-muted-foreground/40">—</span> : celdaResta(inutil)}</td>
                      <td className={cn('tabular-money px-4 py-2.5 text-right font-medium', disponible < 0 && 'text-(--status-excedido)')}>
                        {sinDatos ? <span className="font-normal text-muted-foreground/40">—</span> : formatHoras(disponible)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {sinDatos ? <span className="text-muted-foreground/40">—</span> : <HorasStatusBadge status={computeHorasStatus(m.assigned - inutil, m.consumed)} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
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
                  <th title="Asignado de los meses elegidos menos consumido e inutilizables: la misma cifra que el Disponible real de la vista Total" className="px-3 py-2.5 text-right font-medium">Disponible real</th>
                </tr>
              </thead>
              <tbody>
                {matriz.map((row) => (
                  <tr key={row.position} className="border-t border-border">
                    <td className="sticky left-0 bg-card px-4 py-2.5 font-medium whitespace-nowrap">{row.position}</td>
                    {row.porMes.map((c) => (
                      <td key={c.month} className="px-3 py-2.5 text-center whitespace-nowrap">{celdaMes(c.month, c.m)}</td>
                    ))}
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {row.sinDatos
                        ? <span className="text-muted-foreground/40">—</span>
                        : <span className={cn('tabular-money font-medium', row.disponible < 0 && 'text-(--status-excedido)')}>{formatHoras(row.disponible)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Vista Total: tabla agregada por posición */
          <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
            <table className="w-full min-w-176 text-sm">
              <thead>
                <tr className="bg-(--muted-surface) text-left text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Posición</th>
                  <th className="px-4 py-2.5 font-medium text-right">Asignado</th>
                  <th className="px-4 py-2.5 font-medium text-right">Consumido</th>
                  <th className="px-4 py-2.5 font-medium text-right">Inutilizables</th>
                  <th className="px-4 py-2.5 font-medium text-right">Disponible real</th>
                  <th className="px-4 py-2.5 font-medium text-right">Estado</th>
                </tr>
              </thead>
              <tbody>
                {d.posiciones.map((p) => {
                  const expandible = tieneCierre(p)
                  const abierta = expandible && posAbiertas.has(p.position)
                  return (
                    <Fragment key={p.position}>
                      <tr
                        className={cn('border-t border-border', expandible && 'cursor-pointer transition-colors hover:bg-(--muted-surface)/50')}
                        onClick={expandible ? () => togglePos(p.position) : undefined}
                        role={expandible ? 'button' : undefined}
                        tabIndex={expandible ? 0 : undefined}
                        aria-expanded={expandible ? abierta : undefined}
                        onKeyDown={expandible ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePos(p.position) } } : undefined}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {expandible && (
                              <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground/60 transition-transform duration-300', abierta && 'rotate-90')} />
                            )}
                            <div className="min-w-0">
                              <div className="font-medium">{p.position}</div>
                              <BarraComposicion posicion={p} className="mt-1.5 h-2 w-48 max-w-full" />
                            </div>
                          </div>
                        </td>
                        <td className="tabular-money px-4 py-2.5 text-right">{formatHoras(p.assigned)}</td>
                        <td className="tabular-money px-4 py-2.5 text-right">{celdaResta(p.consumed)}</td>
                        <td className="tabular-money px-4 py-2.5 text-right">{celdaResta(p.inutilizables)}</td>
                        <td className={cn('tabular-money px-4 py-2.5 text-right font-medium', p.remaining < 0 && 'text-(--status-excedido)')}>{formatHoras(p.remaining)}</td>
                        <td className="px-4 py-2.5 text-right"><HorasStatusBadge status={p.status} /></td>
                      </tr>
                      {abierta && (
                        <tr className="border-t border-border/60">
                          <td colSpan={6} className="bg-(--muted-surface)/40 px-4 pb-4 pt-3 md:pl-12">
                            <CierrePosicionPanel posicion={p} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
                    <td className="tabular-money px-4 py-2.5 whitespace-nowrap">{formatFechaISO(a.entry_date)}</td>
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
          Consumos y ampliaciones, del más reciente al más antiguo, con el saldo de horas disponibles antes y después.
        </p>
        {movimientos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {esMensual ? 'Sin movimientos en los meses elegidos.' : 'Sin movimientos todavía.'}
          </p>
        ) : (
          <>
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
                  {movsVisibles.map((m, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="tabular-money px-4 py-2.5 whitespace-nowrap">{formatFechaISO(m.date)}</td>
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
            {movsRecientes.length > MOVIMIENTOS_INICIALES && (
              <button
                type="button" onClick={() => setVerTodosMovs((v) => !v)}
                className="mt-3 text-sm text-muted-foreground transition-colors hover:text-(--brand)"
              >
                {verTodosMovs ? `Ver solo los ${MOVIMIENTOS_INICIALES} más recientes` : `Ver los ${movsRecientes.length} movimientos`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}
