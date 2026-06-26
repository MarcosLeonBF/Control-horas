import { test, expect } from '@playwright/test'
import fs from 'node:fs'

const fixture = JSON.parse(fs.readFileSync('e2e/.fixture.json', 'utf8'))

test('un admin amplía el presupuesto y sube el asignado/restante', async ({ page }) => {
  await page.goto(`/presupuestos/${fixture.projectAssignedId}`)
  await expect(page.getByRole('heading', { name: /ampliar presupuesto/i })).toBeVisible()
  await page.getByLabel('Monto').fill('250')
  await page.getByLabel('Motivo').fill('Paquete extra E2E')
  await page.getByRole('button', { name: /^ampliar$/i }).click()
  // el fondeo inicial del fixture es 500; tras ampliar 250 el asignado debe mostrar 750,00
  await expect(page.locator('.tabular-money').filter({ hasText: '750,00' }).first()).toBeVisible()
})
