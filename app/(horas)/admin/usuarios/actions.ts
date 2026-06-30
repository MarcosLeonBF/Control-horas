'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export interface NuevoUsuario {
  full_name: string; email: string; password: string; positionId: string
  role: 'operativo' | 'manager' | 'admin'; areaIds: string[]
}

export async function crearUsuario(input: NuevoUsuario): Promise<{ ok: true } | { ok: false; error: string }> {
  // Verificar que el actor es admin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado.' }
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') return { ok: false, error: 'Solo un administrador puede crear usuarios.' }

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

  if (input.areaIds.length) {
    const { error: areasError } = await admin.from('user_areas').insert(input.areaIds.map((area_id) => ({ user_id: id, area_id })))
    if (areasError) return { ok: false, error: `Usuario creado pero fallaron sus áreas: ${areasError.message}` }
  }
  return { ok: true }
}

export interface EdicionUsuario {
  full_name: string; positionId: string
  role: 'operativo' | 'manager' | 'admin'; status: 'activo' | 'inactivo'; areaIds: string[]
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
  }).eq('id', id)
  if (error) return { ok: false, error: error.message }

  // Reemplaza las áreas asignadas.
  await admin.from('user_areas').delete().eq('user_id', id)
  if (input.areaIds.length) {
    const { error: ae } = await admin.from('user_areas').insert(input.areaIds.map((area_id) => ({ user_id: id, area_id })))
    if (ae) return { ok: false, error: `Datos guardados pero fallaron las áreas: ${ae.message}` }
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
