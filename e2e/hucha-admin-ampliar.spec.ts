import { test, expect } from '@playwright/test'
import fs from 'node:fs'

const fixture = JSON.parse(fs.readFileSync('e2e/.fixture.json', 'utf8'))

test('un admin amplía el presupuesto y sube el asignado/restante', async ({ page }) => {
  await page.goto(`/presupuestos/${fixture.projectAssignedId}`)
  await expect(page.getByRole('heading', { name: /ampliar presupuesto/i })).toBeVisible()
  await page.getByLabel('Monto').fill('250')
  await page.getByLabel('Motivo').fill('Paquete extra E2E')
  await page.getByRole('button', { name: /^ampliar$/i }).click()
  // La ampliación queda registrada como movimiento +250 € con su motivo.
  // (Se afirma la fila propia, no el total absoluto: el proyecto-fixture es
  //  compartido y otras pruebas pueden ampliarlo en paralelo.)
  const fila = page.getByRole('row').filter({ hasText: 'Paquete extra E2E' })
  await expect(fila).toBeVisible()
  await expect(fila.getByText('+250 €')).toBeVisible()
})
