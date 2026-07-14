import { test, expect } from '@playwright/test'

// Crea un usuario y luego lo desactiva desde el panel (auto-limpiante: cleanup borra e2e-nuevo-*).
test('el admin crea, ve en el panel y desactiva un usuario', async ({ page }) => {
  const email = `e2e-nuevo-edit-${Date.now()}@horas.test`
  await page.goto('/admin/usuarios')

  // Alta
  await page.getByLabel('Nombre').fill('Editable E2E')
  await page.getByLabel('Correo').fill(email)
  await page.getByLabel('Contraseña').fill('E2e-Edit-Pass-123')
  await page.getByLabel('Posición').fill('Tester')
  await page.getByRole('button', { name: 'Crear usuario' }).click()
  await expect(page.getByText('Usuario creado')).toBeVisible()

  // Recargar para verlo en el panel
  await page.reload()
  const fila = page.getByRole('row').filter({ hasText: email })
  await expect(fila).toBeVisible()
  await expect(fila.getByText('activo', { exact: true })).toBeVisible()

  // Desactivar
  await fila.getByRole('button', { name: 'Desactivar' }).click()
  await expect(page.getByText('Usuario desactivado')).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: email }).getByText('inactivo', { exact: true })).toBeVisible()
})

// El admin concede el permiso de alta a un usuario nuevo y ve el badge en el panel.
test('el admin concede el permiso de alta de usuarios', async ({ page }) => {
  const email = `e2e-nuevo-flag-${Date.now()}@horas.test`
  await page.goto('/admin/usuarios')

  await page.getByLabel('Nombre').fill('Con Permiso E2E')
  await page.getByLabel('Correo').fill(email)
  await page.getByLabel('Contraseña').fill('E2e-Flag-Pass-123')
  await page.getByRole('button', { name: 'Crear usuario' }).click()
  await expect(page.getByText('Usuario creado')).toBeVisible()

  await page.reload()
  const fila = page.getByRole('row').filter({ hasText: email })
  await fila.getByRole('button', { name: 'Editar' }).click()
  await page.getByRole('checkbox', { name: /puede dar de alta usuarios/i }).check()
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByText('Usuario actualizado')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: email }).getByText('Alta de usuarios')).toBeVisible()
})
