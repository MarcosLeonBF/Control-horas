import { test, expect } from '@playwright/test'

test('el admin ve la pantalla de auditoría', async ({ page }) => {
  await page.goto('/admin/auditoria')
  await expect(page.getByRole('heading', { name: 'Auditoría' })).toBeVisible()
  await expect(page.getByText('Movimientos', { exact: true })).toBeVisible()
})

test('el filtro de acción acota los movimientos', async ({ page }) => {
  await page.goto('/admin/auditoria')
  const chip = page.getByRole('button', { name: 'Anulación' })
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  // Con solo anulaciones marcadas, no debe quedar ninguna insignia de creación en la
  // tabla. Se acota a la lista de filas porque el propio chip "Creación" del filtro
  // sigue en el DOM (sin marcar) y un getByText sin acotar lo encontraría a él.
  await expect(page.getByRole('list').getByText('Creación', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Limpiar' }).click()
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
})

test('agrupar por quien edita mete las filas bajo cabeceras plegables', async ({ page }) => {
  await page.goto('/admin/auditoria')
  await page.getByRole('button', { name: 'Quien edita' }).click()

  // Los grupos arrancan plegados: hay cabeceras, y ninguna desplegada.
  const cabeceras = page.getByRole('button', { expanded: false })
  await expect(cabeceras.first()).toBeVisible()

  await page.getByRole('button', { name: 'Desplegar todo' }).click()
  await expect(page.getByRole('button', { name: 'Plegar todo' })).toBeVisible()
  await expect(page.getByRole('button', { expanded: true }).first()).toBeVisible()
})

test('el rango de fechas viaja en la URL', async ({ page }) => {
  await page.goto('/admin/auditoria?from=2026-07-01&to=2026-07-31')
  await expect(page.locator('input[name="from"]')).toHaveValue('2026-07-01')
  await expect(page.locator('input[name="to"]')).toHaveValue('2026-07-31')
})
