import Link from 'next/link'
import { getMyProjectsWithBanks } from '@/lib/hucha/queries'
import { formatEUR } from '@/lib/hucha/format'
import StatusBadge from '@/components/hucha/StatusBadge'

export default async function MisProyectosPage() {
  const projects = await getMyProjectsWithBanks()

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">HUCHA</h1>
        <p className="mt-1 text-sm text-foreground/55">
          {projects.length} {projects.length === 1 ? 'proyecto' : 'proyectos'} asignado{projects.length === 1 ? '' : 's'}
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-foreground/55">
          No tienes proyectos asignados todavía.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/presupuestos/${p.id}`}
              className="group rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:shadow-md hover:border-(--brand)/40"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium leading-tight">{p.name}</h2>
                  {p.client && <p className="mt-0.5 text-xs text-foreground/50">{p.client}</p>}
                </div>
                <StatusBadge status={p.bank.status} />
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-foreground/50">Restante</p>
                  <p className="tabular-money text-2xl font-semibold">{formatEUR(p.bank.remaining)}</p>
                </div>
                <div className="text-right text-xs text-foreground/50">
                  <p>Asignado <span className="tabular-money text-foreground/70">{formatEUR(p.bank.assigned_total)}</span></p>
                  <p>Consumido <span className="tabular-money text-foreground/70">{formatEUR(p.bank.consumed_total)}</span></p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
