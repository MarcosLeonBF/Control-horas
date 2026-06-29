import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatHoras } from '@/lib/horas/format'

interface AuditRow {
  id: string; action: 'crear' | 'editar' | 'anular'
  actor_name: string | null; subject_name: string | null
  entry_date: string | null; total_hours: number | null; at: string
}

const ACTION_STYLE: Record<AuditRow['action'], string> = {
  crear: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  editar: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  anular: 'bg-rose-50 text-rose-700 ring-rose-600/20',
}

export default async function AuditoriaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/registrar')

  const { data } = await supabase
    .from('time_log_audit')
    .select('id, action, actor_name, subject_name, entry_date, total_hours, at')
    .order('at', { ascending: false })
    .limit(200)
  const rows = (data ?? []) as AuditRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl">Auditoría</h1>
        <p className="text-sm text-muted-foreground">Toda creación, edición o anulación de registros queda trazada (PDF §7).</p>
      </div>

      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-(--muted-surface) text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Cuándo</th>
              <th className="px-4 py-2.5 font-medium">Acción</th>
              <th className="px-4 py-2.5 font-medium">Registro (fecha)</th>
              <th className="px-4 py-2.5 font-medium">De</th>
              <th className="px-4 py-2.5 font-medium">Por</th>
              <th className="px-4 py-2.5 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Aún no hay movimientos registrados.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-4 py-2.5 text-foreground/70">
                  {new Date(r.at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${ACTION_STYLE[r.action]}`}>
                    {r.action}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-foreground/70">{r.entry_date ?? '—'}</td>
                <td className="px-4 py-2.5 text-foreground/70">{r.subject_name ?? '—'}</td>
                <td className="px-4 py-2.5 text-foreground/70">{r.actor_name ?? '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-money">{r.total_hours != null ? formatHoras(Number(r.total_hours)) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
