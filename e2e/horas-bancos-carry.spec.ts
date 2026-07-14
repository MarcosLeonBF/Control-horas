import { test, expect } from '@playwright/test'

test('el detalle muestra Disponible real y el cierre desplegable por posición', async ({ page }) => {
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
  // El cierre vive DENTRO de "Por posición": si hay filas con meses, se despliegan
  // (tolerante: un proyecto sin datos mensuales no tiene filas expandibles).
  const fila = page.locator('tr[aria-expanded]').first()
  if ((await fila.count()) > 0) {
    // Clic con reintento: la página es pesada y el primer clic puede perderse sin hidratar.
    await expect(async () => {
      await fila.click()
      await expect(fila).toHaveAttribute('aria-expanded', 'true', { timeout: 1500 })
    }).toPass({ timeout: 12000 })
  }
})

// La marca «CF» de la lista se quitó por decisión de UI (2026-07-14): saturaba la columna
// de estado. El carry se ve en el detalle (KPI + cierre de mes) y en el export (columnas
// Inutilizables / Libres (carry)).
