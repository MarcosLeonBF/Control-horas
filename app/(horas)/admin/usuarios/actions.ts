'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export interface NuevoUsuario {
  full_name: string; email: string; password: string; positionId: string
  role: 'operativo' | 'manager' | 'admin'; areaIds: string[]
}

export async function crearUsuario(input: NuevoUsuario): Promise<{ ok: true } | { ok: false; error: string }> {
  // Actor válido: admin, o usuario activo con permiso delegado de alta (can_create_users).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado.' }
  const { data: me } = await supabase.from('profiles').select('role, status, can_create_users').eq('id', user.id).single()
  const esAdmin = me?.role === 'admin'
  if (!esAdmin && !(me?.can_create_users === true && me?.status === 'activo')) {
    return { ok: false, error: 'No tienes permiso para crear usuarios.' }
  }
  // El permiso delegado no alcanza para crear admins.
  if (!esAdmin && input.role === 'admin') {
    return { ok: false, error: 'Solo un administrador puede crear usuarios admin.' }
  }

  if (!input.full_name.trim() || !input.email.trim() || input.password.length < 8) {
    return { ok: false, error: 'Nombre, correo y contraseña (mín. 8) son obligatorios.' }
  }

  const admin = createAdminClient()
  const { data: created, error } = await admin.auth.admin.createUser({
    email: input.email.trim(), password: input.password, email_confirm: true,
    user_metadata: { full_name: input.full_name.trim() },
  })
  if (error) return { ok: false, error: error.message }
  const id = created.user!.id

  const { error: profileError } = await admin.from('profiles').update({
    full_name: input.full_name.trim(), email: input.email.trim(), position_id: input.positionId || null,
    role: input.role, status: 'activo', created_by: user.id,
  }).eq('id', id)
  if (profileError) return { ok: false, error: `Usuario creado pero falló su perfil: ${profileError.message}` }

  // user_areas = visibilidad del manager/admin. El operativo no tiene (registra por su posición).
  const areaIds = input.role === 'operativo' ? [] : input.areaIds
  if (areaIds.length) {
    const { error: areasError } = await admin.from('user_areas').insert(areaIds.map((area_id) => ({ user_id: id, area_id })))
    if (areasError) return { ok: false, error: `Usuario creado pero fallaron sus áreas: ${areasError.message}` }
  }
  return { ok: true }
}

export interface EdicionUsuario {
  full_name: string; positionId: string
  role: 'operativo' | 'manager' | 'admin'; status: 'activo' | 'inactivo'; areaIds: string[]
  canCreateUsers: boolean
}

// Panel de usuarios (PDF §8/§19): editar datos + estado activo/inactivo. Solo admin.
export async function actualizarUsuario(id: string, input: EdicionUsuario): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado.' }
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') return { ok: false, error: 'Solo un administrador puede editar usuarios.' }
  if (!input.full_name.trim()) return { ok: false, error: 'El nombre es obligatorio.' }
  // Evitar que el admin se bloquee a sí mismo.
  if (id === user.id && (input.role !== 'admin' || input.status !== 'activo')) {
    return { ok: false, error: 'No puedes quitarte el rol de admin ni desactivarte a ti mismo.' }
  }

  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update({
    full_name: input.full_name.trim(), position_id: input.positionId || null, role: input.role, status: input.status,
    // Un admin ya puede crear usuarios por rol: el flag delegado se limpia para no dejarlo huérfano.
    can_create_users: input.role === 'admin' ? false : input.canCreateUsers,
  }).eq('id', id)
  if (error) return { ok: false, error: error.message }

  // Reemplaza las áreas de visibilidad (manager/admin). El operativo no tiene user_areas
  // (registra por su posición): si el rol es operativo, se limpian.
  await admin.from('user_areas').delete().eq('user_id', id)
  const areaIds = input.role === 'operativo' ? [] : input.areaIds
  if (areaIds.length) {
    const { error: ae } = await admin.from('user_areas').insert(areaIds.map((area_id) => ({ user_id: id, area_id })))
    if (ae) return { ok: false, error: `Datos guardados pero fallaron las áreas: ${ae.message}` }
  }
  return { ok: true }
}

// Eliminar definitivamente (solo admin). Pensado para altas erróneas o usuarios sin
// actividad: si el usuario tiene registros de horas u otra actividad, las FKs de la
// base lo impiden (time_logs.user_id es RESTRICT) y se le indica desactivar en su lugar.
export async function eliminarUsuario(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado.' }
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') return { ok: false, error: 'Solo un administrador puede eliminar usuarios.' }
  if (id === user.id) return { ok: false, error: 'No puedes eliminarte a ti mismo.' }

  const admin = createAdminClient()
  const { count } = await admin.from('time_logs').select('id', { count: 'exact', head: true }).eq('user_id', id)
  if ((count ?? 0) > 0) {
    return { ok: false, error: `Tiene ${count} ${count === 1 ? 'registro' : 'registros'} de horas: desactívalo en su lugar para conservar el histórico.` }
  }

  // user_areas cae en cascada; el resto de FKs bloquean si hay actividad asociada.
  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) {
    const bloqueado = /foreign key|violates|database error/i.test(error.message)
    return { ok: false, error: bloqueado ? 'El usuario tiene actividad asociada (ediciones o movimientos): desactívalo en su lugar.' : error.message }
  }
  return { ok: true }
}

// Activar/desactivar rápido (PDF §8: estado activo/inactivo). Solo admin.
export async function cambiarEstadoUsuario(id: string, status: 'activo' | 'inactivo'): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado.' }
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') return { ok: false, error: 'Solo un administrador puede cambiar el estado.' }
  if (id === user.id && status === 'inactivo') return { ok: false, error: 'No puedes desactivarte a ti mismo.' }

  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update({ status }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
