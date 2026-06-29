import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getBancoHorasDetalle } from '@/lib/horas/bancos'
import { formatHoras } from '@/lib/horas/format'
import HorasStatusBadge from '@/components/horas/HorasStatusBadge'
import AmpliarHorasForm from '@/components/horas/AmpliarHorasForm'
import AnularAmpliacionButton from '@/components/horas/AnularAmpliacionButton'

export default async function BancoDetallePage({ params }: { params: Promise<{ project: string }> }) {
  const { project: raw } = await params
  const project = decodeURIComponent(raw)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'manager' && me?.role !== 'admin') redirect('/registrar')
  const isAdmin = me?.role === 'admin'

  const d = await getBancoHorasDetalle(project)
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
    </div>
  )
}
