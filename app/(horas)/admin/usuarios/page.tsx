import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCatalogos } from '@/lib/horas/queries'
import UsuarioForm from '@/components/horas/UsuarioForm'
import UsuariosPanel, { type UsuarioRow, type PosicionOpt } from '@/components/horas/UsuariosPanel'

interface RawUsuario {
  id: string; full_name: string; email: string; position_id: string | null
  role: 'operativo' | 'manager' | 'admin'; status: 'activo' | 'inactivo'
  can_create_users: boolean
  registro_dias_atras: number | null
  manager_id: string | null
  equipo_id: string | null
  slack_id: string | null
  user_areas: { area_id: string }[]
}

export default async function UsuariosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role, can_create_users').eq('id', user.id).single()
  const esAdmin = me?.role === 'admin'
  // Usuarios con permiso delegado (p. ej. RRHH): entran en modo lectura + alta.
  if (!esAdmin && !me?.can_create_users) redirect('/registrar')

  const { areas } = await getCatalogos()
  const { data: pos } = await supabase.from('positions').select('id, name').eq('active', true).order('name')
  const posiciones: PosicionOpt[] = (pos ?? []).map((p) => ({ id: p.id as string, name: p.name as string }))

  // Equipos de la empresa (0049), solo los activos: son las opciones asignables. El error
  // no se descarta, por lo mismo que la lista de usuarios de más abajo: sin la migración
  // aplicada el desplegable saldría vacío y parecería que no hay ninguno.
  const { data: eq, error: equiposError } = await supabase.from('equipos').select('id, name').eq('active', true).order('name')
  if (equiposError) throw new Error(`No se pudieron leer los equipos: ${equiposError.message}`)
  const equipos: PosicionOpt[] = (eq ?? []).map((e) => ({ id: e.id as string, name: e.name as string }))

  // Panel de usuarios: lista vía service role (la página ya está gated a admin).
  const admin = createAdminClient()
  // El error NO se descarta: al añadir registro_dias_atras antes de aplicar su
  // migración, este select falló en silencio y el panel se pintó vacío, como si no
  // hubiera usuarios. Una lista vacía y una consulta rota tienen que distinguirse.
  const { data: raw, error: usuariosError } = await admin
    .from('profiles')
    .select('id, full_name, email, position_id, role, status, can_create_users, registro_dias_atras, manager_id, equipo_id, slack_id, user_areas(area_id)')
    .order('full_name')
  if (usuariosError) throw new Error(`No se pudo leer la lista de usuarios: ${usuariosError.message}`)
  const usuarios: UsuarioRow[] = ((raw ?? []) as RawUsuario[]).map((u) => ({
    id: u.id, full_name: u.full_name, email: u.email, positionId: u.position_id,
    role: u.role, status: u.status, canCreateUsers: u.can_create_users, areaIds: (u.user_areas ?? []).map((a) => a.area_id),
    registroDiasAtras: u.registro_dias_atras, managerId: u.manager_id, equipoId: u.equipo_id, slackId: u.slack_id,
  }))

  // Candidatos a manager directo: managers y admins activos.
  const managers: PosicionOpt[] = usuarios
    .filter((u) => (u.role === 'manager' || u.role === 'admin') && u.status === 'activo')
    .map((u) => ({ id: u.id, name: u.full_name }))

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="font-display text-2xl">Usuarios</h1>
        <UsuariosPanel usuarios={usuarios} areas={areas} posiciones={posiciones} managers={managers} equipos={equipos} readOnly={!esAdmin} />
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-xl">Alta de usuario</h2>
        <UsuarioForm areas={areas} posiciones={posiciones} equipos={equipos} allowAdminRole={esAdmin} />
      </section>
    </div>
  )
}
