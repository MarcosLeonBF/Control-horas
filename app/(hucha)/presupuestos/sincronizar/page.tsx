import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SincronizarButton from '@/components/hucha/SincronizarButton'

export default async function SincronizarPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/presupuestos')

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl">Sincronizar presupuestos</h1>
      <p className="text-muted-foreground">Trae proyectos y presupuestos HUCHA desde el Excel. Solo lectura: nunca escribe al Excel.</p>
      <SincronizarButton />
    </div>
  )
}
