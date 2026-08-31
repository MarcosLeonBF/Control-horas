import { test, expect, type Page } from '@playwright/test'

// Corre con el storage state del operativo (proyecto chromium-horas). El admin entra
// en su propio contexto: la gracia del permiso es que lo concede uno y lo sufre otro.
const OPERATIVO_EMAIL = 'e2e-operativo@horas.test'
const ADMIN_STATE = 'e2e/.auth/admin-horas.json'

const fechaHaceDias = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

// Abre el diálogo "Días de registro" del operativo desde el panel del admin.
async function abrirDialogo(adminPage: Page) {
  await adminPage.goto('/admin/usuarios')
  await adminPage.getByLabel('Buscar usuario').fill(OPERATIVO_EMAIL)
  const fila = adminPage.getByRole('row').filter({ hasText: OPERATIVO_EMAIL })
  await expect(fila).toBeVisible()
  await fila.getByRole('button', { name: 'Días de registro' }).click()
}

test('el admin abre la ventana de registro de un usuario y vuelve a cerrarla', async ({ page, browser }) => {
  const adminCtx = await browser.newContext({ storageState: ADMIN_STATE })
  const adminPage = await adminCtx.newPage()

  try {
    // Punto de partida: el operativo solo alcanza 7 días atrás.
    await page.goto('/registrar')
    await expect(page.getByText('Hasta 7 días atrás')).toBeVisible()
    await expect(page.getByLabel('Fecha por defecto')).toHaveAttribute('min', fechaHaceDias(7))

    // El admin le concede 30 días.
    await abrirDialogo(adminPage)
    await adminPage.getByLabel('Cantidad').fill('30')
    await expect(adminPage.getByText(/podrá registrar desde el/i)).toBeVisible()
    await adminPage.getByRole('button', { name: 'Dar permiso' }).click()
    await expect(adminPage.getByText('Podrá registrar hasta 30 días atrás')).toBeVisible()

    // El panel lo deja a la vista para poder apagarlo después.
    await expect(
      adminPage.getByRole('row').filter({ hasText: OPERATIVO_EMAIL }).getByText('Registro 30 días'),
    ).toBeVisible()

    // El chip recoge a los que tienen la ventana abierta: es por donde se revisan y
    // se apagan. Sin afirmar la cuenta exacta, que otros specs pueden estar tocándola.
    const chip = adminPage.getByRole('button', { name: /con registro ampliado/i })
    await expect(chip).toBeEnabled()
    await adminPage.getByLabel('Buscar usuario').fill('')
    await chip.click()
    await expect(adminPage.getByRole('row').filter({ hasText: OPERATIVO_EMAIL })).toBeVisible()
    await expect(chip).toHaveAttribute('aria-pressed', 'true')

    // El formulario del operativo se abre hasta esa fecha, sin que nadie se lo diga.
    await page.reload()
    await expect(page.getByText('Hasta 30 días atrás')).toBeVisible()
    await expect(page.getByLabel('Fecha por defecto')).toHaveAttribute('min', fechaHaceDias(30))

    // El admin apaga el permiso: es la mitad que de verdad importa.
    await abrirDialogo(adminPage)
    await adminPage.getByRole('button', { name: 'Quitar permiso' }).click()
    await expect(adminPage.getByText('Permiso quitado')).toBeVisible()

    await page.reload()
    await expect(page.getByText('Hasta 7 días atrás')).toBeVisible()
    await expect(page.getByLabel('Fecha por defecto')).toHaveAttribute('min', fechaHaceDias(7))
  } finally {
    // Si el test falla a media asignación, el permiso no se queda puesto para el resto
    // de la suite: el resto de specs de registro asumen la ventana de 7 días.
    await adminCtx.close()
  }
})

test('los meses se traducen a días y el diálogo enseña la fecha resultante', async ({ browser }) => {
  const adminCtx = await browser.newContext({ storageState: ADMIN_STATE })
  const adminPage = await adminCtx.newPage()

  try {
    await abrirDialogo(adminPage)
    await adminPage.getByLabel('Cantidad').fill('3')
    await adminPage.getByLabel('Unidad').selectOption('meses')

    // 3 meses son los días que de verdad tienen esos meses, no 90 fijos.
    const dias = Math.round((Date.now() - new Date(new Date().setMonth(new Date().getMonth() - 3)).getTime()) / 86_400_000)
    const esperada = fechaHaceDias(dias).split('-').reverse().join('/')
    await expect(adminPage.getByText(esperada)).toBeVisible()
  } finally {
    await adminCtx.close()
  }
})

test('el tope de 10 años se avisa antes de guardar', async ({ browser }) => {
  const adminCtx = await browser.newContext({ storageState: ADMIN_STATE })
  const adminPage = await adminCtx.newPage()

  try {
    await abrirDialogo(adminPage)
    await adminPage.getByLabel('Cantidad').fill('5000')
    await expect(adminPage.getByText(/el máximo es 3650/i)).toBeVisible()
    await expect(adminPage.getByRole('button', { name: 'Dar permiso' })).toBeDisabled()
  } finally {
    await adminCtx.close()
  }
})
