'use client'

import { useMemo, useState } from 'react'
import { ChevronRight, Download, Filter, X } from 'lucide-react'
import type { AuditAction, AuditDateBase, AuditEntry, AuditGroup, AuditGroupBy } from '@/lib/horas/auditoria-types'
import {
  AUDIT_ACTIONS, AUDIT_ACTION_LABELS, AUDIT_GROUP_LABELS, AUDIT_GROUP_ORDER,
  agrupar, filtrar, opcionesDe, resumir,
} from '@/lib/horas/auditoria-types'
import { downloadXlsx, downloadCsv, type ExportRow } from '@/lib/export'
import { formatHoras, formatFechaISO } from '@/lib/horas/format'
import NativeSelect from '@/components/ui/native-select'
import { Stat, selectFiltroClass } from '@/components/horas/Stat'
import { cn } from '@/lib/utils'

// Rejilla compartida por la cabecera de columnas y cada fila, para que no se
// desalineen al plegar y desplegar grupos.
const ROW_GRID = 'grid w-full grid-cols-[1.25rem_8.5rem_6rem_6.5rem_1fr_1fr_4.5rem] items-center gap-3'

const ACTION_STYLE: Record<AuditAction, string> = {
  crear: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  editar: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  anular: 'bg-rose-50 text-rose-700 ring-rose-600/20',
}

function AccionBadge({ action }: { action: AuditAction }) {
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', ACTION_STYLE[action])}>
      {AUDIT_ACTION_LABELS[action]}
    </span>
  )
}

const cuando = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })

