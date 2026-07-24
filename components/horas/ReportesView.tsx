'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, Download, Filter, X } from 'lucide-react'
import type { ReporteLine, ReporteFilterOptions, GroupBy, AggRow } from '@/lib/horas/reportes-types'
import { GROUP_LABELS, GROUP_ORDER, aggregate, conMesesVacios, groupKeyOf } from '@/lib/horas/reportes-types'
import { downloadXlsx, downloadCsv, type ExportRow } from '@/lib/export'
import { formatHoras, formatHorasTotal, formatFechaISO } from '@/lib/horas/format'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import NativeSelect from '@/components/ui/native-select'
import { cn } from '@/lib/utils'

// Rejilla compartida por la tabla principal y el nivel 1 del modal, para que las
// columnas (#/etiqueta/barra/horas/%) queden alineadas en ambos sitios.
const ROW_GRID = 'grid w-full grid-cols-[2.5rem_1fr_minmax(8rem,1.4fr)_5rem_3.5rem] items-center gap-3'

const selectClass =
  'h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring'

function DownloadGroup({ label, onXlsx, onCsv }: { label: string; onXlsx: () => void; onCsv: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-sm text-muted-foreground">{label}:</span>
      <button onClick={onXlsx} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-(--muted-surface) hover:text-foreground">
        <Download className="size-3.5" /> Excel
      </button>
      <button onClick={onCsv} className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-(--muted-surface) hover:text-foreground">
        CSV
      </button>
    </span>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'brand' | 'wine' | 'muted' }) {
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

// Fila de ranking: etiqueta + barra de reparto + horas + %. La usa la tabla
// principal (leading = nº de orden) y el nivel 1 del modal (leading = chevron).
// Si recibe onClick se renderiza como <button> (foco y Enter/Espacio nativos).
function RankRow({
  leading, label, hours, pct, barW, onClick, muted = false,
}: {
  leading: ReactNode
  label: string
  hours: number
  pct: number
  barW: number
  onClick?: () => void
  // Fila sin horas (un mes vacío del rango): se lee como hueco, no como fila rota.
  muted?: boolean
}) {
  const inner = (
    <>
      <span className="text-right text-xs tabular-money text-muted-foreground">{leading}</span>
      <span className={cn('truncate text-left', muted ? 'text-muted-foreground' : 'font-medium text-foreground')} title={label}>{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-(--muted-surface)">
        <span className="block h-full rounded-full bg-(--brand)" style={{ width: `${barW}%` }} />
      </span>
      <span className={cn('text-right tabular-money', muted ? 'text-muted-foreground' : 'font-medium')}>{formatHoras(hours)}</span>
      <span className="text-right text-xs tabular-money text-muted-foreground">{pct.toFixed(0)}%</span>
    </>
  )
  const base = cn(ROW_GRID, 'px-5 py-3 text-sm')
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(base, 'cursor-pointer transition-colors hover:bg-(--muted-surface)/60 focus:outline-none focus-visible:bg-(--muted-surface)/60')}
    >
      {inner}
    </button>
  ) : (
    <div className={base}>{inner}</div>
  )
}

