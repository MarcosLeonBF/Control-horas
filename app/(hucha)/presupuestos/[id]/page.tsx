import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getProjectWithBank, getMovements } from '@/lib/hucha/queries'
import { formatEUR } from '@/lib/hucha/format'
import type { HuchaStatus } from '@/lib/hucha/types'
import { cn } from '@/lib/utils'
import StatusBadge from '@/components/hucha/StatusBadge'
import MovementsTable from '@/components/hucha/MovementsTable'
import { createClient } from '@/lib/supabase/server'
import ConsumoDialog from './ConsumoDialog'
import AmpliarDialog from './AmpliarDialog'

const PCT = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 0 })

const BAR_COLOR: Record<HuchaStatus, string> = {
  disponible: 'bg-(--status-disponible)',
  bajo: 'bg-(--status-bajo)',
  consumido: 'bg-(--status-consumido)',
  excedido: 'bg-(--status-excedido)',
  sin_presupuesto: 'bg-(--status-sin)',
}

// Una cifra del resumen, como en Bancos de horas: rótulo, valor y de qué se compone.
function Cifra({ label, value, caption, excedido }: { label: string; value: string; caption?: string; excedido?: boolean }) {
  return (
    <div className="p-5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('tabular-money mt-1 text-2xl font-semibold', excedido && 'text-(--status-excedido)')}>{value}</dd>
      {caption && <dd className="mt-1 text-xs text-muted-foreground">{caption}</dd>}
    </div>
  )
}

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

  const { bank } = project
  const assigned = Number(bank.assigned_total)
  const consumed = Number(bank.consumed_total)
  const remaining = Number(bank.remaining)
  // asignado = Excel + ampliaciones vigentes (invariante de la 0011).
  const excel = Number(bank.excel_hucha ?? assigned)
  const ampliado = assigned - excel
  const consumos = movements.filter((m) => m.type === 'consumo' && !anulledIds.has(m.id)).length
  // Barra: consumido sobre asignado, llena si se pasó.
  const frac = assigned > 0 ? Math.min(consumed / assigned, 1) : consumed > 0 ? 1 : 0

  return (
    <div>
      <Link href="/presupuestos" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft aria-hidden className="size-3.5" />HUCHA</Link>

      <header className="mt-3 mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{project.name}</h1>
        {project.client && <p className="mt-1 text-sm text-muted-foreground">{project.client}</p>}
      </header>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <ConsumoDialog projectId={project.id} projectName={project.name} remaining={remaining} />
        {isAdmin && <AmpliarDialog projectId={project.id} projectName={project.name} />}
      </div>

      <section aria-label="Resumen de la hucha" className="mb-10 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-5">
          <StatusBadge status={bank.status} />
          <span className="tabular-money text-sm text-muted-foreground">
            {assigned > 0
              ? <><strong className={cn('font-semibold text-foreground', remaining < 0 && 'text-(--status-excedido)')}>{PCT.format(consumed / assigned)}</strong> del presupuesto consumido</>
              : consumed > 0 ? 'Consumo sin presupuesto' : 'Sin presupuesto asignado'}
          </span>
        </div>
        <div className="px-5 pb-5 pt-3">
          <div aria-hidden className="h-2 overflow-hidden rounded-full bg-(--muted-surface)">
            <span
              className={cn(
                'block h-full origin-left transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-safe:animate-[meter-fill_0.9s_cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                BAR_COLOR[bank.status],
              )}
              style={{ transform: `scaleX(${frac})` }}
            />
          </div>
        </div>
        <dl className="grid divide-y divide-border border-t border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Cifra
            label="Asignado"
            value={formatEUR(assigned)}
            caption={assigned === 0 ? undefined : ampliado > 0 ? `Excel ${formatEUR(excel)} · ampliado +${formatEUR(ampliado)}` : `Excel ${formatEUR(excel)}`}
          />
          <Cifra label="Consumido" value={formatEUR(consumed)} caption={consumos === 0 ? 'Sin consumos' : `${consumos} ${consumos === 1 ? 'consumo' : 'consumos'}`} />
          <Cifra label="Restante" value={formatEUR(remaining)} excedido={remaining < 0} />
        </dl>
      </section>

      <section>
        <h2 className="font-display mb-4 text-xl font-semibold">Historial</h2>
        <MovementsTable movements={movements} isAdmin={isAdmin} projectId={project.id} anulledIds={anulledIds} />
      </section>
    </div>
  )
}
