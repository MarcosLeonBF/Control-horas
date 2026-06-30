import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getBancoHorasDetalle, type BancosScope } from '@/lib/horas/bancos'
import { getViewerScope } from '@/lib/horas/scope'
import { formatHoras } from '@/lib/horas/format'
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
    viewer.role === 'admin' ? { role: 'admin' } : { role: 'manager', teamUserIds: viewer.teamUserIds }
  const d = await getBancoHorasDetalle(project, scope)
  // El manager solo accede a bancos de proyectos que su equipo registra.
  if (!d.inScope) redirect('/bancos')
  const ampliado = d.assigned - d.excelBase

  return (
    <div>
      <Link href="/bancos" className="text-xs text-foreground/55 hover:text-foreground">← Bancos de horas</Link>

      <header className="mt-3 mb-8 flex items-start justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{project}</h1>
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

      <section>
        <h2 className="font-display mb-4 text-xl font-semibold">Ampliaciones</h2>
        {d.ampliaciones.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin ampliaciones. El asignado es el del Excel.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2 font-medium">Fecha</th>
                <th className="py-2 font-medium">Horas</th>
                <th className="py-2 font-medium">Motivo</th>
                <th className="py-2 font-medium">Por</th>
                {isAdmin && <th className="py-2 font-medium text-right">Acción</th>}
              </tr>
            </thead>
            <tbody>
              {d.ampliaciones.map((a) => (
                <tr key={a.id} className={`border-t border-border ${a.active ? '' : 'text-muted-foreground line-through'}`}>
                  <td className="py-2">{a.entry_date}</td>
                  <td className="tabular-money py-2">+{formatHoras(Number(a.hours))}</td>
                  <td className="py-2">{a.reason}</td>
                  <td className="py-2">{a.actor_name}</td>
                  {isAdmin && (
                    <td className="py-2 text-right">
                      {a.active ? <AnularAmpliacionButton id={a.id} project={project} /> : <span className="text-xs">anulada</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2 font-medium">Fecha</th>
                  <th className="py-2 font-medium">Acción</th>
                  <th className="py-2 font-medium text-right">Horas</th>
                  <th className="py-2 font-medium text-right">Antes</th>
                  <th className="py-2 font-medium text-right">Después</th>
                  <th className="py-2 font-medium">Por</th>
                  <th className="py-2 font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {d.movimientos.map((m, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-2 whitespace-nowrap">{m.date}</td>
                    <td className="py-2">
                      <span className={m.kind === 'ampliacion' ? 'text-(--brand)' : 'text-foreground/70'}>
                        {m.kind === 'ampliacion' ? 'Ampliación' : 'Consumo'}
                      </span>
                    </td>
                    <td className={`tabular-money py-2 text-right ${m.kind === 'ampliacion' ? 'text-(--brand)' : ''}`}>
                      {m.kind === 'ampliacion' ? '+' : '−'}{formatHoras(m.hours)}
                    </td>
                    <td className="tabular-money py-2 text-right text-foreground/55">{formatHoras(m.saldoAntes)}</td>
                    <td className={`tabular-money py-2 text-right ${m.saldoDespues < 0 ? 'text-(--status-excedido)' : ''}`}>{formatHoras(m.saldoDespues)}</td>
                    <td className="py-2">{m.actor}</td>
                    <td className="py-2 text-foreground/70">{m.detail}</td>
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
