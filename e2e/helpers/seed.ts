import { createClient } from '@supabase/supabase-js'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const MANAGER_EMAIL = 'e2e-manager@hucha.test'
const MANAGER_PASSWORD = 'E2e-Manager-Pass-123'

export async function seedManagerFixture() {
  await cleanupFixture()

  // 1) Manager auth user (trigger crea el profile como 'operativo')
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: MANAGER_EMAIL,
    password: MANAGER_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Manager E2E' },
  })
  if (cErr) throw cErr
  const managerId = created.user!.id
  // must_change_password=false (migración 0029 lo pone true por defecto): evita que el
  // gate de cambio de contraseña bloquee al manager en las rutas de la app.
  await admin.from('profiles').update({ role: 'manager', status: 'activo', must_change_password: false }).eq('id', managerId)

  // 2) Proyecto asignado (trigger crea el banco en 0) + asignación
  const { data: pA } = await admin.from('projects').insert({ name: 'Cliente E2E Asignado', client: 'ACME' }).select('id').single()
  const projectAssignedId = pA!.id as string
  await admin.from('project_assignments').insert({ project_id: projectAssignedId, user_id: managerId })

  // 3) Proyecto NO asignado (para probar aislamiento)
  const { data: pB } = await admin.from('projects').insert({ name: 'Cliente E2E NoAsignado' }).select('id').single()
  const projectUnassignedId = pB!.id as string

  // 4) Financiar el banco del proyecto asignado: 500 € (movimiento ampliacion + cache)
  const { data: bank } = await admin.from('hucha_banks').select('id').eq('project_id', projectAssignedId).single()
  const bankId = bank!.id as string
  await admin.from('hucha_movements').insert({
    bank_id: bankId, type: 'ampliacion', amount: 500,
    balance_before: 0, balance_after: 500, reason: 'Carga inicial E2E',
    actor_name: 'Seed', entry_date: new Date().toISOString().slice(0, 10),
  })
  await admin.from('hucha_banks').update({
    assigned_total: 500, consumed_total: 0, remaining: 500, status: 'disponible',
  }).eq('id', bankId)

  return { managerEmail: MANAGER_EMAIL, managerPassword: MANAGER_PASSWORD, projectAssignedId, projectUnassignedId }
}

export async function cleanupFixture() {
  const { data: list } = await admin.auth.admin.listUsers()
  const u = list?.users.find((x) => x.email === MANAGER_EMAIL)
  // projects de E2E (cascade borra banks/movements/assignments)
  await admin.from('projects').delete().like('name', 'Cliente E2E%')
  if (u) await admin.auth.admin.deleteUser(u.id)
}
