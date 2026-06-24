import { test, expect } from '@playwright/test'

test('el manager ve su proyecto asignado con el saldo correcto', async ({ page }) => {
  await page.goto('/presupuestos')
  const card = page.getByRole('link', { name: /Cliente E2E Asignado/ })
  await expect(card).toBeVisible()
  await expect(card).toContainText('500,00') // asignado/restante en EUR
  await expect(card).toContainText('Disponible')
})

test('el manager NO ve proyectos que no le fueron asignados', async ({ page }) => {
  await page.goto('/presupuestos')
  await expect(page.getByText('Cliente E2E NoAsignado')).toHaveCount(0)
})
