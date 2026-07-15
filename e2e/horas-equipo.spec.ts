import { test, expect } from '@playwright/test'

test('manager/admin ve la pantalla de equipo', async ({ page }) => {
  await page.goto('/equipo')
  await expect(page.getByRole('heading', { name: /registros del equipo/i })).toBeVisible()
})

// La estructura por área sale de las POSICIONES (position_areas, modelo 0028):
// el miembro sembrado tiene una posición del área CRM y debe aparecer en la tarjeta.
test('la estructura por área muestra a los miembros según su posición', async ({ page }) => {
  await page.goto('/equipo')
  await expect(page.getByRole('heading', { name: 'CRM', exact: true }).first()).toBeVisible()
  await expect(page.getByText('Miembro E2E').first()).toBeVisible()
})
