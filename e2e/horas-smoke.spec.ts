import { test, expect } from '@playwright/test'

test('un usuario activo accede a /registrar', async ({ page }) => {
  await page.goto('/registrar')
  await expect(page.getByRole('heading', { name: /registrar horas/i })).toBeVisible()
})
