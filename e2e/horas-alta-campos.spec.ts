import { test, expect } from '@playwright/test'
import { errorCamposAlta } from '../lib/horas/alta-usuario'

const completo = { full_name: 'Laura Gómez', email: 'laura@ejemplo.com', password: 'Passw0rd-1', slackId: 'U01ABCD2EFG' }

test('errorCamposAlta: con todo, sin error', () => {
  expect(errorCamposAlta(completo)).toBeNull()
})

test('errorCamposAlta: nombre, correo y contraseña de al menos 8', () => {
  expect(errorCamposAlta({ ...completo, full_name: '  ' })).toMatch(/obligatorios/)
  expect(errorCamposAlta({ ...completo, email: '' })).toMatch(/obligatorios/)
  expect(errorCamposAlta({ ...completo, password: '1234567' })).toMatch(/obligatorios/)
})

test('errorCamposAlta: el ID de Slack es obligatorio en el alta', () => {
  // Sin él, los avisos no pueden mencionar a la persona ni escribirle por mensaje directo.
  expect(errorCamposAlta({ ...completo, slackId: '' })).toMatch(/ID de Slack es obligatorio/)
  expect(errorCamposAlta({ ...completo, slackId: '   ' })).toMatch(/ID de Slack es obligatorio/)
})
