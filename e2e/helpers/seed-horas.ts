import { createClient } from '@supabase/supabase-js'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const OPERATIVO = { email: 'e2e-operativo@horas.test', password: 'E2e-Op-Pass-123', full_name: 'Operativo E2E' }
const ADMIN_USER = { email: 'e2e-admin@horas.test', password: 'E2e-Admin-Pass-123', full_name: 'Admin E2E' }
const RRHH = { email: 'e2e-rrhh@horas.test', password: 'E2e-Rrhh-Pass-123', full_name: 'RRHH E2E' }
// Miembro con POSICIÓN: la página Equipo agrupa por las áreas de la posición (modelo 0028).
// Usuario aparte del operativo porque los specs de registrar dependen de que aquel no tenga posición.
const MIEMBRO = { email: 'e2e-miembro@horas.test', password: 'E2e-Mbr-Pass-123', full_name: 'Miembro E2E' }

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

  // Un registro del operativo (hoy, 2h) para que el admin lo edite/anule en los tests.
  const { data: etapa } = await admin.from('etapas').select('id').limit(1).single()
  const today = new Date().toISOString().slice(0, 10)
  const { data: log } = await admin.from('time_logs').insert({
    user_id: userId, entry_date: today, total_hours: 2, status: 'guardado', created_by: userId, updated_by: userId,
  }).select('id').single()
  await admin.from('time_log_lines').insert({
    log_id: log!.id, project: 'Proyecto E2E', area_id: area!.id, department: 'Clientes',
    etapa_id: etapa!.id, hours: 2, description: 'Registro sembrado E2E', created_by: userId, updated_by: userId,
  })

  // Create admin user
  const { data: createdAdmin, error: adminError } = await admin.auth.admin.createUser({
    email: ADMIN_USER.email, password: ADMIN_USER.password, email_confirm: true,
    user_metadata: { full_name: ADMIN_USER.full_name },
  })
  if (adminError) throw adminError
  const adminUserId = createdAdmin.user!.id
  await admin.from('profiles').update({ role: 'admin', status: 'activo', must_change_password: false }).eq('id', adminUserId)

  // Usuario con permiso delegado de alta (operativo + can_create_users).
  const { data: createdRrhh, error: rrhhError } = await admin.auth.admin.createUser({
    email: RRHH.email, password: RRHH.password, email_confirm: true,
    user_metadata: { full_name: RRHH.full_name },
  })
  if (rrhhError) throw rrhhError
  const rrhhUserId = createdRrhh.user!.id
  await admin.from('profiles').update({
    role: 'operativo', status: 'activo', must_change_password: false, can_create_users: true,
  }).eq('id', rrhhUserId)

  // Miembro del equipo: operativo con una posición que pertenece al área CRM,
  // para verificar que Equipo lo agrupa por las áreas de su posición.
  const { data: posCrm } = await admin.from('position_areas').select('position_id').eq('area_id', area!.id).limit(1).single()
  const { data: createdMiembro, error: miembroError } = await admin.auth.admin.createUser({
    email: MIEMBRO.email, password: MIEMBRO.password, email_confirm: true,
    user_metadata: { full_name: MIEMBRO.full_name },
  })
  if (miembroError) throw miembroError
  const miembroUserId = createdMiembro.user!.id
  await admin.from('profiles').update({
    role: 'operativo', status: 'activo', must_change_password: false, position_id: posCrm!.position_id,
  }).eq('id', miembroUserId)

  return {
    operativoEmail: OPERATIVO.email,
    operativoPassword: OPERATIVO.password,
    userId,
    operativoLogId: log!.id,
    operativoName: OPERATIVO.full_name,
    adminEmail: ADMIN_USER.email,
    adminPassword: ADMIN_USER.password,
    adminUserId,
    rrhhEmail: RRHH.email,
    rrhhPassword: RRHH.password,
    rrhhUserId,
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
    // Delete miembro E2E user (composición de Equipo)
    if (u.email === MIEMBRO.email) {
      await admin.from('time_logs').delete().eq('user_id', u.id)
      await admin.from('user_areas').delete().eq('user_id', u.id)
      await admin.auth.admin.deleteUser(u.id)
    }
    // Delete RRHH E2E user (permiso delegado de alta)
    if (u.email === RRHH.email) {
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
