import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getBancoHorasDetalle, type BancosScope } from '@/lib/horas/bancos'
import { getCachedProyectosEstado } from '@/lib/graph/client'
import { getViewerScope } from '@/lib/horas/scope'
import { formatHoras, formatFechaISO } from '@/lib/horas/format'
import { estadoProyectoBadgeClass } from '@/lib/horas/bancos-status'
import { cn } from '@/lib/utils'
import HorasStatusBadge from '@/components/horas/HorasStatusBadge'
import AmpliarHorasForm from '@/components/horas/AmpliarHorasForm'
import AnularAmpliacionButton from '@/components/horas/AnularAmpliacionButton'

export default async function BancoDetallePage({ params }: { params: Promise<{ project: string }> }) {
  const { project: raw } = await params
  const project = decodeURIComponent(raw)

  const viewer = await getViewerScope()
  if (!viewer) redirect('/login')
  if (viewer.role !== 'manager' && viewer.role !== 'admin') redirect('/registrar')
  const isAdmin = viewer.role === 'admin'

  const scope: BancosScope =
    viewer.role === 'admin' ? { role: 'admin' } : { role: 'manager', areaIds: viewer.areaIds }
  const d = await getBancoHorasDetalle(project, scope)
  // El manager solo accede a proyectos con posiciones de sus áreas.
  if (!d.inScope) redirect('/bancos')
  const ampliado = d.assigned - d.excelBase

  // Metadatos del proyecto (Excel Clientes_Proyectos): estado, manager, auditoría.
  let meta: { estado: string; manager: string; fechaAuditoria: string } | undefined
  try {
    meta = (await getCachedProyectosEstado()).find((e) => e.project.trim() === project)
  } catch { /* Excel no disponible: sin metadatos */ }

  return (
    <div>
      <Link href="/bancos" className="text-xs text-foreground/55 hover:text-foreground">← Bancos de horas</Link>

      <header className="mt-3 mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{project}</h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
            {meta?.estado && (
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', estadoProyectoBadgeClass(meta.estado))}>{meta.estado}</span>
            )}
            <span className="text-muted-foreground">
              Manager <span className="font-medium text-foreground/85">{meta?.manager || '—'}</span>
            </span>
            {meta?.fechaAuditoria && (
              <span className="text-muted-foreground">
                Auditoría <span className="font-medium text-foreground/85">{formatFechaISO(meta.fechaAuditoria)}</span>
              </span>
            )}
          </div>
        </div>
        <HorasStatusBadge status={d.status} />
      </header>

      {isAdmin && <div className="mb-10"><AmpliarHorasForm project={project} /></div>}

      <div className="mb-10 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs text-foreground/50">Asignado</p>
          <p className="tabular-money mt-1 text-2xl font-semibold">{formatHoras(d.assigned)}</p>
          <p className="mt-1 text-xs text-foreground/45">
            Excel {formatHoras(d.excelBase)}{ampliado > 0 && <> · ampliado +{formatHoras(ampliado)}</>}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs text-foreground/50">Consumido</p>
          <p className="tabular-money mt-1 text-2xl font-semibold">{formatHoras(d.consumed)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs text-foreground/50">Restante</p>
          <p className={`tabular-money mt-1 text-2xl font-semibold ${d.remaining < 0 ? 'text-(--status-excedido)' : ''}`}>
            {formatHoras(d.remaining)}
          </p>
        </div>
      </div>

      <section className="mb-10">
        <h2 className="font-display mb-4 text-xl font-semibold">Por posición</h2>
        {d.posiciones.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este proyecto no tiene posiciones con banco.</p>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-(--muted-surface) text-left text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Posición</th>
                  <th className="px-4 py-2.5 font-medium text-right">Asignado</th>
                  <th className="px-4 py-2.5 font-medium text-right">Consumido</th>
                  <th className="px-4 py-2.5 font-medium text-right">Restante</th>
                  <th className="px-4 py-2.5 font-medium text-right">Estado</th>
                </tr>
              </thead>
              <tbody>
                {d.posiciones.map((p) => (
                  <tr key={p.position} className="border-t border-border">
                    <td className="px-4 py-2.5 font-medium">{p.position}</td>
                    <td className="tabular-money px-4 py-2.5 text-right">{formatHoras(p.assigned)}</td>
                    <td className="tabular-money px-4 py-2.5 text-right">{formatHoras(p.consumed)}</td>
                    <td className={`tabular-money px-4 py-2.5 text-right ${p.remaining < 0 ? 'text-(--status-excedido)' : ''}`}>{formatHoras(p.remaining)}</td>
                    <td className="px-4 py-2.5 text-right"><HorasStatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display mb-4 text-xl font-semibold">Ampliaciones</h2>
        {d.ampliaciones.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin ampliaciones. El asignado es el del Excel.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-(--muted-surface) text-left text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Fecha</th>
                  <th className="px-4 py-2.5 font-medium text-right">Horas</th>
                  <th className="px-4 py-2.5 font-medium">Motivo</th>
                  <th className="px-4 py-2.5 font-medium">Por</th>
                  {isAdmin && <th className="px-4 py-2.5 font-medium text-right">Acción</th>}
                </tr>
              </thead>
              <tbody>
                {d.ampliaciones.map((a) => (
                  <tr key={a.id} className={`border-t border-border ${a.active ? '' : 'text-muted-foreground line-through'}`}>
                    <td className="px-4 py-2.5 whitespace-nowrap">{a.entry_date}</td>
                    <td className="tabular-money px-4 py-2.5 text-right whitespace-nowrap">+{formatHoras(Number(a.hours))}</td>
                    <td className="px-4 py-2.5">{a.reason}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{a.actor_name}</td>
                    {isAdmin && (
                      <td className="px-4 py-2.5 text-right">
                        {a.active ? <AnularAmpliacionButton id={a.id} project={project} /> : <span className="text-xs">anulada</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-display mb-1 text-xl font-semibold">Movimientos</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Consumos y ampliaciones en orden cronológico, con el saldo de horas disponibles antes y después.
        </p>
        {d.movimientos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin movimientos todavía.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
            <table className="w-full min-w-176 text-sm">
              <thead>
                <tr className="bg-(--muted-surface) text-left text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Fecha</th>
                  <th className="px-4 py-2.5 font-medium">Acción</th>
                  <th className="px-4 py-2.5 font-medium text-right">Horas</th>
                  <th className="px-4 py-2.5 font-medium text-right">Antes</th>
                  <th className="px-4 py-2.5 font-medium text-right">Después</th>
                  <th className="px-4 py-2.5 font-medium">Por</th>
                  <th className="px-4 py-2.5 font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {d.movimientos.map((m, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-4 py-2.5 whitespace-nowrap">{m.date}</td>
                    <td className="px-4 py-2.5">
                      <span className={m.kind === 'ampliacion' ? 'text-(--brand)' : 'text-foreground/70'}>
                        {m.kind === 'ampliacion' ? 'Ampliación' : 'Consumo'}
                      </span>
                    </td>
                    <td className={`tabular-money px-4 py-2.5 text-right whitespace-nowrap ${m.kind === 'ampliacion' ? 'text-(--brand)' : ''}`}>
                      {m.kind === 'ampliacion' ? '+' : '−'}{formatHoras(m.hours)}
                    </td>
                    <td className="tabular-money px-4 py-2.5 text-right text-foreground/55 whitespace-nowrap">{formatHoras(m.saldoAntes)}</td>
                    <td className={`tabular-money px-4 py-2.5 text-right whitespace-nowrap ${m.saldoDespues < 0 ? 'text-(--status-excedido)' : ''}`}>{formatHoras(m.saldoDespues)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{m.actor}</td>
                    <td className="px-4 py-2.5 text-foreground/70">{m.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
