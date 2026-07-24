import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getViewerScope } from '@/lib/horas/scope'
import { getEquipoComposicion, type MiembroEquipo } from '@/lib/horas/equipo'
import { areaIcon } from '@/lib/horas/area-icon'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { cn } from '@/lib/utils'
import EquipoRegistros, { type EquipoLog } from '@/components/horas/EquipoRegistros'

const pad = (n: number) => String(n).padStart(2, '0')
const localISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '·'
}

// Chip compacto: los nombres fluyen en línea (densidad) en vez de cuadrícula
// dispersa. El manager se distingue por el chip teñido de marca (sin repetir
// el rótulo "Manager" en cada nombre: lo pone el eyebrow del grupo).
function PersonaChip({ m, manager = false }: { m: MiembroEquipo; manager?: boolean }) {
  const inactive = m.status === 'inactivo'
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-2 rounded-full py-1 pl-1 pr-3',
        manager ? 'bg-(--brand)/8 ring-1 ring-(--brand)/25' : 'bg-(--muted-surface) ring-1 ring-border',
        inactive && 'opacity-55',
      )}
    >
      <span
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-full text-[0.55rem] font-semibold',
          manager ? 'bg-(--brand) text-white' : 'bg-background text-foreground/55 ring-1 ring-border',
        )}
      >
        {initials(m.name)}
      </span>
      <span className={cn('truncate text-sm', manager ? 'font-medium text-foreground' : 'text-foreground/85', inactive && 'text-muted-foreground')}>
        {m.name}
      </span>
      {inactive && <span className="text-[0.55rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">Inactivo</span>}
    </span>
  )
}

type RawLog = {
  id: string; entry_date: string; total_hours: number; status: string
  profiles: { full_name: string } | null
  time_log_lines: { project: string; hours: number; description: string | null; department: string | null; areas: { name: string } | null; etapas: { name: string } | null }[] | null
}

export default async function EquipoPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams
  const viewer = await getViewerScope()
  if (!viewer) redirect('/login')
  if (viewer.role !== 'manager' && viewer.role !== 'admin') redirect('/registrar')

  const { areas: composicion, totalPersonas } = await getEquipoComposicion(viewer)

  // El rango de fechas se resuelve en la consulta, no en el cliente: antes se traían
  // los 200 registros más recientes y el filtro de fecha se aplicaba sobre ESE recorte,
  // así que nada anterior al corte podía aparecer por mucho que se ampliara el rango
  // (y el día del corte salía a medias). Mismo criterio de rango que Reportes.
  const now = new Date()
  const from = sp.from || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
  const to = sp.to || localISO(now)

  const supabase = await createClient()
  // Paginado: un rango amplio supera las 1.000 filas de PostgREST y el corte sería
  // silencioso. El orden incluye created_at para que sea total y las páginas no
  // solapen ni pierdan registros dentro de un mismo día.
  const logs = await fetchAllRows<RawLog>((desde, hasta) =>
    supabase
      .from('time_logs')
      .select('id, entry_date, total_hours, status, profiles!time_logs_user_id_fkey(full_name), time_log_lines(project, hours, description, department, areas(name), etapas(name))')
      .gte('entry_date', from)
      .lte('entry_date', to)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(desde, hasta),
  )

  const registros: EquipoLog[] = logs.map((l) => ({
    id: l.id, entry_date: l.entry_date, total_hours: Number(l.total_hours), status: l.status,
    user: l.profiles?.full_name ?? '—',
    lines: (l.time_log_lines ?? []).map((ln) => ({
      project: ln.project, hours: Number(ln.hours), description: ln.description ?? '',
      department: ln.department ?? '', area: ln.areas?.name ?? '', etapa: ln.etapas?.name ?? '',
    })),
  }))

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
              const Icono = areaIcon(a.area)
              const partes: string[] = []
              if (a.managers.length) partes.push(`${a.managers.length} ${a.managers.length === 1 ? 'manager' : 'managers'}`)
              if (a.operativos.length) partes.push(`${a.operativos.length} ${a.operativos.length === 1 ? 'operativo' : 'operativos'}`)
              return (
                <div
                  key={a.area}
                  className="grid gap-x-10 gap-y-4 border-b border-border py-6 last:border-b-0 sm:grid-cols-[210px_1fr]"
                >
                  <div className="relative">
                    <span className="absolute -left-6 top-1.5 h-7 w-[3px] rounded-r-full bg-(--brand)" />
                    <div className="flex items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-(--brand)/10 text-(--brand-strong)">
                        <Icono className="size-4.5" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-display text-xl font-semibold tracking-tight">{a.area}</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">{partes.join(' · ') || 'Sin personas'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {a.managers.length > 0 && (
                      <div>
                        <p className="mb-2 text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">Managers</p>
                        <div className="flex flex-wrap gap-2">
                          {a.managers.map((m, i) => <PersonaChip key={i} m={m} manager />)}
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="mb-2 text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">Operativos</p>
                      {a.operativos.length === 0 ? (
                        <p className="text-sm text-muted-foreground/60">Sin operativos en esta área.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {a.operativos.map((m, i) => <PersonaChip key={i} m={m} />)}
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
        <h2 className="font-display mb-1 border-b border-border pb-2 text-lg font-semibold">Registros del equipo</h2>
        <p className="mb-4 mt-2 text-sm text-muted-foreground">
          Cada registro se despliega para ver sus líneas: proyecto, área/departamento, etapa, horas y el motivo.
          Se muestra el mes en curso; amplía el rango de fechas para ver registros anteriores.
        </p>
        <EquipoRegistros logs={registros} isAdmin={viewer.role === 'admin'} from={from} to={to} />
      </section>
    </div>
  )
}