export default function AuditoriaView({
  entries,
  base,
  from,
  to,
}: {
  entries: AuditEntry[]
  base: AuditDateBase
  from: string
  to: string
}) {
  const [acciones, setAcciones] = useState<AuditAction[]>([])
  const [fActor, setFActor] = useState('')
  const [fSubject, setFSubject] = useState('')
  const [groupBy, setGroupBy] = useState<AuditGroupBy>('none')
  // Grupos desplegados. Al agrupar se empieza con todos plegados: con 18 actores,
  // abrirlos todos de golpe es la misma pared de filas que había antes.
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())

  const opciones = useMemo(() => opcionesDe(entries), [entries])
  const filtradas = useMemo(
    () => filtrar(entries, { acciones, actorKey: fActor, subjectKey: fSubject }),
    [entries, acciones, fActor, fSubject],
  )
  const resumen = useMemo(() => resumir(filtradas), [filtradas])
  const grupos = useMemo(() => agrupar(filtradas, groupBy, base), [filtradas, groupBy, base])

  const hayFiltros = acciones.length > 0 || fActor !== '' || fSubject !== ''
  const todoAbierto = grupos.length > 0 && abiertos.size === grupos.length

  function toggleAccion(a: AuditAction) {
    setAcciones((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]))
  }
  function toggleGrupo(key: string) {
    setAbiertos((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  function limpiar() {
    setAcciones([])
    setFActor('')
    setFSubject('')
  }
  function cambiarAgrupacion(g: AuditGroupBy) {
    setGroupBy(g)
    setAbiertos(new Set())
  }

  function buildExport(): ExportRow[] {
    return filtradas.map((e) => ({
      Cuándo: cuando(e.at),
      Acción: AUDIT_ACTION_LABELS[e.action],
      'Fecha del registro': e.entryDate ?? '',
      'Usuario afectado': e.subjectName,
      'Quien edita': e.actorName,
      Total: e.totalHours ?? '',
    }))
  }
  const exportBase = `auditoria_${from}_${to}`

  return (
    <div className="animate-fade-up space-y-6">
      {/* Resumen */}
      <div className="grid gap-5 rounded-2xl border border-border bg-card px-6 py-5 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Movimientos" value={String(resumen.movimientos)} accent="brand" />
        <Stat label="Ediciones" value={String(resumen.ediciones)} accent="wine" />
        <Stat label="Anulaciones" value={String(resumen.anulaciones)} accent="muted" />
        <Stat label="Personas que editaron" value={String(resumen.personas)} accent="muted" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Filter className="size-4" /> Filtrar
        </span>
        <div className="flex gap-1.5">
          {AUDIT_ACTIONS.map((a) => {
            const activo = acciones.includes(a)
            return (
              <button
                key={a}
                type="button"
                aria-pressed={activo}
                onClick={() => toggleAccion(a)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors',
                  activo ? ACTION_STYLE[a] : 'text-muted-foreground ring-border hover:text-foreground',
                )}
              >
                {AUDIT_ACTION_LABELS[a]}
              </button>
            )
          })}
        </div>
        <NativeSelect aria-label="Filtrar por quien edita" value={fActor} onChange={(e) => setFActor(e.target.value)} className={selectFiltroClass}>
          <option value="">Cualquiera edita</option>
          {opciones.actores.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Filtrar por usuario afectado" value={fSubject} onChange={(e) => setFSubject(e.target.value)} className={selectFiltroClass}>
          <option value="">Cualquier usuario afectado</option>
          {opciones.sujetos.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </NativeSelect>
        {hayFiltros && (
          <button onClick={limpiar} className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <X className="size-3.5" /> Limpiar
          </button>
        )}
      </div>

      {/* Agrupar por + descarga */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <span className="shrink-0 text-sm text-muted-foreground">Agrupar por</span>
          <div className="flex min-w-0 overflow-x-auto rounded-full border border-border bg-card p-1">
            {AUDIT_GROUP_ORDER.map((g) => (
              <button
                key={g}
                onClick={() => cambiarAgrupacion(g)}
                className={cn(
                  'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                  groupBy === g ? 'bg-(--brand) text-white shadow-sm' : 'text-foreground/55 hover:text-foreground',
                )}
              >
                {AUDIT_GROUP_LABELS[g]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {groupBy !== 'none' && grupos.length > 0 && (
            <button
              onClick={() => setAbiertos(todoAbierto ? new Set() : new Set(grupos.map((g) => g.key)))}
              className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-(--muted-surface) hover:text-foreground"
            >
              {todoAbierto ? 'Plegar todo' : 'Desplegar todo'}
            </button>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span className="text-sm text-muted-foreground">Descargar:</span>
            <button
              onClick={() => void downloadXlsx(`${exportBase}.xlsx`, buildExport(), 'Auditoría')}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-(--muted-surface) hover:text-foreground"
            >
              <Download className="size-3.5" /> Excel
            </button>
            <button
              onClick={() => downloadCsv(`${exportBase}.csv`, buildExport())}
              className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-(--muted-surface) hover:text-foreground"
            >
              CSV
            </button>
          </span>
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <div className="min-w-200">
            <div className={cn(ROW_GRID, 'border-b border-border bg-(--muted-surface) px-5 py-3 text-[0.7rem] uppercase tracking-[0.12em] text-muted-foreground')}>
              <span />
              <span>Cuándo</span>
              <span>Acción</span>
              <span>Registro</span>
              <span>De</span>
              <span>Por</span>
              <span className="text-right">Total</span>
            </div>

            {filtradas.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-muted-foreground">
                No hay movimientos con estos filtros en el rango seleccionado.
              </p>
            ) : groupBy === 'none' ? (
              <ul>
                {filtradas.map((e) => (
                  <li key={e.id} className="border-b border-border/60 last:border-0">
                    <Fila entry={e} />
                  </li>
                ))}
              </ul>
            ) : (
              <ul>
                {grupos.map((g) => (
                  <li key={g.key} className="border-b border-border/60 last:border-0">
                    <CabeceraGrupo grupo={g} abierto={abiertos.has(g.key)} onToggle={() => toggleGrupo(g.key)} />
                    {abiertos.has(g.key) && (
                      <ul className="bg-(--muted-surface)/30">
                        {g.entries.map((e) => (
                          <li key={e.id} className="border-t border-border/40">
                            <Fila entry={e} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CabeceraGrupo({ grupo, abierto, onToggle }: { grupo: AuditGroup; abierto: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={abierto}
      className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-(--muted-surface)/60 focus:outline-none focus-visible:bg-(--muted-surface)/60"
    >
      <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', abierto && 'rotate-90')} aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{grupo.label}</span>
      <span className="shrink-0 text-sm text-muted-foreground">
        {grupo.entries.length} {grupo.entries.length === 1 ? 'movimiento' : 'movimientos'}
      </span>
      <span className="hidden shrink-0 gap-1.5 sm:flex">
        {AUDIT_ACTIONS.filter((a) => grupo.counts[a] > 0).map((a) => (
          <span key={a} className={cn('rounded-full px-2 py-0.5 text-xs ring-1 ring-inset', ACTION_STYLE[a])}>
            {grupo.counts[a]} {AUDIT_ACTION_LABELS[a].toLowerCase()}
          </span>
        ))}
      </span>
      <span className="w-20 shrink-0 text-right tabular-money text-sm font-medium">{formatHoras(grupo.hours)}</span>
    </button>
  )
}

function Fila({ entry }: { entry: AuditEntry }) {
  return (
    <div className={cn(ROW_GRID, 'px-5 py-3 text-sm')}>
      <span />
      <span className="tabular-money text-foreground/70">{cuando(entry.at)}</span>
      <span><AccionBadge action={entry.action} /></span>
      <span className="tabular-money text-foreground/70">{entry.entryDate ? formatFechaISO(entry.entryDate) : '—'}</span>
      <span className="truncate text-foreground/70" title={entry.subjectName}>{entry.subjectName}</span>
      <span className="truncate text-foreground/70" title={entry.actorName}>{entry.actorName}</span>
      <span className="text-right tabular-money">{entry.totalHours != null ? formatHoras(entry.totalHours) : '—'}</span>
    </div>
  )
}
