import { test, expect } from '@playwright/test'
import fs from 'node:fs'

const fixture = JSON.parse(fs.readFileSync('e2e/.fixture.json', 'utf8'))

test('el detalle muestra el saldo y el historial', async ({ page }) => {
  await page.goto(`/presupuestos/${fixture.projectAssignedId}`)
  await expect(page.getByRole('heading', { name: /Cliente E2E Asignado/ })).toBeVisible()
  await expect(page.getByText('Restante')).toBeVisible()
  await expect(page.locator('.tabular-money').first()).toContainText('500 €')
  // el historial muestra la carga inicial (ampliacion)
  await expect(page.getByText('Carga inicial E2E')).toBeVisible()
})
