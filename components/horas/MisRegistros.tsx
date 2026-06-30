'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil, Ban } from 'lucide-react'
import { anularRegistro } from '@/app/(horas)/mis-registros/actions'
import { cn } from '@/lib/utils'

export interface LineView { project: string; hoursLabel: string; description: string }
export interface RegistroView {
  id: string
  status: 'guardado' | 'editado' | 'anulado'
  totalLabel: string
  lines: LineView[]
}
export interface DiaView {
  date: string
  day: string
  weekday: string
  month: string
  registros: RegistroView[]
}

const STATUS: Record<string, { label: string; cls: string }> = {
  guardado: { label: 'Guardado', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20' },
  editado: { label: 'Editado', cls: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20' },
  anulado: { label: 'Anulado', cls: 'bg-foreground/[0.06] text-muted-foreground ring-1 ring-inset ring-border' },
}

export default function MisRegistros({ dias }: { dias: DiaView[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function onAnular(id: string) {
    if (!confirm('¿Anular este registro? Devolverá las horas al banco correspondiente.')) return
    setBusy(id)
    const res = await anularRegistro(id)
    setBusy(null)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Registro anulado'); router.refresh()
  }

  if (!dias.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">Todavía no registraste horas.</p>
        <Link href="/registrar" className="mt-3 inline-block text-sm font-medium text-(--brand) transition-colors hover:text-(--brand-strong)">
          Registrar mi primera jornada →
        </Link>
      </div>
    )
  }

  return (
    <ol className="space-y-6">
      {dias.map((dia) => (
        <li key={dia.date} className="grid grid-cols-[3.25rem_1fr] gap-x-4 sm:grid-cols-[4rem_1fr] sm:gap-x-6">
          {/* Tile de fecha */}
          <div className="shrink-0">
            <div className="sticky top-4 rounded-xl border border-border bg-card pb-2 pt-1.5 text-center shadow-sm">
              <p className="text-[0.56rem] font-semibold uppercase tracking-wide text-(--brand)">{dia.weekday}</p>
              <p className="font-display text-2xl font-semibold leading-none">{dia.day}</p>
              <p className="text-[0.58rem] uppercase tracking-wide text-muted-foreground">{dia.month}</p>
            </div>
          </div>

          {/* Registros del día */}
          <div className="space-y-3">
            {dia.registros.map((r) => {
              const anulado = r.status === 'anulado'
              const st = STATUS[r.status] ?? STATUS.guardado
              return (
                <article key={r.id} className={cn('rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5', anulado && 'opacity-65')}>
                  <header className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-baseline gap-2">
                      <span className={cn('font-display text-lg font-semibold tabular-nums', anulado && 'line-through')}>{r.totalLabel}</span>
                      <span className="text-xs text-muted-foreground">{r.lines.length} {r.lines.length === 1 ? 'línea' : 'líneas'}</span>
                    </div>
                    <span className={cn('rounded-full px-2.5 py-0.5 text-[0.7rem] font-medium', st.cls)}>{st.label}</span>
                  </header>

                  <ul className="divide-y divide-border/60">
                    {r.lines.map((ln, i) => (
                      <li key={i} className="flex items-baseline gap-3 py-1.5 text-sm">
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">{ln.project}</span>
                        <span className="min-w-0 flex-[1.4] truncate text-muted-foreground">{ln.description}</span>
                        <span className="w-12 shrink-0 text-right tabular-nums text-foreground/55">{ln.hoursLabel}</span>
                      </li>
                    ))}
                  </ul>

                  {!anulado && (
                    <footer className="mt-3 flex items-center gap-1 border-t border-border pt-3">
                      <Link
                        href={`/registrar?edit=${r.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-(--brand) transition-colors hover:bg-(--brand)/10"
                      >
                        <Pencil className="size-3.5" /> Editar
                      </Link>
                      <button
                        onClick={() => onAnular(r.id)}
                        disabled={busy === r.id}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-(--status-excedido)/10 hover:text-(--status-excedido) disabled:opacity-50"
                      >
                        <Ban className="size-3.5" /> {busy === r.id ? 'Anulando…' : 'Anular'}
                      </button>
                    </footer>
                  )}
                </article>
              )
            })}
          </div>
        </li>
      ))}
    </ol>
  )
}
