'use client'

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Search, AlertTriangle, TrendingDown, Download, ChevronRight, X } from 'lucide-react'
import type { BancoHorasRow, HorasStatus } from '@/lib/horas/bancos-status'
import { HORAS_STATUS_LABELS, groupBancosByProject } from '@/lib/horas/bancos-status'
import { downloadXlsx, downloadCsv, type ExportRow } from '@/lib/export'
import { formatHoras } from '@/lib/horas/format'
import HorasStatusBadge from '@/components/horas/HorasStatusBadge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import NativeSelect from '@/components/ui/native-select'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const SEVERITY: Record<HorasStatus, number> = {
  excedido: 0, bajo: 1, disponible: 2, consumido: 3, sin_asignacion: 4,
}

const BAR_COLOR: Record<HorasStatus, string> = {
  excedido: 'bg-(--status-excedido)',
  bajo: 'bg-(--status-bajo)',
  disponible: 'bg-(--status-disponible)',
  consumido: 'bg-(--status-consumido)',
  sin_asignacion: 'bg-(--status-sin)',
}

const ESTADOS: HorasStatus[] = ['excedido', 'bajo', 'disponible', 'consumido', 'sin_asignacion']

const selectClass =
  'h-10 min-w-40 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring'

// ISO "YYYY-MM-DD" → "DD/MM/YYYY" (sin desfase de zona horaria).
function formatFecha(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}

// Estilo de la insignia según el estado del proyecto (Excel Clientes_Proyectos).
function estadoProyectoClass(estado: string): string {
  const e = estado.toLowerCase()
  if (e === 'finalizado') return 'bg-foreground/[0.07] text-muted-foreground'
  if (e === 'activo') return 'bg-(--status-disponible)/12 text-(--status-disponible)'
  if (e.includes('paus')) return 'bg-(--status-pausado)/12 text-(--status-pausado)'
  return 'bg-(--muted-surface) text-muted-foreground'
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'excedido' }) {
  return (
    <Card className="gap-1 p-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('tabular-money text-2xl font-semibold', tone === 'excedido' && 'text-(--status-excedido)')}>{value}</p>
    </Card>
  )
}

// Campo de filtro etiquetado: micro-etiqueta arriba + control, para orden y legibilidad.
function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.68rem] font-medium uppercase tracking-wider text-muted-foreground/80">{label}</span>
      {children}
    </label>
  )
}

