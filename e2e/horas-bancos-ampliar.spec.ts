import { test, expect } from '@playwright/test'

// Amplía y luego anula (auto-limpiante: no deja horas sumando en un proyecto real).
test('el admin amplía y anula horas de un proyecto', async ({ page }) => {
  page.on('dialog', (d) => d.accept()) // aceptar el confirm() de anular

  await page.goto('/bancos')
  // La lista de /bancos es una <ul>/<li> con <Link> (ya no una <table>).
  await page.locator('a[href^="/bancos/"]').first().click()
  await expect(page.getByRole('heading', { name: 'Ampliar horas' })).toBeVisible()

  const motivo = `E2E ampliación ${Date.now()}`
  await page.getByLabel('Horas').fill('3')
  await page.getByLabel('Motivo').fill(motivo)
  await page.getByRole('button', { name: /^ampliar$/i }).click()

  // El motivo aparece en dos tablas (Ampliaciones y Movimientos, que lo muestra como
  // detalle): acotamos a la sección "Ampliaciones" para no matchear ambas filas.
  const seccionAmpliaciones = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Ampliaciones', exact: true }) })
  const fila = seccionAmpliaciones.getByRole('row').filter({ hasText: motivo })
  await expect(fila).toBeVisible()
  await expect(fila.getByText('+3h')).toBeVisible()

  // anular → la fila queda como "anulada"
  await fila.getByRole('button', { name: /anular/i }).click()
  await expect(seccionAmpliaciones.getByRole('row').filter({ hasText: motivo }).getByText('anulada')).toBeVisible()
})
