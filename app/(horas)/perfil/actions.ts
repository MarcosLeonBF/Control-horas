'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createRawClient } from '@supabase/supabase-js'

export async function cambiarContrasena(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado.' }

  // Validaciones básicas
  if (!currentPassword) return { ok: false, error: 'La contraseña actual es obligatoria.' }
  if (newPassword.length < 8) return { ok: false, error: 'La nueva contraseña debe tener al menos 8 caracteres.' }
  if (currentPassword === newPassword) return { ok: false, error: 'La nueva contraseña debe ser distinta a la actual.' }

  // Verificar la contraseña actual re-autenticando con un client efímero.
  const verifyClient = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  const { error: verifyError } = await verifyClient.auth.signInWithPassword({
    email: user.email!,
    password: currentPassword,
  })
  if (verifyError) return { ok: false, error: 'La contraseña actual es incorrecta.' }

  // Cambiar la contraseña con el admin client (fiable en server actions).
  const admin = createAdminClient()
  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    password: newPassword,
  })
  if (updateError) return { ok: false, error: `Error al cambiar la contraseña: ${updateError.message}` }

  // Marcar que ya cambió la contraseña.
  await admin.from('profiles').update({ must_change_password: false }).eq('id', user.id)

  return { ok: true }
}
