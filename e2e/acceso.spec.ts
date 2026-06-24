import { test, expect } from '@playwright/test'

test('manager autenticado aterriza en /presupuestos desde la raíz', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/presupuestos$/)
  await expect(page.getByRole('link', { name: /presupuestos/i })).toBeVisible()
})

test('logout redirige a login y bloquea el área', async ({ page, context }) => {
  await page.goto('/presupuestos')
  await page.getByRole('button', { name: /salir/i }).click()
  await expect(page).toHaveURL(/\/login$/)
  await context.clearCookies()
  await page.goto('/presupuestos')
  await expect(page).toHaveURL(/\/login$/)
})
