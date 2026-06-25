import { createClient } from '@supabase/supabase-js'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const OPERATIVO = { email: 'e2e-operativo@horas.test', password: 'E2e-Op-Pass-123', full_name: 'Operativo E2E' }

export async function seedHorasFixture() {
  await cleanupHorasFixture()
  const { data: created, error } = await admin.auth.admin.createUser({
    email: OPERATIVO.email, password: OPERATIVO.password, email_confirm: true,
    user_metadata: { full_name: OPERATIVO.full_name },
  })
  if (error) throw error
  const userId = created.user!.id
  await admin.from('profiles').update({ role: 'operativo', status: 'activo' }).eq('id', userId)
  const { data: area } = await admin.from('areas').select('id').eq('name', 'CRM').single()
  await admin.from('user_areas').insert({ user_id: userId, area_id: area!.id })
  return { operativoEmail: OPERATIVO.email, operativoPassword: OPERATIVO.password, userId }
}

export async function cleanupHorasFixture() {
  const { data: list } = await admin.auth.admin.listUsers()
  const u = list?.users.find((x) => x.email === OPERATIVO.email)
  if (u) {
    await admin.from('time_logs').delete().eq('user_id', u.id)
    await admin.from('user_areas').delete().eq('user_id', u.id)
    await admin.auth.admin.deleteUser(u.id)
  }
}
