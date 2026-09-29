import { test, expect } from '@playwright/test'
import { describirCampos, anotacionEntrante, recibidosParaVer } from '../lib/avisos/entrantes'
import { validarVacacion } from '../lib/avisos/vacaciones'

// Lo que llega de los flujos (por ahora, vacaciones) se anota entero, aceptado o no, para
// verlo en Administración → Avisos. Sin esto, un envío rechazado solo lo veía Julián en su
// n8n: el primero que mandó (un 400 por el id) no dejó rastro de nuestro lado.

test('describirCampos: nombre y tipo de cada campo del primer nivel, sin valores', () => {
  expect(describirCampos({ id: 12, fields: { Nombre: 'Maria' }, slack_id: 'U09L2RSD2S1', activo: true, nota: null, dias: [] }))
    .toBe('id (número), fields (objeto), slack_id (texto), activo (sí/no), nota (vacío), dias (lista)')
  expect(describirCampos({})).toBe('ninguno')
})

test('validarVacacion: el error dice qué campos llegaron', () => {
  const r = validarVacacion({ fields: { id: 'recA1b2C3d4E5f6G7' }, createdTime: '2026-09-28T19:40:00.000Z' })
  expect(r.ok).toBe(false)
  expect(!r.ok && r.error).toMatch(/Falta el id/)
  expect(!r.ok && r.error).toMatch(/Campos recibidos: fields \(objeto\), createdTime \(texto\)\.$/)
})

test('validarVacacion: si no llega un objeto, dice qué llegó', () => {
  const r = validarVacacion([{ id: 'recA1b2C3d4E5f6G7' }]) // n8n a veces manda una lista
  expect(!r.ok && r.error).toMatch(/objeto JSON.*llegó: lista/)
})

const cuerpo = {
  id: 'recA1b2C3d4E5f6G7', slack_id: 'U09L2RSD2S1', email: 'maria.ruiz@bastidafarina.com',
  desde: '2026-10-13', hasta: '2026-10-17', estado: 'aprobada',
}

test('anotacionEntrante: un envío aceptado guarda la fila, la persona y lo que llegó', () => {
  expect(anotacionEntrante('vacaciones', {
    status: 200, cuerpo,
    respuesta: { ok: true, id: 'recA1b2C3d4E5f6G7', persona: { id: 'p-maria', nombre: 'Maria Ruiz' } },
  })).toEqual({
    tipo: 'vacaciones', status: 200, error: null, airtable_id: 'recA1b2C3d4E5f6G7',
    persona_id: 'p-maria', persona_nombre: 'Maria Ruiz', cuerpo, cuerpo_texto: null,
  })
})

test('anotacionEntrante: un rechazo guarda el motivo y el id que traiga, aunque sea un número', () => {
  const r = anotacionEntrante('vacaciones', {
    status: 400, cuerpo: { ...cuerpo, id: 17 }, respuesta: { ok: false, error: 'Falta el id…' },
  })
  expect(r).toMatchObject({ status: 400, error: 'Falta el id…', airtable_id: '17', persona_id: null, persona_nombre: null })
  expect(r.cuerpo).toEqual({ ...cuerpo, id: 17 })
})

test('anotacionEntrante: si no era JSON, guarda el texto recibido, recortado', () => {
  const r = anotacionEntrante('vacaciones', {
    status: 400, crudo: 'id=recA1b2&' + 'x'.repeat(5000), respuesta: { ok: false, error: 'El cuerpo no es un JSON válido.' },
  })
  expect(r.cuerpo).toBe(null)
  expect(r.airtable_id).toBe(null)
  expect(r.cuerpo_texto).toHaveLength(2000)
  expect(r.cuerpo_texto!.startsWith('id=recA1b2&')).toBe(true)
})

test('anotacionEntrante: un cuerpo enorme no se guarda entero', () => {
  const grande = { ...cuerpo, relleno: 'x'.repeat(30_000) }
  const r = anotacionEntrante('vacaciones', { status: 400, cuerpo: grande, respuesta: { ok: false, error: 'x' } })
  expect(r.cuerpo).toBe(null)
  expect(r.cuerpo_texto).toMatch(/^Cuerpo de \d+ caracteres, recortado: /)
  expect(r.cuerpo_texto!.length).toBeLessThanOrEqual(2100)
  expect(r.airtable_id).toBe('recA1b2C3d4E5f6G7') // el id se saca igual
})

test('describirCampos: con muchos campos lista 30 y dice cuántos faltan', () => {
  const muchos = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`c${i}`, i]))
  const d = describirCampos(muchos)
  expect(d.startsWith('c0 (número), c1 (número)')).toBe(true)
  expect(d).toMatch(/c29 \(número\) y 15 más$/)
  expect(d).not.toMatch(/c30/)
})

test('anotacionEntrante: un 500 guarda el detalle interno, no el mensaje público', () => {
  const r = anotacionEntrante('vacaciones', {
    status: 500, cuerpo, respuesta: { ok: false, error: 'Error interno' }, interno: 'Error interno: profiles: timeout',
  })
  expect(r.error).toBe('Error interno: profiles: timeout')
})

test('anotacionEntrante: el motivo se recorta a 1000 caracteres', () => {
  const r = anotacionEntrante('vacaciones', { status: 400, cuerpo, respuesta: { ok: false, error: 'x'.repeat(5000) } })
  expect(r.error).toHaveLength(1000)
})

const fila = (id: number, status: number, minuto: number) =>
  ({ id, status, created_at: `2026-09-29T10:${String(minuto).padStart(2, '0')}:00Z` })

test('recibidosParaVer: los últimos, más los rechazos que quedarían fuera, sin repetir', () => {
  const ultimos = [fila(9, 200, 59), fila(8, 200, 58)]
  const rechazos = [fila(8, 200, 58), fila(3, 400, 10), fila(1, 422, 5)] // el 8 no debería venir, pero no se repite
  expect(recibidosParaVer(ultimos, rechazos).map((r) => r.id)).toEqual([9, 8, 3, 1])
})
