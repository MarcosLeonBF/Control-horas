'use client'

import { useMemo, useState } from 'react'
import { Search, AlertTriangle, TrendingDown, Download } from 'lucide-react'
import { toast } from 'sonner'
import type { DashboardRow, HuchaStatus } from '@/lib/hucha/types'
import { formatEUR, STATUS_LABELS } from '@/lib/hucha/format'
import { downloadXlsx, downloadCsv, type ExportRow } from '@/lib/export'
import { getMovimientosExport } from '@/app/(hucha)/presupuestos/dashboard/actions'
import StatusBadge from '@/components/hucha/StatusBadge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { cn } from '@/lib/utils'

function DownloadGroup({ label, onXlsx, onCsv }: { label: string; onXlsx: () => void; onCsv: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-foreground/70">{label}:</span>
      <button onClick={onXlsx} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground/70 transition-colors hover:bg-(--muted-surface) hover:text-foreground">
        <Download className="size-3" /> Excel
      </button>
      <button onClick={onCsv} className="rounded-md border border-border px-2 py-1 text-xs text-foreground/70 transition-colors hover:bg-(--muted-surface) hover:text-foreground">
        CSV
      </button>
    </span>
  )
}

// Orden por severidad: lo que pide atención, arriba.
const SEVERITY: Record<HuchaStatus, number> = {
  excedido: 0, bajo: 1, disponible: 2, consumido: 3, sin_presupuesto: 4,
}

const BAR_COLOR: Record<HuchaStatus, string> = {
  excedido: 'bg-(--status-excedido)',
  bajo: 'bg-(--status-bajo)',
  disponible: 'bg-(--status-disponible)',
  consumido: 'bg-(--status-consumido)',
  sin_presupuesto: 'bg-(--status-sin)',
}

const ESTADOS: HuchaStatus[] = ['excedido', 'bajo', 'disponible', 'consumido', 'sin_presupuesto']

const selectClass =
  'rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring'

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'excedido' | 'bajo' }) {
  return (
    <Card className="gap-1 p-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn(
        'tabular-money text-2xl font-semibold',
        tone === 'excedido' && 'text-(--status-excedido)',
        tone === 'bajo' && 'text-(--status-bajo)',
      )}>
        {value}
      </p>
    </Card>
  )
}

