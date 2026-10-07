'use client'

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Search, AlertTriangle, TrendingDown, Download, ChevronRight, X, Clock } from 'lucide-react'
import type { BancoHorasRow, HorasStatus, BancoHorasProyecto } from '@/lib/horas/bancos-status'
import { HORAS_STATUS_LABELS, HORAS_SEVERITY, HORAS_BAR_COLOR, groupBancosByProject, estadoProyectoBadgeClass, computeHorasStatus } from '@/lib/horas/bancos-status'
import { downloadXlsx, downloadCsv, type ExportRow } from '@/lib/export'
import { formatHoras, formatHorasTotal, formatFechaISO, currentMonth } from '@/lib/horas/format'
import HorasStatusBadge from '@/components/horas/HorasStatusBadge'
import VistaPeriodo, { periodoEnPalabras, type Vista } from '@/components/horas/VistaPeriodo'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import NativeSelect from '@/components/ui/native-select'
import { cn } from '@/lib/utils'

const ESTADOS: HorasStatus[] = ['excedido', 'bajo', 'disponible', 'consumido', 'sin_asignacion']

// Orden por estado del proyecto: activo (y garantía) primero, luego pausa, luego el
// resto, y finalizado al fondo.
function estadoOrden(estado?: string): number {
  const e = (estado ?? '').toLowerCase()
  if (e === 'activo' || e.includes('garant')) return 0
  if (e.includes('paus')) return 1
  if (e === 'finalizado') return 3
  return 2
}

// Un proyecto excedido en UNA posición y otro excedido en TODAS se ven igual en el
// badge, porque el estado se calcula sobre los totales. Cuando solo lo están algunas
// se dice debajo del badge cuál (o cuántas posiciones de cuántas); si lo están todas,
// "Excedido" a secas ya es exacto. El badge queda igual en todas las filas.
function excedidoParcial(g: BancoHorasProyecto): boolean {
  return g.status === 'excedido' && g.excedidas.length > 0 && g.excedidas.length < g.positions.length
}
function excedidoDetalle(g: BancoHorasProyecto): string | undefined {
  if (!excedidoParcial(g)) return undefined
  return g.excedidas.length === 1
    ? `en ${g.excedidas[0]}`
    : `en ${g.excedidas.length} de ${g.positions.length} posiciones`
}
function excedidoTitle(g: BancoHorasProyecto): string | undefined {
  return excedidoParcial(g) ? `Excedido en: ${g.excedidas.join(', ')}` : undefined
}

const selectClass =
  'h-10 min-w-40 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring'

// `hint`: a qué periodo se refiere la cifra, para que no se lea como el total del banco
// cuando la vista es Mensual.
function Kpi({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'excedido' }) {
  return (
    <Card className="gap-1 p-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('tabular-money text-2xl font-semibold', tone === 'excedido' && 'text-(--status-excedido)')}>{value}</p>
      <p className="text-xs text-muted-foreground/80">{hint}</p>
    </Card>
  )
}

