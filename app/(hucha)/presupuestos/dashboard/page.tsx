import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getDashboardRows } from '@/lib/hucha/queries'
import DashboardClient from '@/components/hucha/DashboardClient'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/presupuestos')

  const rows = await getDashboardRows()

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Estado de los presupuestos HUCHA de todos los proyectos.</p>
      </header>
      <DashboardClient rows={rows} />
    </div>
  )
}
