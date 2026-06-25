import { test, expect } from '@playwright/test'

test('un registro guardado aparece en Mis registros y se puede anular', async ({ page }) => {
  // crear uno
  await page.goto('/registrar')
  await page.getByLabel('Proyecto').first().selectOption({ index: 1 })
  await page.getByLabel('Etapa').first().selectOption({ index: 1 })
  await page.getByLabel('Horas').first().fill('3')
  await page.getByLabel('Descripción').first().fill('Para anular')
  await page.getByRole('button', { name: /guardar registro/i }).click()
  await expect(page).toHaveURL(/\/mis-registros/)

  await expect(page.getByText('Para anular').first()).toBeVisible()
  await page.getByRole('button', { name: /anular/i }).first().click()
  await expect(page.getByText('anulado').first()).toBeVisible()
})

test('editar un registro propio actualiza sus horas', async ({ page }) => {
  await page.goto('/registrar')
  await page.getByLabel('Proyecto').first().selectOption({ index: 1 })
  await page.getByLabel('Etapa').first().selectOption({ index: 1 })
  await page.getByLabel('Horas').first().fill('2')
  await page.getByLabel('Descripción').first().fill('Antes de editar')
  await page.getByRole('button', { name: /guardar registro/i }).click()
  await expect(page).toHaveURL(/\/mis-registros/)

  await page.getByRole('link', { name: /editar/i }).first().click()
  await expect(page.getByRole('heading', { name: /editar registro/i })).toBeVisible()
  await page.getByLabel('Horas').first().fill('5')
  await page.getByRole('button', { name: /guardar registro/i }).click()
  await expect(page).toHaveURL(/\/mis-registros/)
  await expect(page.getByText('5h').first()).toBeVisible()
})
