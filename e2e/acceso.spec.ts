import { test, expect } from '@playwright/test'

test('manager autenticado aterriza en Horas y puede ir a Presupuestos', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/registrar$/)
  // desde la nav de Horas, el manager llega a HUCHA
  await page.getByRole('link', { name: /presupuestos/i }).click()
  await expect(page).toHaveURL(/\/presupuestos$/)
})

test('logout redirige a login y bloquea el área', async ({ page, context }) => {
  await page.goto('/presupuestos')
  await page.getByRole('button', { name: /salir/i }).click()
  await expect(page).toHaveURL(/\/login$/)
  await context.clearCookies()
  await page.goto('/presupuestos')
  await expect(page).toHaveURL(/\/login$/)
})
