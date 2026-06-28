import { test, expect } from '@playwright/test'

test('el admin descarga presupuestos en CSV desde el dashboard', async ({ page }) => {
  await page.goto('/presupuestos/dashboard')

  // grupo de descarga "Presupuestos:" → botón CSV
  const grupo = page.locator('span').filter({ hasText: 'Presupuestos:' })
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    grupo.getByRole('button', { name: 'CSV' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('hucha-presupuestos.csv')
})
