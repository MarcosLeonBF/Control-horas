import { test, expect } from '@playwright/test'

// Corre con storage state de e2e-rrhh@horas.test (rol operativo + can_create_users).
test('un usuario con permiso delegado ve la lista sin acciones y da de alta un operativo', async ({ page }) => {
  await page.goto('/admin/usuarios')

  // Ve la lista, pero en solo lectura: sin columna Acciones ni botones de edición.
  await expect(page.getByRole('columnheader', { name: 'Usuario' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Acciones' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Desactivar' })).toHaveCount(0)

  // El selector de rol del alta no ofrece admin.
  await expect(page.getByLabel('Rol').locator('option[value="admin"]')).toHaveCount(0)

  // Alta de un operativo (prefijo e2e-nuevo-: lo borra el cleanup del fixture).
  const email = `e2e-nuevo-deleg-${Date.now()}@horas.test`
  await page.getByLabel('Nombre').fill('Alta Delegada E2E')
  await page.getByLabel('Correo').fill(email)
  await page.getByLabel('Contraseña').fill('Deleg-Pass-123')
  await page.getByRole('button', { name: /crear usuario/i }).click()
  await expect(page.getByText(/usuario creado/i)).toBeVisible()

  // El nuevo usuario aparece en la lista tras recargar.
  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: email })).toBeVisible()
})

test('el usuario delegado no ve otras secciones de administración', async ({ page }) => {
  await page.goto('/admin/usuarios')
  await expect(page.getByRole('link', { name: 'Usuarios' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Catálogos' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Auditoría' })).toHaveCount(0)
})