export default function ReportesView({
  lines,
  options,
  from,
  to,
}: {
  lines: ReporteLine[]
  options: ReporteFilterOptions
  from: string
  to: string
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>('project')
  const [fProject, setFProject] = useState('')
  const [fUser, setFUser] = useState('')
  const [fArea, setFArea] = useState('')
  const [fPosition, setFPosition] = useState('')
  // Drill-down: fila abierta en el modal + qué sub-filas tienen sus registros desplegados.
  const [selected, setSelected] = useState<AggRow | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // El histórico son cierres MENSUALES previos a la plataforma (fechados a fin de mes,
  // sin área ni descripción). Se incluye por defecto; el interruptor deja verlo aparte.
  const [conHistorico, setConHistorico] = useState(true)
  const hayHistorico = useMemo(() => lines.some((l) => l.historico), [lines])

  // Nombre a mostrar por usuario (con email si hay homónimos), indexado por id.
  const userLabel = useMemo(() => new Map(options.users.map((u) => [u.id, u.label])), [options.users])

  const filtered = useMemo(
    () =>
      lines.filter(
        (l) =>
          (conHistorico || !l.historico) &&
          (!fProject || l.project === fProject) &&
          (!fUser || l.userId === fUser) &&
          (!fArea || l.area === fArea) &&
          (!fPosition || l.position === fPosition),
      ),
    [lines, conHistorico, fProject, fUser, fArea, fPosition],
  )

  const rows = useMemo(() => {
    const base = aggregate(filtered, groupBy)
    // Solo Mes rellena huecos. Rellenar días vacíos metería cada fin de semana y cada
    // festivo como fila: ruido, no información.
    return groupBy === 'month' ? conMesesVacios(base, from, to) : base
  }, [filtered, groupBy, from, to])

  const totals = useMemo(() => {
    let total = 0
    let internas = 0
    for (const l of filtered) {
      total += l.hours
      if (l.isInternal) internas += l.hours
    }
    return { total, internas, cliente: total - internas, lineas: filtered.length }
  }, [filtered])

  // Máximo real: con orden por fecha el primer registro ya no es el mayor.
  const max = rows.reduce((m, r) => Math.max(m, r.hours), 0)
  const hasFilters = fProject || fUser || fArea || fPosition
  const dimLabel = GROUP_LABELS[groupBy]

  // --- Drill-down -----------------------------------------------------------
  // El desglose es siempre por usuario; si ya agrupamos por usuario, por proyecto
  // (desglosar usuario dentro de usuario no aporta nada).
  const subGroupBy: GroupBy = groupBy === 'user' ? 'project' : 'user'

  // Líneas de la fila abierta (parten de `filtered`: el modal respeta los filtros).
  const subLines = useMemo(
    () => (selected ? filtered.filter((l) => groupKeyOf(l, groupBy) === selected.key) : []),
    [selected, filtered, groupBy],
  )
  const subRows = useMemo(() => aggregate(subLines, subGroupBy), [subLines, subGroupBy])
  const subMax = subRows.reduce((m, r) => Math.max(m, r.hours), 0)

  // Nivel 2: registros de una sub-fila, de más reciente a más antiguo.
  function registrosDe(subKey: string): ReporteLine[] {
    return subLines
      .filter((l) => groupKeyOf(l, subGroupBy) === subKey)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }

  function abrirFila(row: AggRow) {
    setSelected(row)
    setExpanded(new Set())
  }
  function toggleSubFila(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  // Etiqueta a mostrar de una clave (los usuarios llevan email si hay homónimos).
  const labelDe = (dim: GroupBy, row: AggRow) => (dim === 'user' ? (userLabel.get(row.key) ?? row.label) : row.label)

  // Resumen agrupado (consumo por la dimensión elegida).
  function buildResumen(): ExportRow[] {
    return rows.map((r) => ({ [dimLabel]: groupBy === 'user' ? (userLabel.get(r.key) ?? r.label) : r.label, Horas: r.hours }))
  }
  // Detalle: líneas de registro crudas (§17.5 "descarga de líneas de registro").
  // El histórico no trae descripción: se rotula "Histórico" igual que en pantalla, para
  // que en la descarga se distinga de un registro de la plataforma al que le falta el
  // motivo (ese sí se va en blanco). El área del histórico se queda en "—": esa hoja
  // tampoco la trae y se decidió no inventarla.
  function buildDetalle(): ExportRow[] {
    return filtered.map((l) => ({
      Fecha: l.date, Usuario: userLabel.get(l.userId) ?? l.user, Posición: l.position, Proyecto: l.project, Área: l.area,
      Departamento: l.department, Etapa: l.etapa, Horas: l.hours,
      Descripción: l.description || (l.historico ? 'Histórico' : ''),
    }))
  }
  // Registros de horas: totales diarios por usuario (§17.5 "descarga de registros de horas").
  function buildRegistros(): ExportRow[] {
    const map = new Map<string, { Fecha: string; Usuario: string; Total: number }>()
    for (const l of filtered) {
      const key = `${l.date}|${l.userId}`
      const cur = map.get(key) ?? { Fecha: l.date, Usuario: userLabel.get(l.userId) ?? l.user, Total: 0 }
      cur.Total += l.hours
      map.set(key, cur)
    }
    return [...map.values()]
      .map((r) => ({ ...r, Total: Math.round(r.Total * 100) / 100 }))
      .sort((a, b) => (a.Fecha < b.Fecha ? 1 : a.Fecha > b.Fecha ? -1 : a.Usuario.localeCompare(b.Usuario)))
  }
  const resumenBase = `reporte-horas-por-${groupBy}_${from}_${to}`
  const detalleBase = `detalle-horas_${from}_${to}`
  const registrosBase = `registros-horas_${from}_${to}`

  return (
    <div className="animate-fade-up space-y-7">
      {/* Resumen */}
      <div className="grid gap-5 rounded-2xl border border-border bg-card px-6 py-5 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total de horas" value={formatHorasTotal(totals.total)} accent="brand" />
        <Stat label="Horas cliente" value={formatHorasTotal(totals.cliente)} accent="wine" />
        <Stat label="Horas internas" value={formatHorasTotal(totals.internas)} accent="muted" />
        <Stat label="Líneas" value={String(totals.lineas)} accent="muted" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Filter className="size-4" /> Filtrar
        </span>
        <NativeSelect aria-label="Filtrar por proyecto" value={fProject} onChange={(e) => setFProject(e.target.value)} className={selectClass}>
          <option value="">Todos los proyectos</option>
          {options.projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Filtrar por usuario" value={fUser} onChange={(e) => setFUser(e.target.value)} className={selectClass}>
          <option value="">Todos los usuarios</option>
          {options.users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Filtrar por área" value={fArea} onChange={(e) => setFArea(e.target.value)} className={selectClass}>
          <option value="">Todas las áreas</option>
          {options.areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Filtrar por posición" value={fPosition} onChange={(e) => setFPosition(e.target.value)} className={selectClass}>
          <option value="">Todas las posiciones</option>
          {options.positions.map((p) => <option key={p} value={p}>{p}</option>)}
        </NativeSelect>
        {hasFilters && (
          <button
            onClick={() => { setFProject(''); setFUser(''); setFArea(''); setFPosition('') }}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" /> Limpiar
          </button>
        )}
        {hayHistorico && (
          <label
            title="Cierres mensuales previos a la plataforma: van fechados a fin de mes y no traen área ni descripción."
            className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <input
              type="checkbox"
              checked={conHistorico}
              onChange={(e) => setConHistorico(e.target.checked)}
              className="size-4 accent-(--brand)"
            />
            Incluir histórico
          </label>
        )}
      </div>

      {/* Agrupar por + descargas */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <span className="shrink-0 text-sm text-muted-foreground">Agrupar por</span>
          <div className="flex min-w-0 overflow-x-auto rounded-full border border-border bg-card p-1">
            {GROUP_ORDER.map((g) => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className={cn(
                  'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                  groupBy === g ? 'bg-(--brand) text-white shadow-sm' : 'text-foreground/55 hover:text-foreground',
                )}
              >
                {GROUP_LABELS[g]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <DownloadGroup
            label="Resumen"
            onXlsx={() => void downloadXlsx(`${resumenBase}.xlsx`, buildResumen(), 'Resumen')}
            onCsv={() => downloadCsv(`${resumenBase}.csv`, buildResumen())}
          />
          <DownloadGroup
            label="Detalle"
            onXlsx={() => void downloadXlsx(`${detalleBase}.xlsx`, buildDetalle(), 'Detalle')}
            onCsv={() => downloadCsv(`${detalleBase}.csv`, buildDetalle())}
          />
          <DownloadGroup
            label="Registros"
            onXlsx={() => void downloadXlsx(`${registrosBase}.xlsx`, buildRegistros(), 'Registros')}
            onCsv={() => downloadCsv(`${registrosBase}.csv`, buildRegistros())}
          />
        </div>
      </div>

      {/* Agrupando por mes con un rango dentro del mismo mes sale una única fila al
          100%, que se lee como un fallo. El rango no se toca: es del manager. */}
      {groupBy === 'month' && from.slice(0, 7) === to.slice(0, 7) && (
        <p className="text-sm text-muted-foreground">
          Solo hay un mes en el rango. Amplía las fechas para comparar mes a mes.
        </p>
      )}

      {/* Tabla */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
        <div className="min-w-136">
        <div className="grid grid-cols-[2.5rem_1fr_minmax(8rem,1.4fr)_5rem_3.5rem] items-center gap-3 border-b border-border bg-(--muted-surface) px-5 py-3 text-[0.7rem] uppercase tracking-[0.12em] text-muted-foreground">
          <span className="text-right">#</span>
          <span>{dimLabel}</span>
          <span>Reparto</span>
          <span className="text-right">Horas</span>
          <span className="text-right">%</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-muted-foreground">
            No hay horas registradas con estos filtros en el rango seleccionado.
          </p>
        ) : (
          <ul>
            {rows.map((r, i) => (
              <li key={r.key} className="border-b border-border/60 last:border-0">
                <RankRow
                  leading={i + 1}
                  label={labelDe(groupBy, r)}
                  hours={r.hours}
                  pct={totals.total > 0 ? (r.hours / totals.total) * 100 : 0}
                  barW={max > 0 ? (r.hours / max) * 100 : 0}
                  // Sin horas no hay desglose que abrir: RankRow cae a <div> y pierde
                  // foco y cursor sin trabajo extra.
                  onClick={r.hours > 0 ? () => abrirFila(r) : undefined}
                  muted={r.hours === 0}
                />
              </li>
            ))}
          </ul>
        )}
        {rows.length > 0 && (
          <div className="grid grid-cols-[2.5rem_1fr_minmax(8rem,1.4fr)_5rem_3.5rem] items-center gap-3 border-t border-border bg-(--muted-surface) px-5 py-3 text-sm">
            <span />
            <span className="font-display font-semibold">Total</span>
            <span />
            <span className="text-right tabular-money font-semibold">{formatHorasTotal(totals.total)}</span>
            <span className="text-right text-xs text-muted-foreground">100%</span>
          </div>
        )}
        </div>
        </div>
      </div>

      {/* Desglose de la fila pinchada: nivel 1 = sub-dimensión, nivel 2 = registros. */}
      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selected ? `${labelDe(groupBy, selected)} — ${formatHorasTotal(selected.hours)}` : ''}
            </DialogTitle>
            <DialogDescription>
              Desglose por {GROUP_LABELS[subGroupBy].toLowerCase()}. Abre una fila para ver sus registros.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <ul>
              {subRows.map((sr) => {
                const abierto = expanded.has(sr.key)
                return (
                  <li key={sr.key} className="border-b border-border/60 last:border-0">
                    <RankRow
                      leading={<ChevronRight className={cn('inline size-3.5 transition-transform', abierto && 'rotate-90')} />}
                      label={labelDe(subGroupBy, sr)}
                      hours={sr.hours}
                      pct={selected && selected.hours > 0 ? (sr.hours / selected.hours) * 100 : 0}
                      barW={subMax > 0 ? (sr.hours / subMax) * 100 : 0}
                      onClick={() => toggleSubFila(sr.key)}
                    />
                    {abierto && (
                      <ul className="border-t border-border/40 bg-(--muted-surface)/40 py-1">
                        {registrosDe(sr.key).map((l, i) => (
                          <li
                            key={`${l.date}-${i}`}
                            className="grid grid-cols-[6rem_1fr_4.5rem] items-baseline gap-3 py-1.5 pr-5 pl-13 text-xs"
                          >
                            <span className="tabular-money text-muted-foreground">{formatFechaISO(l.date)}</span>
                            <span className="truncate text-foreground/80" title={l.description || (l.historico ? 'Histórico' : undefined)}>
                              {l.description || (l.historico ? 'Histórico' : '—')}
                            </span>
                            <span className="text-right tabular-money font-medium">{formatHoras(l.hours)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
