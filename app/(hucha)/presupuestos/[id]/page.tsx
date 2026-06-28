import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getProjectWithBank, getMovements } from '@/lib/hucha/queries'
import { formatEUR } from '@/lib/hucha/format'
import StatusBadge from '@/components/hucha/StatusBadge'
import MovementsTable from '@/components/hucha/MovementsTable'
import ConsumoForm from './ConsumoForm'
import { createClient } from '@/lib/supabase/server'
import AmpliarForm from './AmpliarForm'

export default async function DetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const project = await getProjectWithBank(id)
  if (!project) notFound()
  const movements = await getMovements(project.bank.id)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const isAdmin = me?.role === 'admin'
  const anulledIds = new Set(movements.filter((m) => m.type === 'anulacion' && m.corrects_movement_id).map((m) => m.corrects_movement_id as string))

  return (
    <div>
      <Link href="/presupuestos" className="text-xs text-foreground/55 hover:text-foreground">← Mis presupuestos</Link>

      <header className="mt-3 mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{project.name}</h1>
          {project.client && <p className="mt-1 text-sm text-foreground/55">{project.client}</p>}
        </div>
        <StatusBadge status={project.bank.status} />
      </header>

      <div className="mb-10"><ConsumoForm projectId={project.id} remaining={project.bank.remaining} /></div>
      {isAdmin && <div className="mb-10"><AmpliarForm projectId={project.id} /></div>}

      <div className="mb-10 grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Asignado', value: project.bank.assigned_total },
          { label: 'Consumido', value: project.bank.consumed_total },
          { label: 'Restante', value: project.bank.remaining },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <p className="text-xs text-foreground/50">{s.label}</p>
            <p className="tabular-money mt-1 text-2xl font-semibold">{formatEUR(s.value)}</p>
          </div>
        ))}
      </div>

      <section>
        <h2 className="font-display mb-4 text-xl font-semibold">Historial</h2>
        <MovementsTable movements={movements} isAdmin={isAdmin} projectId={project.id} anulledIds={anulledIds} />
      </section>
    </div>
  )
}
