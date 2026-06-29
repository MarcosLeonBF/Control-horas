import { test, expect } from '@playwright/test'

test('el admin ve el reporte consolidado, agrupa y descarga CSV', async ({ page }) => {
  await page.goto('/reportes')
  await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible()
  await expect(page.getByText('Total de horas')).toBeVisible()

  // cambiar la agrupación a Usuario
  await page.getByRole('button', { name: 'Usuario' }).click()

  // descargar el CSV de la vista actual
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSV' }).click(),
  ])
  expect(download.suggestedFilename()).toContain('reporte-horas-por-user')
})
