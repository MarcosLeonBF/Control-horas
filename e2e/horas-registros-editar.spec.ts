import { test, expect } from '@playwright/test'
import fs from 'node:fs'

const horas = JSON.parse(fs.readFileSync('e2e/.horas.json', 'utf8')) as {
  operativoLogId: string; operativoName: string
}

test('el buscador de /equipo filtra por usuario', async ({ page }) => {
  await page.goto('/equipo')
  await expect(page.getByRole('heading', { name: 'Equipo', exact: true })).toBeVisible()
  const buscar = page.getByLabel('Buscar registro')
  await buscar.fill(horas.operativoName)
  // La fila del operativo sembrado sigue visible…
  await expect(page.locator('li').filter({ hasText: horas.operativoName }).first()).toBeVisible()
  // …y un término imposible deja la lista vacía con el mensaje de "sin coincidencias".
  await buscar.fill('zzz-no-existe-zzz')
  await expect(page.getByText('No hay registros que coincidan con los filtros.')).toBeVisible()
})

test('el admin abre la edición de un registro ajeno con el nombre del dueño', async ({ page }) => {
  await page.goto(`/registrar?edit=${horas.operativoLogId}`)
  // El encabezado nombra al dueño → prueba: autorización de precarga (admin) + detección de
  // ajeno + resolución del nombre. (El catálogo del dueño lo cubre tsc/revisión.)
  await expect(
    page.getByRole('heading', { name: `Editar registro de ${horas.operativoName}` }),
  ).toBeVisible()
})

// Va al final: deja el registro sembrado en estado "anulado" (los tests anteriores lo
// necesitan no anulado). Playwright ejecuta los tests de un archivo en orden.
test('el admin anula un registro ajeno desde /equipo', async ({ page }) => {
  page.on('dialog', (d) => d.accept()) // aceptar el confirm() de anular
  await page.goto('/equipo')
  await expect(page.getByRole('heading', { name: 'Equipo', exact: true })).toBeVisible()
  // Acotar por el buscador y desplegar la fila del operativo sembrado.
  await page.getByLabel('Buscar registro').fill(horas.operativoName)
  const fila = page.locator('li').filter({ hasText: horas.operativoName }).first()
  await expect(fila).toBeVisible()
  await fila.getByRole('button').first().click() // toggle de la fila
  // El enlace Editar apunta al formulario de edición de ese registro.
  await expect(fila.getByRole('link', { name: /editar/i })).toHaveAttribute('href', `/registrar?edit=${horas.operativoLogId}`)
  // Anular → la fila queda en estado "anulado".
  await fila.getByRole('button', { name: /anular/i }).click()
  await expect(
    page.locator('li').filter({ hasText: horas.operativoName }).first().getByText('anulado'),
  ).toBeVisible()
})
