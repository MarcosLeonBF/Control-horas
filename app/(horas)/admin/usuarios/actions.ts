'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export interface NuevoUsuario {
  full_name: string; email: string; password: string; position: string
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
    full_name: input.full_name.trim(), email: input.email.trim(), position: input.position.trim(),
    role: input.role, status: 'activo', created_by: user.id,
  }).eq('id', id)
  if (profileError) return { ok: false, error: `Usuario creado pero falló su perfil: ${profileError.message}` }

  if (input.areaIds.length) {
    const { error: areasError } = await admin.from('user_areas').insert(input.areaIds.map((area_id) => ({ user_id: id, area_id })))
    if (areasError) return { ok: false, error: `Usuario creado pero fallaron sus áreas: ${areasError.message}` }
  }
  return { ok: true }
}
