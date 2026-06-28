import { test, expect } from '@playwright/test'

test('el dashboard admin muestra KPIs, lista proyectos y filtra', async ({ page }) => {
  await page.goto('/presupuestos/dashboard')

  await expect(page.getByRole('heading', { name: /^dashboard$/i })).toBeVisible()
  await expect(page.getByText('Asignado total')).toBeVisible()
  await expect(page.getByText('Restante total')).toBeVisible()

  // el proyecto del fixture HUCHA aparece en la tabla
  await expect(page.getByText('Cliente E2E Asignado')).toBeVisible()

  // buscar algo inexistente vacía la tabla
  await page.getByLabel('Buscar proyecto').fill('zzz-no-existe-zzz')
  await expect(page.getByText('No hay proyectos que coincidan con los filtros.')).toBeVisible()
})
