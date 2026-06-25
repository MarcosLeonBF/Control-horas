import { createClient } from '@/lib/supabase/server'
import { formatHoras } from '@/lib/horas/format'
import MisRegistros from '@/components/horas/MisRegistros'

export default async function MisRegistrosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: logs } = await supabase
    .from('time_logs')
    .select('id, entry_date, total_hours, status, time_log_lines(project, hours, description)')
    .eq('user_id', user!.id)
    .order('entry_date', { ascending: false })

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl">Mis registros</h1>
      <MisRegistros logs={(logs ?? []).map((l) => ({ ...l, totalLabel: formatHoras(Number(l.total_hours)) }))} />
    </div>
  )
}