export default function BancosHorasClient({ rows }: { rows: BancoHorasRow[] }) {
  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState<HorasStatus | 'todos'>('todos')
  const [posicion, setPosicion] = useState<string>('todas')
  const [manager, setManager] = useState('todos')
  const [auditFrom, setAuditFrom] = useState('')
  const [auditTo, setAuditTo] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (project: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(project)) next.delete(project)
      else next.add(project)
      return next
    })

  const positions = useMemo(() => [...new Set(rows.map((r) => r.position))].sort((a, b) => a.localeCompare(b)), [rows])
  const managers = useMemo(
    () => [...new Set(rows.map((r) => (r.manager ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  )
  const hasSinManager = useMemo(() => rows.some((r) => !(r.manager ?? '').trim()), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => {
        if (q && !r.project.toLowerCase().includes(q) && !r.position.toLowerCase().includes(q)) return false
        if (estado !== 'todos' && r.status !== estado) return false
        if (posicion !== 'todas' && r.position !== posicion) return false
        const mgr = (r.manager ?? '').trim()
        if (manager !== 'todos' && (manager === '__sin__' ? mgr !== '' : mgr !== manager)) return false
        const fa = r.fechaAuditoria ?? ''
        if (auditFrom && (!fa || fa < auditFrom)) return false
        if (auditTo && (!fa || fa > auditTo)) return false
        return true
      })
      .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.project.localeCompare(b.project) || a.position.localeCompare(b.position))
  }, [rows, search, estado, posicion, manager, auditFrom, auditTo])

  // Agrupado por proyecto: una fila por proyecto con el banco total; el desglose por
  // posición se ve al desplegar. El total refleja las posiciones visibles (con filtros).
  const groups = useMemo(
    () => groupBancosByProject(filtered).sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.project.localeCompare(b.project)),
    [filtered],
  )

  const totals = useMemo(() => {
    const t = { assigned: 0, consumed: 0, remaining: 0, excedidos: 0, bajos: 0 }
    for (const r of filtered) {
      t.assigned += r.assigned; t.consumed += r.consumed; t.remaining += r.remaining
      if (r.status === 'excedido') t.excedidos++
      if (r.status === 'bajo') t.bajos++
    }
    return t
  }, [filtered])

  // Descarga de la vista filtrada (§17.5: bancos de horas; excedidos/cerca = filtrar estado + descargar).
  function buildRows(): ExportRow[] {
    return filtered.map((r) => ({
      Proyecto: r.project, 'Estado proyecto': r.projectEstado ?? '—',
      Manager: r.manager || '—', 'Fecha auditoría': r.fechaAuditoria ? formatFecha(r.fechaAuditoria) : '—',
      Posición: r.position,
      Asignado: r.assigned, Consumido: r.consumed, Restante: r.remaining, 'Estado banco': HORAS_STATUS_LABELS[r.status],
    }))
  }
  const fileBase = `bancos-horas${estado === 'todos' ? '' : `-${estado}`}`

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Asignado total" value={formatHoras(totals.assigned)} />
        <Kpi label="Consumido total" value={formatHoras(totals.consumed)} />
        <Kpi label="Restante total" value={formatHoras(totals.remaining)} tone={totals.remaining < 0 ? 'excedido' : undefined} />
        <Card className="gap-2 p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Atención</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="inline-flex items-center gap-1.5 text-(--status-excedido)">
              <AlertTriangle className="size-4" /> <strong className="tabular-money">{totals.excedidos}</strong> excedidos
            </span>
            <span className="inline-flex items-center gap-1.5 text-(--status-bajo)">
              <TrendingDown className="size-4" /> <strong className="tabular-money">{totals.bajos}</strong> bajos
            </span>
          </div>
        </Card>
      </div>

      {/* Filtros */}
      <div className="space-y-3.5">
        {/* Buscar + resumen */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Buscar proyecto" placeholder="Buscar proyecto…"
              value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 pl-9"
            />
          </div>
          <span className="shrink-0 text-sm text-muted-foreground">
            <strong className="tabular-money font-semibold text-foreground">{groups.length}</strong> {groups.length === 1 ? 'proyecto' : 'proyectos'}
            <span className="px-1.5 text-foreground/25">·</span>
            <span className="tabular-money">{filtered.length}</span> bancos
          </span>
        </div>

        {/* Facetas etiquetadas */}
        <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
          <FilterField label="Posición">
            <NativeSelect aria-label="Posición" value={posicion} onChange={(e) => setPosicion(e.target.value)} className={selectClass}>
              <option value="todas">Todas</option>
              {positions.map((p) => <option key={p} value={p}>{p}</option>)}
            </NativeSelect>
          </FilterField>
          <FilterField label="Estado del banco">
            <NativeSelect aria-label="Estado del banco" value={estado} onChange={(e) => setEstado(e.target.value as HorasStatus | 'todos')} className={selectClass}>
              <option value="todos">Todos</option>
              {ESTADOS.map((s) => <option key={s} value={s}>{HORAS_STATUS_LABELS[s]}</option>)}
            </NativeSelect>
          </FilterField>
          <FilterField label="Manager">
            <NativeSelect aria-label="Manager" value={manager} onChange={(e) => setManager(e.target.value)} className={selectClass}>
              <option value="todos">Todos</option>
              {managers.map((m) => <option key={m} value={m}>{m}</option>)}
              {hasSinManager && <option value="__sin__">Sin manager</option>}
            </NativeSelect>
          </FilterField>
          <FilterField label="Fecha de auditoría">
            <div className="flex items-center gap-1.5">
              <Input aria-label="Auditoría desde" type="date" value={auditFrom} max={auditTo || undefined} onChange={(e) => setAuditFrom(e.target.value)} className="h-10 w-34" />
              <span aria-hidden className="text-muted-foreground/60">–</span>
              <Input aria-label="Auditoría hasta" type="date" value={auditTo} min={auditFrom || undefined} onChange={(e) => setAuditTo(e.target.value)} className="h-10 w-34" />
            </div>
          </FilterField>
          {(search || estado !== 'todos' || posicion !== 'todas' || manager !== 'todos' || auditFrom || auditTo) && (
            <button
              onClick={() => { setSearch(''); setEstado('todos'); setPosicion('todas'); setManager('todos'); setAuditFrom(''); setAuditTo('') }}
              className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:text-(--brand)"
            >
              <X className="size-3.5" /> Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* Descargas (PDF §17.5) */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Descargar bancos:</span>
        <button onClick={() => void downloadXlsx(`${fileBase}.xlsx`, buildRows(), 'Bancos')}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-foreground/70 transition-colors hover:bg-(--muted-surface) hover:text-foreground">
          <Download className="size-3.5" /> Excel
        </button>
        <button onClick={() => downloadCsv(`${fileBase}.csv`, buildRows())}
          className="rounded-lg border border-border px-2.5 py-1.5 text-foreground/70 transition-colors hover:bg-(--muted-surface) hover:text-foreground">
          CSV
        </button>
      </div>

      {/* Lista agrupada por proyecto: desplegar una fila para ver el desglose por posición */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="hidden items-center gap-4 border-b border-border bg-(--muted-surface) px-5 py-2.5 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-muted-foreground md:flex">
          <span className="flex-1">Proyecto</span>
          <span className="w-44 text-right">Banco total</span>
          <span className="w-28 text-right">Estado</span>
        </div>

        {groups.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-muted-foreground">No hay bancos que coincidan con los filtros.</p>
        ) : (
          <ul className="divide-y divide-border">
            {groups.map((g) => {
              const open = expanded.has(g.project)
              const pct = g.assigned > 0 ? Math.min((g.consumed / g.assigned) * 100, 100) : 0
              return (
                <li key={g.project}>
                  <button
                    type="button"
                    onClick={() => toggle(g.project)}
                    aria-expanded={open}
                    className="group flex w-full items-center gap-3 px-4 py-3.5 text-left outline-none transition-colors hover:bg-(--muted-surface)/50 focus-visible:bg-(--muted-surface)/50 md:gap-4 md:px-5"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2.5">
                      <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground/60 transition-transform duration-300 group-hover:text-(--brand)', open && 'rotate-90')} />
                      <span className="truncate font-display text-[0.95rem] font-medium text-foreground">{g.project}</span>
                      {g.projectEstado && (
                        <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[0.62rem] font-medium', estadoProyectoClass(g.projectEstado))}>
                          {g.projectEstado}
                        </span>
                      )}
                      <span className="hidden shrink-0 text-xs text-muted-foreground/60 sm:inline">
                        {g.positions.length} {g.positions.length === 1 ? 'posición' : 'posiciones'}
                      </span>
                    </span>

                    {/* Banco total con barra (escritorio) */}
                    <span className="hidden w-44 shrink-0 md:block">
                      <span className="tabular-money block text-right text-sm leading-none">
                        <span className={cn('font-medium', g.remaining < 0 && 'text-(--status-excedido)')}>{formatHoras(g.remaining)}</span>
                        <span className="text-muted-foreground"> / {formatHoras(g.assigned)}</span>
                      </span>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-(--muted-surface)">
                        <span className={cn('block h-full rounded-full', BAR_COLOR[g.status])} style={{ width: `${pct}%` }} />
                      </span>
                    </span>

                    {/* Banco total compacto (móvil) */}
                    <span className="tabular-money shrink-0 text-right text-sm md:hidden">
                      <span className={cn('font-medium', g.remaining < 0 && 'text-(--status-excedido)')}>{formatHoras(g.remaining)}</span>
                      <span className="text-muted-foreground">/{formatHoras(g.assigned)}</span>
                    </span>

                    <span className="w-28 shrink-0 text-right"><HorasStatusBadge status={g.status} /></span>
                  </button>

                  {/* Desglose por posición (desplegable animado) */}
                  <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                    <div className="overflow-hidden">
                      <div className="border-t border-border/60 bg-(--muted-surface)/40 px-4 pb-4 pt-2 md:px-5 md:pl-11">
                        {(g.manager || g.fechaAuditoria) && (
                          <div className="mb-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                            {g.manager && <span>Manager <span className="font-medium text-foreground/80">{g.manager}</span></span>}
                            {g.fechaAuditoria && <span>Auditoría <span className="font-medium text-foreground/80">{formatFecha(g.fechaAuditoria)}</span></span>}
                          </div>
                        )}
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-md text-sm">
                            <thead>
                              <tr className="text-left text-[0.7rem] uppercase tracking-wide text-muted-foreground/80">
                                <th className="py-2 pr-3 font-medium">Posición</th>
                                <th className="py-2 pr-3 font-medium text-right">Asignado</th>
                                <th className="py-2 pr-3 font-medium text-right">Consumido</th>
                                <th className="py-2 pr-3 font-medium text-right">Restante</th>
                                <th className="py-2 font-medium text-right">Estado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.positions.map((p) => (
                                <tr key={p.position} className="border-t border-border/50">
                                  <td className="py-2 pr-3"><Badge variant="secondary">{p.position}</Badge></td>
                                  <td className="tabular-money py-2 pr-3 text-right text-foreground/80">{formatHoras(p.assigned)}</td>
                                  <td className="tabular-money py-2 pr-3 text-right text-foreground/80">{formatHoras(p.consumed)}</td>
                                  <td className={cn('tabular-money py-2 pr-3 text-right font-medium', p.remaining < 0 && 'text-(--status-excedido)')}>{formatHoras(p.remaining)}</td>
                                  <td className="py-2 text-right"><HorasStatusBadge status={p.status} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <Link
                          href={`/bancos/${encodeURIComponent(g.project)}`}
                          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-(--brand) transition-colors hover:text-(--brand-strong)"
                        >
                          Ver detalle completo <ChevronRight className="size-3.5" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
