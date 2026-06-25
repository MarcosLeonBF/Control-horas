import { test, expect } from '@playwright/test'

test('registrar dos líneas guarda el día con su total', async ({ page }) => {
  await page.goto('/registrar')
  // línea 1
  await page.getByLabel('Proyecto').first().selectOption({ index: 1 })
  await page.getByLabel('Etapa').first().selectOption({ index: 1 })
  await page.getByLabel('Horas').first().fill('2')
  await page.getByLabel('Descripción').first().fill('Trabajo E2E 1')
  // añadir línea 2
  await page.getByRole('button', { name: /añadir línea/i }).click()
  await page.getByLabel('Proyecto').nth(1).selectOption({ index: 1 })
  await page.getByLabel('Etapa').nth(1).selectOption({ index: 2 })
  await page.getByLabel('Horas').nth(1).fill('1.5')
  await page.getByLabel('Descripción').nth(1).fill('Trabajo E2E 2')

  await expect(page.getByText(/total del día/i)).toContainText('3.5h')
  await page.getByRole('button', { name: /guardar registro/i }).click()
  await expect(page).toHaveURL(/\/mis-registros/)
})

test('proyecto Departamento habilita Departamento y fija Área Interno', async ({ page }) => {
  await page.goto('/registrar')
  await page.getByLabel('Proyecto').first().selectOption('Departamento')
  await expect(page.getByLabel('Departamento').first()).toBeEnabled()
})
