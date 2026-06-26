import { test, expect } from '@playwright/test'

test('un admin abre la pantalla de sincronización y ve el botón', async ({ page }) => {
  await page.goto('/presupuestos/sincronizar')
  await expect(page.getByRole('heading', { name: /sincronizar presupuestos/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /sincronizar con excel/i })).toBeVisible()
})
