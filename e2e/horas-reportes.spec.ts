import { test, expect } from '@playwright/test'

test('el admin ve el reporte consolidado, agrupa y descarga resumen y detalle', async ({ page }) => {
  await page.goto('/reportes')
  await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible()
  await expect(page.getByText('Total de horas')).toBeVisible()

  // cambiar la agrupación a Usuario
  await page.getByRole('button', { name: 'Usuario' }).click()

  // descargar el CSV del RESUMEN (agrupado por usuario)
  const resumen = page.locator('span').filter({ hasText: 'Resumen:' })
  const [dlResumen] = await Promise.all([
    page.waitForEvent('download'),
    resumen.getByRole('button', { name: 'CSV' }).click(),
  ])
  expect(dlResumen.suggestedFilename()).toContain('reporte-horas-por-user')

  // descargar el CSV del DETALLE (líneas de registro)
  const detalle = page.locator('span').filter({ hasText: 'Detalle:' })
  const [dlDetalle] = await Promise.all([
    page.waitForEvent('download'),
    detalle.getByRole('button', { name: 'CSV' }).click(),
  ])
  expect(dlDetalle.suggestedFilename()).toContain('detalle-horas')

  // descargar el CSV de REGISTROS (totales diarios)
  const registros = page.locator('span').filter({ hasText: 'Registros:' })
  const [dlRegistros] = await Promise.all([
    page.waitForEvent('download'),
    registros.getByRole('button', { name: 'CSV' }).click(),
  ])
  expect(dlRegistros.suggestedFilename()).toContain('registros-horas')
})