// Lo que le queda al proyecto (o lo que se pasó), bajo la barra de la fila. Descuenta los
// inutilizables del carry, igual que el estado: por eso un proyecto puede estar excedido
// con el consumido por debajo del asignado, y el title lo explica.
function restanteFila(g: BancoHorasProyecto): { texto: string; excedido: boolean; title?: string } | null {
  if (g.assigned === 0 && g.consumed === 0) return null
  const title = g.inutilizables > 0 ? `Descuenta ${formatHoras(g.inutilizables)} inutilizables del carry` : undefined
  return g.remaining < 0
    ? { texto: `${formatHoras(-g.remaining)} de más`, excedido: true, title }
    : { texto: `Quedan ${formatHoras(g.remaining)}`, excedido: false, title }
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

// `managerInicial`: el nombre del Excel del manager en sesión; el filtro arranca en él.
export default function BancosHorasClient({ rows, managerInicial }: { rows: BancoHorasRow[]; managerInicial?: string }) {
  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState<HorasStatus | 'todos'>('todos')
  const [posicion, setPosicion] = useState<string>('todas')
  const [manager, setManager] = useState(managerInicial ?? 'todos')
  const [auditFrom, setAuditFrom] = useState('')
  const [auditTo, setAuditTo] = useState('')
  // Los finalizados salen ocultos; la casilla los muestra.
  const [mostrarFinalizados, setMostrarFinalizados] = useState(false)
  // Se entra en Mensual, en el mes en curso; Total solo si el Excel aún no trae meses
  // (entonces no hay switch).
  const [vista, setVista] = useState<Vista>(() => (rows.some((r) => r.monthly.length > 0) ? 'mensual' : 'total'))
  // Selección de meses (multi): por defecto el mes en curso, o el último con datos.
  const [mesesSel, setMesesSel] = useState<string[]>(() => {
    const s = new Set<string>()
    for (const r of rows) for (const m of r.monthly) s.add(m.month)
    const disp = [...s].sort()
    const cm = currentMonth()
    return disp.includes(cm) ? [cm] : disp.length ? [disp[disp.length - 1]] : [cm]
  })
  const selSet = useMemo(() => new Set(mesesSel), [mesesSel])

  const positions = useMemo(() => [...new Set(rows.map((r) => r.position))].sort((a, b) => a.localeCompare(b)), [rows])
  const managers = useMemo(
    () => [...new Set(rows.map((r) => (r.manager ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  )
  const hasSinManager = useMemo(() => rows.some((r) => !(r.manager ?? '').trim()), [rows])

  // Meses con datos (Excel o consumo) en cualquier fila. Si el Excel aún no tiene
  // la columna Fecha, no hay meses y el switch Mensual no se muestra.
  const meses = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) for (const m of r.monthly) s.add(m.month)
    return [...s].sort()
  }, [rows])
  const hayMensual = meses.length > 0

  // En Mensual, cada fila muestra las cifras del mes elegido (0/0 si no tiene datos:
  // decisión de producto — el proyecto se ve en cero, no desaparece).
  // En Mensual, cada fila suma los meses elegidos (assigned/consumed de esos meses);
  // provisional = true si alguno de los meses elegidos es provisional.
  const viewRows = useMemo(() => {
    if (vista === 'total') return rows.map((r) => ({ ...r, provisional: r.monthly.some((m) => m.provisional) }))
    return rows.map((r) => {
      let assigned = 0, consumed = 0, provisional = false, inutilizables = 0, libres = 0
      for (const m of r.monthly) {
        if (!selSet.has(m.month)) continue
        assigned += m.assigned; consumed += m.consumed
        inutilizables += m.inutilizables ?? 0; libres += m.libres ?? 0
        if (m.provisional) provisional = true
      }
      // En Mensual el restante/status del mes se mantienen crudos (el corte se ve en el
      // detalle); inutilizables/carryNeto llevan lo de los meses elegidos para el export.
      return { ...r, assigned, consumed, remaining: assigned - consumed, status: computeHorasStatus(assigned, consumed), provisional, inutilizables, carryNeto: libres }
    })
  }, [rows, vista, selSet])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return viewRows
      .filter((r) => {
        if (q && !r.project.toLowerCase().includes(q) && !r.position.toLowerCase().includes(q)) return false
        if (estado !== 'todos' && r.status !== estado) return false
        if (posicion !== 'todas' && r.position !== posicion) return false
        const mgr = (r.manager ?? '').trim()
        if (manager !== 'todos' && (manager === '__sin__' ? mgr !== '' : mgr !== manager)) return false
        const fa = r.fechaAuditoria ?? ''
        if (auditFrom && (!fa || fa < auditFrom)) return false
        if (auditTo && (!fa || fa > auditTo)) return false
        if (!mostrarFinalizados && (r.projectEstado ?? '').toLowerCase() === 'finalizado') return false
        return true
      })
      .sort((a, b) =>
        estadoOrden(a.projectEstado) - estadoOrden(b.projectEstado)
        || HORAS_SEVERITY[a.status] - HORAS_SEVERITY[b.status]
        || a.project.localeCompare(b.project) || a.position.localeCompare(b.position))
  }, [viewRows, search, estado, posicion, manager, auditFrom, auditTo, mostrarFinalizados])

  // Agrupado por proyecto: una fila por proyecto con el banco total; el desglose por
  // posición se ve al desplegar. Orden: por estado (activo → pausa → finalizado), y
  // dentro por severidad y nombre.
  const groups = useMemo(
    () => groupBancosByProject(filtered).sort((a, b) =>
      estadoOrden(a.projectEstado) - estadoOrden(b.projectEstado)
      || HORAS_SEVERITY[a.status] - HORAS_SEVERITY[b.status]
      || a.project.localeCompare(b.project)),
    [filtered],
  )

  // Excedidos y bajos se cuentan por PROYECTO, como los badges de la lista (antes eran
  // bancos/posiciones y no cuadraban con el contador de proyectos de al lado).
  const totals = useMemo(() => {
    const t = { assigned: 0, consumed: 0, remaining: 0, excedidos: 0, bajos: 0 }
    for (const r of filtered) {
      t.assigned += r.assigned; t.consumed += r.consumed; t.remaining += r.remaining
    }
    for (const g of groups) {
      if (g.status === 'excedido') t.excedidos++
      if (g.status === 'bajo') t.bajos++
    }
    return t
  }, [filtered, groups])
  const hintPeriodo = periodoEnPalabras(vista, mesesSel)

  // En Mensual, el asignado del mes puede incluir horas provisionales (estimadas). Lo
  // avisamos en los KPIs y lo marcamos en la descarga para no mezclarlas con lo confirmado.
  const hayProvisional = useMemo(() => filtered.some((r) => r.provisional), [filtered])

  // Descarga de la vista filtrada (§17.5: bancos de horas; excedidos/cerca = filtrar estado + descargar).
  function buildRows(): ExportRow[] {
    return filtered.map((r) => ({
      Proyecto: r.project, 'Estado proyecto': r.projectEstado ?? '—',
      Manager: r.manager || '—', 'Fecha auditoría': r.fechaAuditoria ? formatFechaISO(r.fechaAuditoria) : '—',
      Posición: r.position,
      Asignado: r.assigned, Provisional: r.provisional ? 'Sí' : 'No',
      Consumido: r.consumed, Restante: r.remaining,
      Inutilizables: r.inutilizables, 'Libres (carry)': r.carryNeto,
      'Estado banco': HORAS_STATUS_LABELS[r.status],
    }))
  }
  const fileBase = `bancos-horas${vista === 'mensual' ? `-${mesesSel.length === 1 ? mesesSel[0] : `${mesesSel.length}meses`}` : ''}${estado === 'todos' ? '' : `-${estado}`}`

  return (
    <div className="space-y-6">
      {/* Cabecera: el periodo (Total | Mensual, spec §5.1) gobierna toda la página, KPIs
          incluidos, así que va arriba junto al título. Solo si el Excel ya trae meses. */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="font-display text-2xl">Bancos de horas</h1>
          <p className="text-sm text-muted-foreground">Horas asignadas (Excel) frente a las registradas, por proyecto y posición.</p>
        </div>
        {hayMensual && (
          <VistaPeriodo vista={vista} onVista={setVista} meses={meses} mesesSel={mesesSel} onMesesSel={setMesesSel} />
        )}
      </header>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Asignado" value={formatHorasTotal(totals.assigned)} hint={hintPeriodo} />
        <Kpi label="Consumido" value={formatHorasTotal(totals.consumed)} hint={hintPeriodo} />
        <Kpi label="Restante" value={formatHorasTotal(totals.remaining)} hint={hintPeriodo} tone={totals.remaining < 0 ? 'excedido' : undefined} />
        <Card className="gap-1 p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Atención</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 py-1 text-sm">
            <span className="inline-flex items-center gap-1.5 text-(--status-excedido)">
              <AlertTriangle className="size-4" /> <strong className="tabular-money">{totals.excedidos}</strong> excedidos
            </span>
            <span className="inline-flex items-center gap-1.5 text-(--status-bajo)">
              <TrendingDown className="size-4" /> <strong className="tabular-money">{totals.bajos}</strong> bajos
            </span>
          </div>
          <p className="text-xs text-muted-foreground/80">De {groups.length} {groups.length === 1 ? 'proyecto' : 'proyectos'}</p>
        </Card>
      </div>

      {hayProvisional && (
        <p className="-mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Clock aria-hidden className="mt-px size-3.5 shrink-0 text-(--brand)" />
          <span>
            El asignado incluye horas <span className="font-medium text-(--brand)">provisionales</span>: estimadas por tipo de contrato hasta que se cargue el mes real. Van marcadas con «Prov.» y en la columna «Provisional» de la descarga.
          </span>
        </p>
      )}

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
          <label className="inline-flex h-10 cursor-pointer select-none items-center gap-2 self-end rounded-lg border border-border bg-card px-3 text-sm text-foreground transition-colors hover:bg-(--muted-surface)">
            <input
              type="checkbox"
              checked={mostrarFinalizados}
              onChange={(e) => setMostrarFinalizados(e.target.checked)}
              className="size-4 accent-(--brand)"
            />
            Mostrar finalizados
          </label>
          {(search || estado !== 'todos' || posicion !== 'todas' || manager !== 'todos' || auditFrom || auditTo || mostrarFinalizados) && (
            <button
              onClick={() => { setSearch(''); setEstado('todos'); setPosicion('todas'); setManager('todos'); setAuditFrom(''); setAuditTo(''); setMostrarFinalizados(false) }}
              className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:text-(--brand)"
            >
              <X className="size-3.5" /> Limpiar filtros
            </button>
          )}
          {/* Descargas (PDF §17.5): de lo que se ve, así que viven con los filtros. */}
          <div className="ml-auto flex items-center gap-2 self-end text-sm">
            <span className="text-muted-foreground">Descargar</span>
            <button onClick={() => void downloadXlsx(`${fileBase}.xlsx`, buildRows(), 'Bancos')}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-foreground/80 transition-colors hover:bg-(--muted-surface) hover:text-foreground">
              <Download className="size-3.5" /> Excel
            </button>
            <button onClick={() => downloadCsv(`${fileBase}.csv`, buildRows())}
              className="inline-flex h-10 items-center rounded-lg border border-border bg-card px-3 text-foreground/80 transition-colors hover:bg-(--muted-surface) hover:text-foreground">
              CSV
            </button>
          </div>
        </div>
      </div>

      {/* Lista agrupada por proyecto: click en una fila abre el detalle del proyecto */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="hidden items-center gap-4 border-b border-border bg-(--muted-surface) px-5 py-2.5 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-muted-foreground md:flex">
          <span className="flex-1">Proyecto</span>
          <span className="w-44 text-right">Consumido / asignado</span>
          <span className="w-40 text-right">Estado</span>
          <span className="w-4" aria-hidden />
        </div>

        {groups.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-muted-foreground">No hay bancos que coincidan con los filtros.</p>
        ) : (
          <ul className="divide-y divide-border">
            {groups.map((g) => {
              // Sin asignado pero con consumo ya está excedido: barra llena, no vacía.
              const pct = g.assigned > 0 ? Math.min((g.consumed / g.assigned) * 100, 100) : g.consumed > 0 ? 100 : 0
              const resto = restanteFila(g)
              // «Prov.» va junto al nombre (es un atributo del banco, no del estado):
              // la columna de estado queda solo para el badge, sin chips que colisionen.
              const marcaProv = vista === 'mensual'
                ? g.monthly.some((m) => selSet.has(m.month) && m.provisional)
                : g.monthly.some((m) => m.provisional)
              return (
                <li key={g.project}>
                  <Link
                    href={`/bancos/${encodeURIComponent(g.project)}`}
                    className="group flex w-full items-center gap-3 px-4 py-3.5 outline-none transition-colors hover:bg-(--muted-surface)/50 focus-visible:bg-(--muted-surface)/50 md:gap-4 md:px-5"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2.5">
                        <span className="truncate font-display text-[0.95rem] font-medium text-foreground transition-colors group-hover:text-(--brand)">{g.project}</span>
                        {g.projectEstado && (
                          <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[0.62rem] font-medium', estadoProyectoBadgeClass(g.projectEstado))}>
                            {g.projectEstado}
                          </span>
                        )}
                        {marcaProv && (
                          <span title="El asignado incluye horas provisionales (estimadas)" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-(--brand)/10 px-1.5 py-px text-[0.62rem] font-medium text-(--brand)">
                            <Clock aria-hidden className="size-2.5 shrink-0" />
                            Prov.
                          </span>
                        )}
                        <span className="hidden shrink-0 text-xs text-muted-foreground/60 sm:inline">
                          {g.positions.length} {g.positions.length === 1 ? 'posición' : 'posiciones'}
                        </span>
                      </span>
                      {(g.manager || g.fechaAuditoria) && (
                        <span className="flex flex-wrap gap-x-4 text-[0.7rem] text-muted-foreground/70">
                          {g.manager && <span>Manager <span className="text-foreground/70">{g.manager}</span></span>}
                          {g.fechaAuditoria && <span>Auditoría <span className="text-foreground/70">{formatFechaISO(g.fechaAuditoria)}</span></span>}
                        </span>
                      )}
                    </span>

                    {/* Banco total con barra (escritorio) */}
                    <span className="hidden w-44 shrink-0 md:block">
                      <span className="tabular-money block text-right text-sm leading-none">
                        <span className={cn('font-medium', g.remaining < 0 && 'text-(--status-excedido)')}>{formatHoras(g.consumed)}</span>
                        <span className="text-muted-foreground"> / {formatHoras(g.assigned)}</span>
                      </span>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-(--muted-surface)">
                        <span className={cn('block h-full rounded-full', HORAS_BAR_COLOR[g.status])} style={{ width: `${pct}%` }} />
                      </span>
                      {resto && (
                        <span title={resto.title} className={cn('mt-1.5 block text-right text-[0.7rem] leading-none', resto.excedido ? 'text-(--status-excedido)' : 'text-muted-foreground')}>
                          {resto.texto}
                        </span>
                      )}
                    </span>

                    {/* Banco total compacto (móvil) */}
                    <span className="tabular-money shrink-0 text-right text-sm md:hidden">
                      <span className={cn('font-medium', g.remaining < 0 && 'text-(--status-excedido)')}>{formatHoras(g.consumed)}</span>
                      <span className="text-muted-foreground">/{formatHoras(g.assigned)}</span>
                    </span>

                    <span className="flex w-32 shrink-0 flex-col items-end justify-center gap-1 md:w-40" title={excedidoTitle(g)}>
                      {vista === 'mensual' && g.assigned === 0 && g.consumed === 0 && !marcaProv
                        ? <span aria-label="Sin datos este mes" className="text-sm text-muted-foreground/50">—</span>
                        : <HorasStatusBadge status={g.status} />}
                      {excedidoDetalle(g) && (
                        <span className="max-w-full truncate text-[0.7rem] leading-none text-rose-700/80">{excedidoDetalle(g)}</span>
                      )}
                    </span>
                    <ChevronRight className="hidden size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-(--brand) md:block" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
