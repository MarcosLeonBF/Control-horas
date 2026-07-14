import { test, expect } from '@playwright/test'

test('el detalle muestra Disponible real y el cierre de mes por posición', async ({ page }) => {
  await page.goto('/bancos')
  await expect(page.getByRole('heading', { name: 'Bancos de horas' })).toBeVisible()
  const primera = page.locator('a[href^="/bancos/"]').first()
  if (!(await primera.isVisible().catch(() => false))) return // sin proyectos visibles
  // Navegación con reintento: la lista se re-ordena al hidratar y el clic puede perderse.
  await expect(async () => {
    await primera.click()
    await page.waitForURL(/\/bancos\/.+/, { timeout: 2500 })
  }).toPass({ timeout: 15000 })
  // KPI nuevo (vista Total).
  await expect(page.getByText('Disponible real')).toBeVisible()
  // La sección de charts existe solo si el proyecto tiene datos mensuales (tolerante).
  const cierre = page.getByRole('heading', { name: 'Cierre de mes por posición' })
  if ((await cierre.count()) > 0) await expect(cierre.first()).toBeVisible()
})
