import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCatalogos } from '@/lib/horas/queries'
import UsuarioForm from '@/components/horas/UsuarioForm'
import UsuariosPanel, { type UsuarioRow, type PosicionOpt } from '@/components/horas/UsuariosPanel'

interface RawUsuario {
  id: string; full_name: string; email: string; position_id: string | null
  role: 'operativo' | 'manager' | 'admin'; status: 'activo' | 'inactivo'
  user_areas: { area_id: string }[]
}

export default async function UsuariosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/registrar')

  const { areas } = await getCatalogos()
  const { data: pos } = await supabase.from('positions').select('id, name').eq('active', true).order('name')
  const posiciones: PosicionOpt[] = (pos ?? []).map((p) => ({ id: p.id as string, name: p.name as string }))

  // Panel de usuarios: lista vía service role (la página ya está gated a admin).
  const admin = createAdminClient()
  const { data: raw } = await admin
    .from('profiles')
    .select('id, full_name, email, position_id, role, status, user_areas(area_id)')
    .order('full_name')
  const usuarios: UsuarioRow[] = ((raw ?? []) as RawUsuario[]).map((u) => ({
    id: u.id, full_name: u.full_name, email: u.email, positionId: u.position_id,
    role: u.role, status: u.status, areaIds: (u.user_areas ?? []).map((a) => a.area_id),
  }))

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="font-display text-2xl">Usuarios</h1>
        <UsuariosPanel usuarios={usuarios} areas={areas} posiciones={posiciones} />
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-xl">Alta de usuario</h2>
        <UsuarioForm areas={areas} posiciones={posiciones} />
      </section>
    </div>
  )
}
