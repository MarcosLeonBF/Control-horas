import { test, expect } from '@playwright/test'

test('manager/admin ve la pantalla de equipo', async ({ page }) => {
  await page.goto('/equipo')
  await expect(page.getByRole('heading', { name: /registros del equipo/i })).toBeVisible()
})
