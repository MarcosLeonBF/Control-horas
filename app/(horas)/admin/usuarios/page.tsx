import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCatalogos } from '@/lib/horas/queries'
import UsuarioForm from '@/components/horas/UsuarioForm'

export default async function UsuariosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user!.id).single()
  if (me?.role !== 'admin') redirect('/registrar')
  const { areas } = await getCatalogos()
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl">Alta de usuarios</h1>
      <UsuarioForm areas={areas} />
    </div>
  )
}
