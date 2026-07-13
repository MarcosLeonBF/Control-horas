'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronRight, Pencil, Ban } from 'lucide-react'
import { formatHoras } from '@/lib/horas/format'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { anularRegistroEquipo } from '@/app/(horas)/equipo/actions'

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  guardado: 'secondary', editado: 'outline', anulado: 'destructive',
}

// Una línea del registro, con nombres ya resueltos (para mostrar en el desglose).
export interface EquipoLineDetail {
  project: string
  hours: number
  description: string
  department: string
  area: string
  etapa: string
}

// Un registro diario (time_log) del equipo, con sus líneas.
export interface EquipoLog {
  id: string
  entry_date: string
  total_hours: number
  status: string
  user: string
  lines: EquipoLineDetail[]
}

type Estado = 'todos' | 'guardado' | 'editado' | 'anulado'

const inputCls = 'rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring'

// Registros del equipo: una fila por registro diario que se despliega para ver sus líneas.
// El admin ve acciones Editar/Anular en el panel desplegado. Un buscador + filtros acotan
// la lista (client-side sobre los registros ya cargados).
export default function EquipoRegistros({ logs, isAdmin = false }: { logs: EquipoLog[]; isAdmin?: boolean }) {
  const router = useRouter()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState<Estado>('todos')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function onAnular(id: string) {
    if (!confirm('¿Anular este registro? Devolverá las horas al banco correspondiente.')) return
    setBusy(id)
    const res = await anularRegistroEquipo(id)
    setBusy(null)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Registro anulado'); router.refresh()
  }

  // Filtro client-side sobre los logs ya cargados (mismo patrón que la lista de bancos).
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return logs.filter((l) => {
      if (estado !== 'todos' && l.status !== estado) return false
      if (desde && l.entry_date < desde) return false
      if (hasta && l.entry_date > hasta) return false
      if (needle) {
        const inUser = l.user.toLowerCase().includes(needle)
        const inProject = l.lines.some((ln) => ln.project.toLowerCase().includes(needle))
        if (!inUser && !inProject) return false
      }
      return true
    })
  }, [logs, q, estado, desde, hasta])

  return (
    <div className="space-y-3">
      {/* Toolbar: buscador + filtros */}
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="min-w-52 flex-1 space-y-1">
          <span className="block text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">Buscar registro</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Usuario o proyecto…" aria-label="Buscar registro" className={cn(inputCls, 'w-full')} />
        </label>
        <label className="space-y-1">
          <span className="block text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">Estado</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value as Estado)} aria-label="Filtrar por estado" className={inputCls}>
            <option value="todos">Todos</option>
            <option value="guardado">Guardado</option>
            <option value="editado">Editado</option>
            <option value="anulado">Anulado</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Desde" className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className="block text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Hasta" className={inputCls} />
        </label>
      </div>

      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        {/* Cabecera (escritorio) */}
        <div className="hidden items-center gap-4 border-b border-border bg-(--muted-surface) px-4 py-2.5 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-muted-foreground md:flex">
          <span className="w-4" aria-hidden />
          <span className="w-28">Fecha</span>
          <span className="flex-1">Usuario</span>
          <span className="w-20 text-right">Total</span>
          <span className="w-24 text-right">Estado</span>
        </div>

        {logs.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Aún no hay registros.</p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No hay registros que coincidan con los filtros.</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((l) => {
              const open = expanded.has(l.id)
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => toggle(l.id)}
                    aria-expanded={open}
                    className="group flex w-full items-center gap-4 px-4 py-3 text-left outline-none transition-colors hover:bg-(--muted-surface)/50 focus-visible:bg-(--muted-surface)/50"
                  >
                    <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground/60 transition-transform duration-300 group-hover:text-(--brand)', open && 'rotate-90')} />
                    <span className="w-28 shrink-0 tabular-money text-sm whitespace-nowrap text-foreground/70">{l.entry_date}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground/85">{l.user}</span>
                    <span className="w-20 shrink-0 text-right tabular-money text-sm font-medium">{formatHoras(l.total_hours)}</span>
                    <span className="w-24 shrink-0 text-right">
                      <Badge variant={STATUS_VARIANT[l.status] ?? 'outline'} className="capitalize">{l.status}</Badge>
                    </span>
                  </button>

                  {/* Detalle de las líneas (desplegable animado) */}
                  <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                    <div className="overflow-hidden">
                      <div className="border-t border-border/60 bg-(--muted-surface)/40 px-4 pb-4 pt-2 md:pl-12">
                        {l.lines.length === 0 ? (
                          <p className="py-2 text-sm text-muted-foreground">Este registro no tiene líneas.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-2xl text-sm">
                              <thead>
                                <tr className="text-left text-[0.7rem] uppercase tracking-wide text-muted-foreground/80">
                                  <th className="py-2 pr-4 font-medium">Proyecto</th>
                                  <th className="py-2 pr-4 font-medium">Área / Depto</th>
                                  <th className="py-2 pr-4 font-medium">Etapa</th>
                                  <th className="py-2 pr-4 font-medium text-right">Horas</th>
                                  <th className="py-2 font-medium">Descripción</th>
                                </tr>
                              </thead>
                              <tbody>
                                {l.lines.map((ln, i) => (
                                  <tr key={i} className="border-t border-border/50 align-top">
                                    <td className="py-2 pr-4 font-medium whitespace-nowrap">{ln.project}</td>
                                    <td className="py-2 pr-4 text-foreground/70 whitespace-nowrap">{ln.project === 'Departamento' ? (ln.department || '—') : (ln.area || '—')}</td>
                                    <td className="py-2 pr-4 text-foreground/70 whitespace-nowrap">{ln.etapa || '—'}</td>
                                    <td className="py-2 pr-4 text-right tabular-money whitespace-nowrap">{formatHoras(ln.hours)}</td>
                                    <td className="py-2 text-foreground/80">{ln.description || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Acciones del admin: corregir (editar) o anular el registro ajeno. */}
                        {isAdmin && l.status !== 'anulado' && (
                          <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3">
                            <Link
                              href={`/registrar?edit=${l.id}`}
                              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-(--brand) transition-colors hover:bg-(--brand)/10"
                            >
                              <Pencil className="size-4" /> Editar
                            </Link>
                            <button
                              onClick={() => onAnular(l.id)}
                              disabled={busy === l.id}
                              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                            >
                              <Ban className="size-4" /> {busy === l.id ? 'Anulando…' : 'Anular'}
                            </button>
                          </div>
                        )}
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
