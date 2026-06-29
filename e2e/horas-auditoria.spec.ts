import { test, expect } from '@playwright/test'

test('el admin ve la pantalla de auditoría', async ({ page }) => {
  await page.goto('/admin/auditoria')
  await expect(page.getByRole('heading', { name: 'Auditoría' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Acción' })).toBeVisible()
})
