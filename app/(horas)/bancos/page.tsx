import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getBancosHoras } from '@/lib/horas/bancos'
import BancosHorasClient from '@/components/horas/BancosHorasClient'

export default async function BancosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'manager' && me?.role !== 'admin') redirect('/registrar')

  const rows = await getBancosHoras()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl">Bancos de horas</h1>
        <p className="text-sm text-muted-foreground">Horas asignadas (Excel) frente a las registradas, por proyecto.</p>
      </div>
      <BancosHorasClient rows={rows} />
    </div>
  )
}
