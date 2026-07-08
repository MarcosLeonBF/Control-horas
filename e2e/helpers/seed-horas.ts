import { createClient } from '@supabase/supabase-js'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const OPERATIVO = { email: 'e2e-operativo@horas.test', password: 'E2e-Op-Pass-123', full_name: 'Operativo E2E' }
const ADMIN_USER = { email: 'e2e-admin@horas.test', password: 'E2e-Admin-Pass-123', full_name: 'Admin E2E' }

export async function seedHorasFixture() {
  await cleanupHorasFixture()

  // Create operativo
  const { data: created, error } = await admin.auth.admin.createUser({
    email: OPERATIVO.email, password: OPERATIVO.password, email_confirm: true,
    user_metadata: { full_name: OPERATIVO.full_name },
  })
  if (error) throw error
  const userId = created.user!.id
  // must_change_password=false: la migración 0029 lo pone true por defecto y el layout
  // (horas) muestra la pantalla de cambio de contraseña, que bloquearía toda la suite e2e.
  await admin.from('profiles').update({ role: 'operativo', status: 'activo', must_change_password: false }).eq('id', userId)
  const { data: area } = await admin.from('areas').select('id').eq('name', 'CRM').single()
  await admin.from('user_areas').insert({ user_id: userId, area_id: area!.id })

  // Create admin user
  const { data: createdAdmin, error: adminError } = await admin.auth.admin.createUser({
    email: ADMIN_USER.email, password: ADMIN_USER.password, email_confirm: true,
    user_metadata: { full_name: ADMIN_USER.full_name },
  })
  if (adminError) throw adminError
  const adminUserId = createdAdmin.user!.id
  await admin.from('profiles').update({ role: 'admin', status: 'activo', must_change_password: false }).eq('id', adminUserId)

  return {
    operativoEmail: OPERATIVO.email,
    operativoPassword: OPERATIVO.password,
    userId,
    adminEmail: ADMIN_USER.email,
    adminPassword: ADMIN_USER.password,
    adminUserId,
  }
}

export async function cleanupHorasFixture() {
  const { data: list } = await admin.auth.admin.listUsers()
  if (!list) return

  for (const u of list.users) {
    // Delete operativo
    if (u.email === OPERATIVO.email) {
      await admin.from('horas_ampliaciones').delete().eq('created_by', u.id)
      await admin.from('time_logs').delete().eq('user_id', u.id)
      await admin.from('user_areas').delete().eq('user_id', u.id)
      await admin.auth.admin.deleteUser(u.id)
    }
    // Delete admin E2E user
    if (u.email === ADMIN_USER.email) {
      await admin.from('horas_ampliaciones').delete().eq('created_by', u.id)
      await admin.from('time_logs').delete().eq('user_id', u.id)
      await admin.from('user_areas').delete().eq('user_id', u.id)
      await admin.auth.admin.deleteUser(u.id)
    }
    // Delete any users created by the alta test
    if (u.email?.startsWith('e2e-nuevo-')) {
      await admin.from('time_logs').delete().eq('user_id', u.id)
      await admin.from('user_areas').delete().eq('user_id', u.id)
      await admin.auth.admin.deleteUser(u.id)
    }
  }
}
