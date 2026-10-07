import { test, expect } from '@playwright/test'

// Amplía y luego anula (auto-limpiante: no deja horas sumando en un proyecto real).
test('el admin amplía y anula horas de un proyecto', async ({ page }) => {
  page.on('dialog', (d) => d.accept()) // aceptar el confirm() de anular

  await page.goto('/bancos')
  await expect(page.getByRole('heading', { name: 'Bancos de horas' })).toBeVisible()
  // La lista de /bancos es una <ul>/<li> con <Link> (ya no una <table>). Esperamos a que
  // la primera fila esté lista (la lista puede ser larga y tardar en hidratar).
  const primera = page.locator('a[href^="/bancos/"]').first()
  await expect(primera).toBeVisible()
  // Navegación con reintento: la lista se re-ordena al hidratar y el clic puede perderse.
  await expect(async () => {
    await primera.click()
    await page.waitForURL(/\/bancos\/.+/, { timeout: 2500 })
  }).toPass({ timeout: 15000 })
  // "Ampliar horas" es un botón de la cabecera que abre un diálogo. Clic con reintento: la
  // página del detalle es pesada y, si se pulsa antes de hidratar, el diálogo no se abre.
  const dialogo = page.getByRole('dialog')
  await expect(async () => {
    await page.getByRole('button', { name: 'Ampliar horas' }).click()
    await expect(dialogo.getByRole('heading', { name: 'Ampliar horas' })).toBeVisible({ timeout: 1500 })
  }).toPass({ timeout: 15000 })

  const motivo = `E2E ampliación ${Date.now()}`
  await dialogo.getByLabel('Horas').fill('3')
  await dialogo.getByLabel('Motivo').fill(motivo)
  await dialogo.getByRole('button', { name: /^ampliar$/i }).click()
  await expect(dialogo).toBeHidden()

  // El motivo aparece en dos tablas (Ampliaciones y Movimientos, que lo muestra como
  // detalle): acotamos a la sección "Ampliaciones" para no matchear ambas filas.
  const seccionAmpliaciones = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Ampliaciones', exact: true }) })
  const fila = seccionAmpliaciones.getByRole('row').filter({ hasText: motivo })
  await expect(fila).toBeVisible({ timeout: 10000 })
  await expect(fila.getByText('+3,00h')).toBeVisible()

  // anular → la fila queda como "anulada"
  await fila.getByRole('button', { name: /anular/i }).click()
  await expect(seccionAmpliaciones.getByRole('row').filter({ hasText: motivo }).getByText('anulada')).toBeVisible()
})
