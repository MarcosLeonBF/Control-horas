import { test, expect } from '@playwright/test'
import fs from 'node:fs'

const horas = JSON.parse(fs.readFileSync('e2e/.horas.json', 'utf8')) as {
  operativoLogId: string; operativoName: string
}

test('el admin abre la edición de un registro ajeno con el nombre del dueño', async ({ page }) => {
  await page.goto(`/registrar?edit=${horas.operativoLogId}`)
  // El encabezado nombra al dueño → prueba: autorización de precarga (admin) + detección de
  // ajeno + resolución del nombre. (El catálogo del dueño lo cubre tsc/revisión.)
  await expect(
    page.getByRole('heading', { name: `Editar registro de ${horas.operativoName}` }),
  ).toBeVisible()
})
