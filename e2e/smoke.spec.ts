import { test, expect } from '@playwright/test'

test('login page renders', async ({ page }) => {
  // storageState autentica al manager; /login redirige a la app autenticada
  await page.goto('/login')
  await expect(page).toHaveURL(/presupuestos|registrar|\/$/)
})
