import { test, expect } from '@playwright/test'

// Amplía y luego anula (auto-limpiante: no deja horas sumando en un proyecto real).
test('el admin amplía y anula horas de un proyecto', async ({ page }) => {
  page.on('dialog', (d) => d.accept()) // aceptar el confirm() de anular

  await page.goto('/bancos')
  await page.getByRole('table').getByRole('link').first().click()
  await expect(page.getByRole('heading', { name: 'Ampliar horas' })).toBeVisible()

  const motivo = `E2E ampliación ${Date.now()}`
  await page.getByLabel('Horas').fill('3')
  await page.getByLabel('Motivo').fill(motivo)
  await page.getByRole('button', { name: /^ampliar$/i }).click()

  // aparece la fila de la ampliación con +3h
  const fila = page.getByRole('row').filter({ hasText: motivo })
  await expect(fila).toBeVisible()
  await expect(fila.getByText('+3h')).toBeVisible()

  // anular → la fila queda como "anulada"
  await fila.getByRole('button', { name: /anular/i }).click()
  await expect(page.getByRole('row').filter({ hasText: motivo }).getByText('anulada')).toBeVisible()
})
