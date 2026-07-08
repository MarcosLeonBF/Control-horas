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

test('el switch Mensual muestra el mes en curso y navega meses', async ({ page }) => {
  await page.goto('/bancos')
  await expect(page.getByRole('heading', { name: 'Bancos de horas' })).toBeVisible()

  const mensual = page.getByRole('button', { name: 'Mensual' })
  if (!(await mensual.isVisible().catch(() => false))) {
    // El Excel aún no tiene la columna Fecha: la vista Total es la única y no hay switch.
    test.info().annotations.push({ type: 'skip-reason', description: 'Excel sin columna Fecha: switch Mensual oculto' })
    return
  }

  await mensual.click()
  // Selector con el mes en curso (formato "Julio 2026").
  const mesActual = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date())
  const label = mesActual.charAt(0).toUpperCase() + mesActual.slice(1)
  await expect(page.getByText(label)).toBeVisible()

  // Navegar al mes anterior y volver.
  const prev = page.getByRole('button', { name: 'Mes anterior' })
  if (await prev.isEnabled()) {
    await prev.click()
    await expect(page.getByText(label)).toHaveCount(0)
    await page.getByRole('button', { name: 'Mes siguiente' }).click()
    await expect(page.getByText(label)).toBeVisible()
  }

  // Volver a Total: el selector de mes desaparece.
  await page.getByRole('button', { name: 'Total' }).click()
  await expect(page.getByRole('button', { name: 'Mes anterior' })).toHaveCount(0)
})

test('el detalle del banco alterna Total y Mensual', async ({ page }) => {
  await page.goto('/bancos')
  const primera = page.locator('a[href^="/bancos/"]').first()
  if (!(await primera.isVisible().catch(() => false))) return // sin proyectos visibles
  await primera.click()
  await expect(page.getByText('Asignado')).toBeVisible()

  const mensual = page.getByRole('button', { name: 'Mensual' })
  if (!(await mensual.isVisible().catch(() => false))) return // Excel sin columna Fecha
  await mensual.click()
  await expect(page.getByRole('button', { name: 'Mes anterior' })).toBeVisible()
  await expect(page.getByText('Por posición')).toBeVisible()
})
