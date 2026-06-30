import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getViewerScope } from '@/lib/horas/scope'
import { getEquipoComposicion, type MiembroEquipo } from '@/lib/horas/equipo'
import { formatHoras } from '@/lib/horas/format'
import { cn } from '@/lib/utils'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  guardado: 'secondary', editado: 'outline', anulado: 'destructive',
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '·'
}

function Persona({ m, manager = false }: { m: MiembroEquipo; manager?: boolean }) {
  const inactive = m.status === 'inactivo'
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-full text-[0.68rem] font-semibold',
          manager ? 'bg-(--brand) text-white shadow-sm' : 'bg-(--muted-surface) text-foreground/55 ring-1 ring-border',
          inactive && 'opacity-50',
        )}
      >
        {initials(m.name)}
      </span>
      <div className="min-w-0 leading-tight">
        <p className={cn('truncate text-sm', inactive ? 'text-muted-foreground line-through' : 'text-foreground/85')}>{m.name}</p>
        {manager && <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-(--brand)">Manager</p>}
      </div>
    </div>
  )
}

export default async function EquipoPage() {
  const viewer = await getViewerScope()
  if (!viewer) redirect('/login')
  if (viewer.role !== 'manager' && viewer.role !== 'admin') redirect('/registrar')

  const { areas: composicion, totalPersonas } = await getEquipoComposicion(viewer)

  const supabase = await createClient()
  const { data: logs } = await supabase
    .from('time_logs')
    .select('id, entry_date, total_hours, status, profiles!time_logs_user_id_fkey(full_name)')
    .order('entry_date', { ascending: false })
    .limit(200)

  type Log = { id: string; entry_date: string; total_hours: number; status: string; profiles: { full_name: string } | null }

  return (
    <div className="space-y-10">
      <header>
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-(--brand)">Bastida &amp; Farina</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Equipo</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {viewer.role === 'manager'
            ? 'El equipo emerge de las áreas que gestionas: los operativos que comparten tus áreas, y sus registros.'
            : 'Estructura del equipo por área —managers y operativos— y los registros de toda la operación.'}
        </p>
      </header>

      {/* Composición del equipo por área */}
      <section>
        <div className="mb-4 flex items-baseline justify-between border-b border-border pb-2">
          <h2 className="font-display text-lg font-semibold">
            {viewer.role === 'manager' ? 'Mi equipo' : 'Estructura por área'}
          </h2>
          {composicion.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {composicion.length} {composicion.length === 1 ? 'área' : 'áreas'} · {totalPersonas} {totalPersonas === 1 ? 'persona' : 'personas'}
            </span>
          )}
        </div>

        {composicion.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/40 px-5 py-8 text-center text-sm text-muted-foreground">
            {viewer.role === 'manager'
              ? 'No tienes áreas asignadas todavía. Pídele a administración que te asigne las áreas que gestionas.'
              : 'No hay áreas con usuarios asignados.'}
          </p>
        ) : (
          <div className="rounded-2xl border border-border bg-card px-6 shadow-sm">
            {composicion.map((a) => {
              const count = a.managers.length + a.operativos.length
              return (
                <div
                  key={a.area}
                  className="grid gap-x-10 gap-y-4 border-b border-border py-7 last:border-b-0 sm:grid-cols-[190px_1fr]"
                >
                  <div className="relative">
                    <span className="absolute -left-6 top-1 h-7 w-[3px] rounded-r-full bg-(--brand)" />
                    <h3 className="font-display text-xl font-semibold tracking-tight">{a.area}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{count} {count === 1 ? 'persona' : 'personas'}</p>
                  </div>

                  <div className="space-y-5">
                    {a.managers.length > 0 && (
                      <div className="flex flex-wrap gap-x-8 gap-y-3">
                        {a.managers.map((m, i) => <Persona key={i} m={m} manager />)}
                      </div>
                    )}
                    <div>
                      {a.managers.length > 0 && (
                        <p className="mb-2 text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">Operativos</p>
                      )}
                      {a.operativos.length === 0 ? (
                        <p className="text-sm text-muted-foreground/60">Sin operativos en esta área.</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-3">
                          {a.operativos.map((m, i) => <Persona key={i} m={m} />)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Registros del equipo */}
      <section>
        <h2 className="font-display mb-4 border-b border-border pb-2 text-lg font-semibold">Registros del equipo</h2>
        <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow className="bg-(--muted-surface) hover:bg-(--muted-surface)">
                <TableHead>Fecha</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(logs ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">Aún no hay registros.</TableCell>
                </TableRow>
              )}
              {((logs ?? []) as unknown as Log[]).map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="py-3">{l.entry_date}</TableCell>
                  <TableCell className="py-3 text-foreground/70">{l.profiles?.full_name ?? '—'}</TableCell>
                  <TableCell className="py-3 text-right tabular-money">{formatHoras(Number(l.total_hours))}</TableCell>
                  <TableCell className="py-3 text-right">
                    <Badge variant={STATUS_VARIANT[l.status] ?? 'outline'} className="capitalize">{l.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}
