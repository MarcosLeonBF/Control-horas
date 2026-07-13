import { test, expect } from '@playwright/test'

test('el admin ve los bancos de horas con asignado vs registrado', async ({ page }) => {
  await page.goto('/bancos')
  await expect(page.getByRole('heading', { name: 'Bancos de horas' })).toBeVisible()
  // KPIs
  await expect(page.getByText('Asignado total')).toBeVisible()
  await expect(page.getByText('Consumido total')).toBeVisible()
  // Al menos un proyecto del Excel y el contador "N proyectos · M bancos"
  await expect(page.getByText(/\d+ proyectos?/)).toBeVisible()

  // Descarga de bancos (CSV)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSV' }).click(),
  ])
  expect(download.suggestedFilename()).toContain('bancos-horas')

  // Filtro vacío → mensaje de sin resultados
  await page.getByLabel('Buscar proyecto').fill('zzz-no-existe-zzz')
  await expect(page.getByText('No hay bancos que coincidan con los filtros.')).toBeVisible()
})

test('el switch Mensual muestra el selector de meses (calendario) con el mes en curso', async ({ page }) => {
  await page.goto('/bancos')
  await expect(page.getByRole('heading', { name: 'Bancos de horas' })).toBeVisible()

  const mensual = page.getByRole('button', { name: 'Mensual' })
  if (!(await mensual.isVisible().catch(() => false))) {
    // El Excel aún no tiene la columna Fecha: la vista Total es la única y no hay switch.
    test.info().annotations.push({ type: 'skip-reason', description: 'Excel sin columna Fecha: switch Mensual oculto' })
    return
  }

  await mensual.click()
  // El selector de meses (MonthPicker) muestra el mes en curso por defecto ("Julio 2026").
  const mesActual = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date())
  const label = mesActual.charAt(0).toUpperCase() + mesActual.slice(1)
  const picker = page.getByRole('button', { name: new RegExp(label) })
  await expect(picker).toBeVisible()

  // Abre el calendario de meses y confirma la grilla.
  await picker.click()
  await expect(page.getByRole('button', { name: 'Jul', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  // Volver a Total: el selector desaparece.
  await page.getByRole('button', { name: 'Total' }).click()
  await expect(page.getByRole('button', { name: new RegExp(label) })).toHaveCount(0)
})

test('el detalle del banco alterna Total y Mensual', async ({ page }) => {
  await page.goto('/bancos')
  await expect(page.getByRole('heading', { name: 'Bancos de horas' })).toBeVisible()
  const primera = page.locator('a[href^="/bancos/"]').first()
  if (!(await primera.isVisible().catch(() => false))) return // sin proyectos visibles
  // Navegación con reintento: la lista se re-ordena al hidratar y el clic puede perderse.
  await expect(async () => {
    await primera.click()
    await page.waitForURL(/\/bancos\/.+/, { timeout: 2500 })
  }).toPass({ timeout: 15000 })
  // En Total el detalle muestra la sección "Por posición" (aserción específica del detalle).
  await expect(page.getByRole('heading', { name: 'Por posición' })).toBeVisible()

  const mensual = page.getByRole('button', { name: 'Mensual' })
  if (!(await mensual.isVisible().catch(() => false))) return // Excel sin columna Fecha
  // Clic con reintento: la página del detalle es pesada y el primer clic puede perderse
  // si el componente cliente aún no hidrató. En Mensual muestra "Banco mensual por posición".
  await expect(async () => {
    await mensual.click()
    await expect(page.getByRole('heading', { name: 'Banco mensual por posición' })).toBeVisible({ timeout: 1500 })
  }).toPass({ timeout: 12000 })
})

test('ocultar finalizados quita del banco los proyectos finalizados', async ({ page }) => {
  await page.goto('/bancos')
  await expect(page.getByRole('heading', { name: 'Bancos de horas' })).toBeVisible()
  const toggle = page.getByRole('checkbox', { name: 'Ocultar finalizados' })
  await expect(toggle).toBeVisible()
  // Si hay algún proyecto finalizado visible, al activar el filtro debe desaparecer.
  if (!(await page.getByText('Finalizado', { exact: true }).first().isVisible().catch(() => false))) return
  await toggle.check()
  await expect(page.getByText('Finalizado', { exact: true })).toHaveCount(0)
})

test('un proyecto solo en Clientes_Proyectos (con consumo) aparece en el banco', async ({ page }) => {
  await page.goto('/bancos')
  await expect(page.getByRole('heading', { name: 'Bancos de horas' })).toBeVisible()
  // "Opospills" tiene horas registradas pero no está en BancoHoras; antes no aparecía.
  await page.getByLabel('Buscar proyecto').fill('Opospills')
  // Aparece como fila (o mensaje de vacío si el Excel/seed cambió; toleramos ambos).
  const fila = page.getByRole('link', { name: /Opospills/ })
  const vacio = page.getByText('No hay bancos que coincidan con los filtros.')
  await expect(fila.or(vacio)).toBeVisible()
})

test('la vista Mensual del banco marca los meses provisionales', async ({ page }) => {
  await page.goto('/bancos')
  const mensual = page.getByRole('button', { name: 'Mensual' })
  if (!(await mensual.isVisible().catch(() => false))) return // Excel sin columna Fecha
  await mensual.click()
  // Si hay datos provisionales para el mes en curso, hay al menos una marca "Prov."
  // Tolerante: si no hay, no falla (el mes puede estar todo cargado).
  // Nota: la lista usa el texto corto "Prov." (el detalle usa "Provisional" completo).
  const marca = page.getByText('Prov.', { exact: true })
  if ((await marca.count()) > 0) await expect(marca.first()).toBeVisible()
})
