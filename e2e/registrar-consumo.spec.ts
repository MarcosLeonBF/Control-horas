import { test, expect } from '@playwright/test'
import fs from 'node:fs'

const fixture = JSON.parse(fs.readFileSync('e2e/.fixture.json', 'utf8'))

test('registrar un consumo descuenta el saldo y aparece en el historial', async ({ page }) => {
  await page.goto(`/presupuestos/${fixture.projectAssignedId}`)

  await page.getByRole('button', { name: /registrar consumo/i }).click()
  await page.getByLabel(/importe/i).fill('120')
  await page.getByLabel(/descripción/i).fill('Compra recurso E2E')
  await page.getByRole('button', { name: /guardar/i }).click()

  // saldo restante 500 - 120 = 380
  await expect(page.locator('.tabular-money').filter({ hasText: '380 €' }).first()).toBeVisible()
  // historial muestra el consumo
  await expect(page.getByText('Compra recurso E2E')).toBeVisible()
  await expect(page.getByText('120 €').first()).toBeVisible()
})

test('validación: importe vacío no envía', async ({ page }) => {
  await page.goto(`/presupuestos/${fixture.projectAssignedId}`)
  // Si la sesión fue renovada por la Server Action anterior, re-login por UI
  if (page.url().includes('/login')) {
    await page.getByLabel(/email/i).fill(fixture.managerEmail)
    await page.getByLabel(/contraseña/i).fill(fixture.managerPassword)
    await page.getByRole('button', { name: /ingresar/i }).click()
    await page.waitForURL('**/presupuestos')
    await page.goto(`/presupuestos/${fixture.projectAssignedId}`)
  }
  await page.getByRole('button', { name: /registrar consumo/i }).click()
  await page.getByLabel(/descripción/i).fill('sin importe')
  await page.getByRole('button', { name: /guardar/i }).click()
  await expect(page.getByText(/importe.*mayor a 0/i)).toBeVisible()
})
