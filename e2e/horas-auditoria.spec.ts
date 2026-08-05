import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const horas = JSON.parse(fs.readFileSync('e2e/.horas.json', 'utf8')) as { userId: string }

test('el admin ve la pantalla de auditoría', async ({ page }) => {
  await page.goto('/admin/auditoria')
  await expect(page.getByRole('heading', { name: 'Auditoría' })).toBeVisible()
  await expect(page.getByText('Movimientos', { exact: true })).toBeVisible()
})

test('el filtro de acción acota los movimientos', async ({ page }) => {
  await page.goto('/admin/auditoria')
  // exact: true, porque desde Task 5 cada fila también es un <button> cuyo nombre
  // accesible arrastra el texto "Anulación" de su insignia — sin exact, el chip del
  // filtro deja de ser único.
  const chip = page.getByRole('button', { name: 'Anulación', exact: true })
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  // Con solo anulaciones marcadas, no debe quedar ninguna insignia de creación en la
  // tabla. Se acota a la lista de filas porque el propio chip "Creación" del filtro
  // sigue en el DOM (sin marcar) y un getByText sin acotar lo encontraría a él.
  await expect(page.getByRole('list').getByText('Creación', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Limpiar' }).click()
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
})

test('agrupar por quien edita mete las filas bajo cabeceras plegables', async ({ page }) => {
  await page.goto('/admin/auditoria')
  await page.getByRole('button', { name: 'Quien edita' }).click()

  // Los grupos arrancan plegados: hay cabeceras, y ninguna desplegada.
  const cabeceras = page.getByRole('button', { expanded: false })
  await expect(cabeceras.first()).toBeVisible()

  await page.getByRole('button', { name: 'Desplegar todo' }).click()
  await expect(page.getByRole('button', { name: 'Plegar todo' })).toBeVisible()
  await expect(page.getByRole('button', { expanded: true }).first()).toBeVisible()
})

test('el rango de fechas viaja en la URL', async ({ page }) => {
  await page.goto('/admin/auditoria?from=2026-07-01&to=2026-07-31')
  await expect(page.locator('input[name="from"]')).toHaveValue('2026-07-01')
  await expect(page.locator('input[name="to"]')).toHaveValue('2026-07-31')
})

test('desplegar un movimiento muestra su detalle', async ({ page }) => {
  await page.goto('/admin/auditoria')
  // La primera fila es el movimiento más reciente: posterior a la migración 0041,
  // así que tiene snapshot y debe mostrar el total en vez del aviso de "sin detalle".
  const fila = page.locator('li > button[aria-expanded="false"]').first()
  await fila.click()
  await expect(page.getByText(/Total .* →|Registro creado con|Registro anulado con/).first()).toBeVisible()
})

test('un movimiento anterior a la trazabilidad lo dice', async ({ page }) => {
  // Un asiento "sin detalle" es solo una fila de time_log_audit con lines_before y
  // lines_after a NULL — no depende de log_id (nullable) ni de un time_logs real
  // detrás. Se siembra aquí en vez de apuntar a datos históricos de julio: así el
  // test no depende de filas ajenas y compartidas que un reseed podría invalidar
  // en silencio. `subject_name` lleva un marcador único para localizar ESTA fila
  // por contenido, no por posición.
  const marca = `E2E Auditoria SinSnapshot ${Date.now()}`
  const hoy = new Date().toISOString().slice(0, 10)
  const { data: sembrado, error } = await db
    .from('time_log_audit')
    .insert({
      action: 'editar',
      actor_id: null,
      actor_name: 'Actor E2E Sin Snapshot',
      subject_name: marca,
      entry_date: hoy,
      total_hours: 4.5,
      at: new Date().toISOString(),
      lines_before: null,
      lines_after: null,
    })
    .select('id')
    .single()
  if (error) throw error

  try {
    await page.goto('/admin/auditoria')
    const fila = page.locator('li').filter({ hasText: marca })
    await fila.getByRole('button', { expanded: false }).click()
    await expect(fila.getByText('Sin detalle: anterior a la trazabilidad de cambios')).toBeVisible()
  } finally {
    await db.from('time_log_audit').delete().eq('id', sembrado!.id)
  }
})

test('un movimiento sin snapshot que es el ultimo de su registro muestra sus lineas', async ({ page }) => {
  // Se siembra el caso de los asientos previos a 0041 que SÍ se pueden reconstruir: sin
  // snapshots, pero apuntando a un registro vivo y sin movimientos posteriores. Las
  // líneas que ese registro tiene hoy son exactamente las que dejó ese movimiento, así
  // que la pantalla debe enseñarlas en vez de decir "sin detalle".
  const marca = `E2E Auditoria Reconstruido ${Date.now()}`
  const proyecto = `Proyecto Reconstruido ${Date.now()}`
  const hoy = new Date().toISOString().slice(0, 10)
  const { data: area } = await db.from('areas').select('id').eq('name', 'CRM').single()
  const { data: etapa } = await db.from('etapas').select('id').limit(1).single()

  const { data: log, error: errLog } = await db
    .from('time_logs')
    .insert({ user_id: horas.userId, entry_date: hoy, total_hours: 3, status: 'guardado' })
    .select('id')
    .single()
  if (errLog) throw errLog

  const { error: errLinea } = await db.from('time_log_lines').insert({
    log_id: log!.id, project: proyecto, area_id: area!.id, department: 'Clientes',
    etapa_id: etapa!.id, hours: 3, description: 'Línea reconstruida E2E',
  })
  if (errLinea) throw errLinea

  const { error: errAudit } = await db.from('time_log_audit').insert({
    log_id: log!.id, action: 'crear', actor_id: null, actor_name: 'Actor E2E Reconstruido',
    subject_name: marca, entry_date: hoy, total_hours: 3,
    at: new Date().toISOString(), lines_before: null, lines_after: null,
  })
  if (errAudit) throw errAudit

  try {
    await page.goto('/admin/auditoria')
    const fila = page.locator('li').filter({ hasText: marca })
    await fila.getByRole('button', { expanded: false }).click()
    // Las líneas vivas, no el aviso de "sin detalle"…
    await expect(fila.getByText(proyecto)).toBeVisible()
    await expect(fila.getByText('Sin detalle: anterior a la trazabilidad de cambios')).toHaveCount(0)
    // …y sin marcas de diff. De un asiento reconstruido solo se conoce el estado que
    // dejó, nunca el anterior: pintarlo por el camino del diff afirmaría una comparación
    // que no existe. La etiqueta sr-only de las marcas es la prueba de qué camino se usó.
    await expect(fila.getByText('Añadida', { exact: true })).toHaveCount(0)
  } finally {
    await db.from('time_log_audit').delete().eq('log_id', log!.id)
    await db.from('time_logs').delete().eq('id', log!.id)
  }
})

test('un movimiento sin snapshot con ediciones posteriores sigue sin detalle', async ({ page }) => {
  // El reverso del test anterior: si el registro se movió DESPUÉS, sus líneas de hoy ya
  // no son las que dejó este movimiento. Enseñarlas sería presentar un estado ajeno
  // como si fuera un hecho, que es justo lo que esta pantalla existe para evitar.
  const marca = `E2E Auditoria NoUltimo ${Date.now()}`
  const proyecto = `Proyecto NoUltimo ${Date.now()}`
  const hoy = new Date().toISOString().slice(0, 10)
  const { data: area } = await db.from('areas').select('id').eq('name', 'CRM').single()
  const { data: etapa } = await db.from('etapas').select('id').limit(1).single()

  const { data: log, error: errLog } = await db
    .from('time_logs')
    .insert({ user_id: horas.userId, entry_date: hoy, total_hours: 3, status: 'guardado' })
    .select('id')
    .single()
  if (errLog) throw errLog
  const { error: errLinea } = await db.from('time_log_lines').insert({
    log_id: log!.id, project: proyecto, area_id: area!.id, department: 'Clientes',
    etapa_id: etapa!.id, hours: 3, description: 'Línea no reconstruible E2E',
  })
  if (errLinea) throw errLinea

  const ahora = Date.now()
  const { error: errAudit } = await db.from('time_log_audit').insert([
    // El viejo, el que se mira: sin snapshots.
    {
      log_id: log!.id, action: 'crear', actor_id: null, actor_name: 'Actor E2E NoUltimo',
      subject_name: marca, entry_date: hoy, total_hours: 3,
      at: new Date(ahora - 60_000).toISOString(), lines_before: null, lines_after: null,
    },
    // Y una edición posterior, que es la que describe el estado actual.
    {
      log_id: log!.id, action: 'editar', actor_id: null, actor_name: 'Actor E2E NoUltimo',
      subject_name: `${marca} posterior`, entry_date: hoy, total_hours: 3,
      at: new Date(ahora).toISOString(), lines_before: null, lines_after: null,
    },
  ])
  if (errAudit) throw errAudit

  try {
    await page.goto('/admin/auditoria')
    // `hasNotText` deja fuera la fila del movimiento posterior, cuyo sujeto empieza igual.
    const fila = page.locator('li').filter({ hasText: marca }).filter({ hasNotText: 'posterior' })
    await fila.getByRole('button', { expanded: false }).click()
    await expect(fila.getByText('Sin detalle: anterior a la trazabilidad de cambios')).toBeVisible()
  } finally {
    await db.from('time_log_audit').delete().eq('log_id', log!.id)
    await db.from('time_logs').delete().eq('id', log!.id)
  }
})
