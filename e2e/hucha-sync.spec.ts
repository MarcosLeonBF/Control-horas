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

  // Limpieza.
  await db.from('projects').delete().like('name', 'Sync E2E%')
  await db.auth.admin.deleteUser(mgrId)
})
