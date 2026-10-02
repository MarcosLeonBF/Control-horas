import { test, expect } from '@playwright/test'
import { slackE2E } from './helpers/slack-e2e'

test('un admin crea un usuario operativo', async ({ page }) => {
  await page.goto('/admin/usuarios')
  const email = `e2e-nuevo-${Date.now()}@horas.test`
  await page.getByLabel('Nombre').fill('Nuevo E2E')
  await page.getByLabel('Correo').fill(email)
  await page.getByLabel('Contraseña').fill('Passw0rd-E2E')
  await page.getByLabel('ID de Slack', { exact: true }).fill(slackE2E())
  // Posición es un <select> del catálogo: se elige la primera posición real.
  await page.getByLabel('Posición').selectOption({ index: 1 })
  await page.getByRole('button', { name: /crear usuario/i }).click()
  await expect(page.getByText(/usuario creado/i)).toBeVisible()
})