export default function DashboardClient({ rows }: { rows: DashboardRow[] }) {
  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState<HuchaStatus | 'todos'>('todos')
  const [manager, setManager] = useState<string>('todos')
  const [fromMov, setFromMov] = useState('')
  const [toMov, setToMov] = useState('')

  const managers = useMemo(
    () => Array.from(new Set(rows.flatMap((r) => r.managers))).sort((a, b) => a.localeCompare(b)),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => {
        if (q && !r.name.toLowerCase().includes(q) && !(r.client ?? '').toLowerCase().includes(q)) return false
        if (estado !== 'todos' && r.status !== estado) return false
        if (manager !== 'todos' && !r.managers.includes(manager)) return false
        return true
      })
      .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.name.localeCompare(b.name))
  }, [rows, search, estado, manager])

  const totals = useMemo(() => {
    const t = { assigned: 0, consumed: 0, remaining: 0, excedidos: 0, bajos: 0 }
    for (const r of filtered) {
      t.assigned += r.assigned; t.consumed += r.consumed; t.remaining += r.remaining
      if (r.status === 'excedido') t.excedidos++
      if (r.status === 'bajo') t.bajos++
    }
    return t
  }, [filtered])

  const presupuestoRows: ExportRow[] = filtered.map((r) => ({
    Proyecto: r.name, Cliente: r.client ?? '', Manager: r.managers.join(', '),
    Asignado: r.assigned, Consumido: r.consumed, Restante: r.remaining, Estado: STATUS_LABELS[r.status],
  }))

  function descargarPresupuestos(fmt: 'xlsx' | 'csv') {
    if (!presupuestoRows.length) { toast.error('No hay proyectos para descargar.'); return }
    if (fmt === 'xlsx') void downloadXlsx('hucha-presupuestos.xlsx', presupuestoRows, 'Presupuestos')
    else downloadCsv('hucha-presupuestos.csv', presupuestoRows)
  }

  async function descargarMov(type: 'consumo' | 'ampliacion', fmt: 'xlsx' | 'csv') {
    const rows = await getMovimientosExport(type, fromMov || undefined, toMov || undefined)
    if (!rows.length) { toast.error(`No hay ${type === 'consumo' ? 'consumos' : 'ampliaciones'} en el período.`); return }
    const periodo = fromMov || toMov ? `_${fromMov || 'inicio'}_${toMov || 'hoy'}` : ''
    const base = type === 'consumo' ? 'consumos' : 'ampliaciones'
    if (fmt === 'xlsx') await downloadXlsx(`hucha-${base}${periodo}.xlsx`, rows, base)
    else downloadCsv(`hucha-${base}${periodo}.csv`, rows)
  }

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Asignado total" value={formatEUR(totals.assigned)} />
        <Kpi label="Consumido total" value={formatEUR(totals.consumed)} />
        <Kpi label="Restante total" value={formatEUR(totals.remaining)} tone={totals.remaining < 0 ? 'excedido' : undefined} />
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
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar proyecto" placeholder="Buscar proyecto o cliente…"
            value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 pl-9"
          />
        </div>
        <select aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value as HuchaStatus | 'todos')} className={selectClass}>
          <option value="todos">Todos los estados</option>
          {ESTADOS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select aria-label="Manager" value={manager} onChange={(e) => setManager(e.target.value)} className={selectClass}>
          <option value="todos">Todos los managers</option>
          {managers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="ml-auto text-sm text-muted-foreground">
          {filtered.length} de {rows.length} proyectos
        </span>
      </div>

      {/* Descargas (PDF §13) */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <span className="font-medium text-muted-foreground">Descargar</span>
        <DownloadGroup label="Presupuestos" onXlsx={() => descargarPresupuestos('xlsx')} onCsv={() => descargarPresupuestos('csv')} />
        <DownloadGroup label="Consumos" onXlsx={() => descargarMov('consumo', 'xlsx')} onCsv={() => descargarMov('consumo', 'csv')} />
        <DownloadGroup label="Ampliaciones" onXlsx={() => descargarMov('ampliacion', 'xlsx')} onCsv={() => descargarMov('ampliacion', 'csv')} />
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span>Período:</span>
          <input aria-label="Desde" type="date" value={fromMov} max={toMov || undefined}
            onChange={(e) => setFromMov(e.target.value)} className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground" />
          <span>–</span>
          <input aria-label="Hasta" type="date" value={toMov} min={fromMov || undefined}
            onChange={(e) => setToMov(e.target.value)} className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground" />
          <span className="text-foreground/45">(consumos/ampliaciones)</span>
        </span>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow className="bg-(--muted-surface) hover:bg-(--muted-surface)">
              <TableHead>Proyecto</TableHead>
              <TableHead>Manager</TableHead>
              <TableHead className="w-56">Presupuesto</TableHead>
              <TableHead className="text-right">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No hay proyectos que coincidan con los filtros.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((r) => {
              const pct = r.assigned > 0 ? Math.min((r.consumed / r.assigned) * 100, 100) : 0
              return (
                <TableRow key={r.projectId}>
                  <TableCell className="py-3">
                    <div className="font-medium text-foreground">{r.name}</div>
                    {r.client && <div className="text-xs text-muted-foreground">{r.client}</div>}
                  </TableCell>
                  <TableCell className="py-3 text-foreground/70">{r.managers.length ? r.managers.join(', ') : '—'}</TableCell>
                  <TableCell className="py-3">
                    {r.assigned === 0 && r.consumed === 0 ? (
                      <span className="text-sm text-muted-foreground">Sin presupuesto</span>
                    ) : (
                      <>
                        <div className="tabular-money text-sm">
                          <span className={cn('font-medium', r.remaining < 0 && 'text-(--status-excedido)')}>{formatEUR(r.remaining)}</span>
                          <span className="text-muted-foreground"> / {formatEUR(r.assigned)}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-40 overflow-hidden rounded-full bg-(--muted-surface)">
                          <div className={cn('h-full rounded-full', BAR_COLOR[r.status])} style={{ width: `${pct}%` }} />
                        </div>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="py-3 text-right"><StatusBadge status={r.status} /></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
