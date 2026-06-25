import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatHoras } from '@/lib/horas/format'

export default async function EquipoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user!.id).single()
  if (me?.role !== 'manager' && me?.role !== 'admin') redirect('/registrar')

  const { data: logs } = await supabase
    .from('time_logs')
    .select('id, entry_date, total_hours, status, profiles!time_logs_user_id_fkey(full_name)')
    .order('entry_date', { ascending: false })
    .limit(200)

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl">Registros del equipo</h1>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted-foreground"><th>Fecha</th><th>Usuario</th><th>Total</th><th>Estado</th></tr></thead>
        <tbody>
          {(logs ?? []).map((l: { id: string; entry_date: string; total_hours: number; status: string; profiles: { full_name: string } | null }) => (
            <tr key={l.id} className="border-t border-border">
              <td>{l.entry_date}</td><td>{l.profiles?.full_name ?? '—'}</td>
              <td className="tabular-money">{formatHoras(Number(l.total_hours))}</td><td>{l.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
