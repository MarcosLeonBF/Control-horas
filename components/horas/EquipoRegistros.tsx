'use client'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { formatHoras } from '@/lib/horas/format'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

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

// Registros del equipo: una fila por registro diario (fecha/usuario/total/estado) que
// se despliega para ver el detalle de sus líneas (proyecto, área/depto, etapa, horas y
// el motivo/descripción). Mismo patrón desplegable que la lista de bancos.
export default function EquipoRegistros({ logs }: { logs: EquipoLog[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
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
      ) : (
        <ul className="divide-y divide-border">
          {logs.map((l) => {
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
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
