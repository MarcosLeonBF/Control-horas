import { test, expect } from '@playwright/test'

test('el admin ve los bancos de horas con asignado vs registrado', async ({ page }) => {
  await page.goto('/bancos')
  await expect(page.getByRole('heading', { name: 'Bancos de horas' })).toBeVisible()
  // KPIs
  await expect(page.getByText('Asignado total')).toBeVisible()
  await expect(page.getByText('Consumido total')).toBeVisible()
  // Al menos un proyecto del Excel y el contador "X de Y proyectos"
  await expect(page.getByText(/de \d+ proyectos/)).toBeVisible()

  // Filtro vacío → mensaje de sin resultados
  await page.getByLabel('Buscar proyecto').fill('zzz-no-existe-zzz')
  await expect(page.getByText('No hay proyectos que coincidan con los filtros.')).toBeVisible()
})
