import { test, expect } from '@playwright/test'

test('un admin crea un usuario operativo', async ({ page }) => {
  await page.goto('/admin/usuarios')
  const email = `e2e-nuevo-${Date.now()}@horas.test`
  await page.getByLabel('Nombre').fill('Nuevo E2E')
  await page.getByLabel('Correo').fill(email)
  await page.getByLabel('Contraseña').fill('Passw0rd-E2E')
  await page.getByLabel('Posición').fill('Especialista')
  await page.getByRole('button', { name: /crear usuario/i }).click()
  await expect(page.getByText(/usuario creado/i)).toBeVisible()
})
