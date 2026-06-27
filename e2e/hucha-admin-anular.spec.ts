import { test, expect } from '@playwright/test'
import fs from 'node:fs'

const fixture = JSON.parse(fs.readFileSync('e2e/.fixture.json', 'utf8'))

test('un admin anula una ampliación y aparece el asiento de reversión', async ({ page }) => {
  page.on('dialog', (d) => d.accept()) // aceptar el confirm() ANTES de cualquier click
  await page.goto(`/presupuestos/${fixture.projectAssignedId}`)

  // crear una ampliación para luego anularla (self-contained)
  await page.getByLabel('Monto').fill('300')
  await page.getByLabel('Motivo').fill('Para anular E2E')
  await page.getByRole('button', { name: /^ampliar$/i }).click()
  await expect(page.getByText('Para anular E2E')).toBeVisible()

  // anular la fila de esa ampliación
  const fila = page.getByRole('row').filter({ hasText: 'Para anular E2E' })
  await fila.getByRole('button', { name: /anular/i }).click()

  // aparece el asiento de Anulación en el historial
  await expect(page.getByText('Anulación').first()).toBeVisible()
})
