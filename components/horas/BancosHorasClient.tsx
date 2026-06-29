'use client'

import { useMemo, useState } from 'react'
import { Search, AlertTriangle, TrendingDown } from 'lucide-react'
import type { BancoHorasRow, HorasStatus } from '@/lib/horas/bancos-status'
import { HORAS_STATUS_LABELS } from '@/lib/horas/bancos-status'
import { formatHoras } from '@/lib/horas/format'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
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

const BADGE: Record<HorasStatus, string> = {
  disponible: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  bajo: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  consumido: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  excedido: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  sin_asignacion: 'bg-neutral-100 text-neutral-500 ring-neutral-400/20',
}

const ESTADOS: HorasStatus[] = ['excedido', 'bajo', 'disponible', 'consumido', 'sin_asignacion']

const selectClass =
  'rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring'

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'excedido' }) {
  return (
    <Card className="gap-1 p-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('tabular-money text-2xl font-semibold', tone === 'excedido' && 'text-(--status-excedido)')}>{value}</p>
    </Card>
  )
}

export default function BancosHorasClient({ rows }: { rows: BancoHorasRow[] }) {
  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState<HorasStatus | 'todos'>('todos')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => {
        if (q && !r.project.toLowerCase().includes(q)) return false
        if (estado !== 'todos' && r.status !== estado) return false
        return true
      })
      .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.project.localeCompare(b.project))
  }, [rows, search, estado])

  const totals = useMemo(() => {
    const t = { assigned: 0, consumed: 0, remaining: 0, excedidos: 0, bajos: 0 }
    for (const r of filtered) {
      t.assigned += r.assigned; t.consumed += r.consumed; t.remaining += r.remaining
      if (r.status === 'excedido') t.excedidos++
      if (r.status === 'bajo') t.bajos++
    }
    return t
  }, [filtered])

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
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar proyecto" placeholder="Buscar proyecto…"
            value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 pl-9"
          />
        </div>
        <select aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value as HorasStatus | 'todos')} className={selectClass}>
          <option value="todos">Todos los estados</option>
          {ESTADOS.map((s) => <option key={s} value={s}>{HORAS_STATUS_LABELS[s]}</option>)}
        </select>
        <span className="ml-auto text-sm text-muted-foreground">{filtered.length} de {rows.length} proyectos</span>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow className="bg-(--muted-surface) hover:bg-(--muted-surface)">
              <TableHead>Proyecto</TableHead>
              <TableHead className="w-64">Horas</TableHead>
              <TableHead className="text-right">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                  No hay proyectos que coincidan con los filtros.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((r) => {
              const pct = r.assigned > 0 ? Math.min((r.consumed / r.assigned) * 100, 100) : 0
              return (
                <TableRow key={r.project}>
                  <TableCell className="py-3 font-medium text-foreground">{r.project}</TableCell>
                  <TableCell className="py-3">
                    <div className="tabular-money text-sm">
                      <span className={cn('font-medium', r.remaining < 0 && 'text-(--status-excedido)')}>{formatHoras(r.remaining)}</span>
                      <span className="text-muted-foreground"> / {formatHoras(r.assigned)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-48 overflow-hidden rounded-full bg-(--muted-surface)">
                      <div className={cn('h-full rounded-full', BAR_COLOR[r.status])} style={{ width: `${pct}%` }} />
                    </div>
                  </TableCell>
                  <TableCell className="py-3 text-right">
                    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', BADGE[r.status])}>
                      {HORAS_STATUS_LABELS[r.status]}
                    </span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
