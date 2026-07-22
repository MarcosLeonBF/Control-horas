import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { aplicarSync, type HuchaExcelData } from '../lib/hucha/sync'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

test('aplicarSync crea proyectos con base, asigna manager y reporta no-matcheados', async () => {
  // Sembrar un perfil manager que matchee por nombre.
  const email = `e2e-sync-mgr-${Date.now()}@hucha.test`
  const { data: created } = await db.auth.admin.createUser({
    email, password: 'E2e-Sync-Pass-123', email_confirm: true,
    user_metadata: { full_name: 'Pilar Sync E2E' },
  })
  const mgrId = created!.user!.id
  await db.from('profiles').update({ role: 'manager', status: 'activo', full_name: 'Pilar Sync E2E' }).eq('id', mgrId)

  const data: HuchaExcelData = {
    proyectos: [
      { proyecto: 'Sync E2E Asignado', hucha: 1000 },
      { proyecto: 'Sync E2E SinManager', hucha: 500 },
      { proyecto: 'Sync E2E SinHucha', hucha: 0 },
    ],
    managerPorProyecto: new Map([
      ['Sync E2E Asignado', 'Pilar Sync E2E'],
      ['Sync E2E SinManager', 'Nombre Inexistente'],
    ]),
  }

  const report = await aplicarSync(data, db)

  expect(report.proyectosCreados).toBe(2)
  expect(report.saltadosSinHucha).toBe(1)
  expect(report.managersAsignados).toBe(1)
  expect(report.managersNoEncontrados).toEqual([{ proyecto: 'Sync E2E SinManager', manager: 'Nombre Inexistente' }])

  // Verificar la base del banco del asignado.
  const { data: proj } = await db.from('projects').select('id').eq('name', 'Sync E2E Asignado').single()
  const { data: bank } = await db.from('hucha_banks').select('excel_hucha, assigned_total, remaining, status').eq('project_id', proj!.id).single()
  expect(Number(bank!.excel_hucha)).toBe(1000)
  expect(Number(bank!.assigned_total)).toBe(1000)
  expect(bank!.status).toBe('disponible')

  // Verificar la asignación.
  const { data: asig } = await db.from('project_assignments').select('id').eq('project_id', proj!.id).eq('user_id', mgrId)
  expect(asig!.length).toBe(1)

  // Re-sync: cambia el Hucha del asignado -> actualiza (no crea) y recalcula la base.
  const report2 = await aplicarSync(
    { proyectos: [{ proyecto: 'Sync E2E Asignado', hucha: 1500 }], managerPorProyecto: new Map() },
    db,
  )
  expect(report2.proyectosActualizados).toBe(1)
  expect(report2.proyectosCreados).toBe(0)
  const { data: bank2 } = await db.from('hucha_banks').select('excel_hucha, assigned_total').eq('project_id', proj!.id).single()
  expect(Number(bank2!.excel_hucha)).toBe(1500)
  expect(Number(bank2!.assigned_total)).toBe(1500)

  // Limpieza.
  await db.from('projects').delete().like('name', 'Sync E2E%')
  await db.auth.admin.deleteUser(mgrId)
})

test('aplicarSync archiva un proyecto que cae a Hucha=0 y lo reactiva si vuelve', async () => {
  const proyecto = `Sync E2E Archivar ${Date.now()}`

  // 1) Alta con presupuesto -> queda activo.
  const r1 = await aplicarSync({ proyectos: [{ proyecto, hucha: 2500 }], managerPorProyecto: new Map() }, db)
  expect(r1.proyectosCreados).toBe(1)
  const { data: p1 } = await db.from('projects').select('id, status').eq('name', proyecto).single()
  expect(p1!.status).toBe('activo')

  // 2) Cae a 0 en el Excel -> se archiva; el banco NO se toca.
  const r2 = await aplicarSync({ proyectos: [{ proyecto, hucha: 0 }], managerPorProyecto: new Map() }, db)
  expect(r2.proyectosArchivados).toBe(1)
  expect(r2.saltadosSinHucha).toBe(0)
  const { data: p2 } = await db.from('projects').select('status').eq('id', p1!.id).single()
  expect(p2!.status).toBe('archivado')
  const { data: bank2 } = await db.from('hucha_banks').select('excel_hucha, assigned_total').eq('project_id', p1!.id).single()
  expect(Number(bank2!.excel_hucha)).toBe(2500)
  expect(Number(bank2!.assigned_total)).toBe(2500)

  // 3) Re-sync con 0 otra vez -> ya archivado, nada que hacer.
  const r3 = await aplicarSync({ proyectos: [{ proyecto, hucha: 0 }], managerPorProyecto: new Map() }, db)
  expect(r3.proyectosArchivados).toBe(0)
  expect(r3.saltadosSinHucha).toBe(1)

  // 4) Vuelve con presupuesto -> se reactiva y recupera base.
  const r4 = await aplicarSync({ proyectos: [{ proyecto, hucha: 3000 }], managerPorProyecto: new Map() }, db)
  expect(r4.proyectosReactivados).toBe(1)
  const { data: p4 } = await db.from('projects').select('status').eq('id', p1!.id).single()
  expect(p4!.status).toBe('activo')
  const { data: bank4 } = await db.from('hucha_banks').select('excel_hucha, assigned_total').eq('project_id', p1!.id).single()
  expect(Number(bank4!.excel_hucha)).toBe(3000)

  // Limpieza (cascade borra banco y movimientos).
  await db.from('projects').delete().like('name', 'Sync E2E Archivar%')
})
