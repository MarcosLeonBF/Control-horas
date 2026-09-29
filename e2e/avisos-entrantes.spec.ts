import { test, expect } from '@playwright/test'
import { describirCampos, anotacionEntrante, recibidosParaVer } from '../lib/avisos/entrantes'

// Lo que llega de los flujos (por ahora, ausencias) se anota entero, aceptado o no, para
// verlo en Administración → Avisos. Sin esto, un envío rechazado solo lo veía Julián en su
// n8n: el primero que mandó (un 400) no dejó rastro de nuestro lado.

test('describirCampos: nombre y tipo de cada campo del primer nivel, sin valores', () => {
  expect(describirCampos({ id: 12, fields: { Nombre: 'Maria' }, slack_id: 'U09L2RSD2S1', activo: true, nota: null, dias: [] }))
    .toBe('id (número), fields (objeto), slack_id (texto), activo (sí/no), nota (vacío), dias (lista)')
  expect(describirCampos({})).toBe('ninguno')
})

test('describirCampos: con muchos campos lista 30 y dice cuántos faltan', () => {
  const muchos = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`c${i}`, i]))
  const d = describirCampos(muchos)
  expect(d.startsWith('c0 (número), c1 (número)')).toBe(true)
  expect(d).toMatch(/c29 \(número\) y 15 más$/)
  expect(d).not.toMatch(/c30/)
})

const cuerpo = [{ slack_id: 'U096AGWQJN4', accion: 'activar', eventos: [{ inicio: '2026-09-29', fin: '2026-10-02', tipo: 'ausencia' }] }]

test('anotacionEntrante: un envío aceptado guarda el resumen y lo que llegó', () => {
  expect(anotacionEntrante('vacaciones', { status: 200, resumen: 'Estefanía García: iniciada', cuerpo })).toEqual({
    tipo: 'vacaciones', status: 200, error: null, resumen: 'Estefanía García: iniciada', cuerpo, cuerpo_texto: null,
  })
})

test('anotacionEntrante: un rechazo guarda el motivo', () => {
  const r = anotacionEntrante('vacaciones', { status: 400, error: 'Persona 1: falta el slack_id.', cuerpo })
  expect(r).toMatchObject({ status: 400, error: 'Persona 1: falta el slack_id.', resumen: null })
  expect(r.cuerpo).toEqual(cuerpo)
})

test('anotacionEntrante: un 500 guarda el detalle interno, no el mensaje público', () => {
  const r = anotacionEntrante('vacaciones', { status: 500, error: 'Error interno', interno: 'Error interno: profiles: timeout', cuerpo })
  expect(r.error).toBe('Error interno: profiles: timeout')
})

test('anotacionEntrante: el motivo y el resumen se recortan a 1000 caracteres', () => {
  const r = anotacionEntrante('vacaciones', { status: 400, error: 'x'.repeat(5000), resumen: 'y'.repeat(5000), cuerpo })
  expect(r.error).toHaveLength(1000)
  expect(r.resumen).toHaveLength(1000)
})

test('anotacionEntrante: si no era JSON, guarda el texto recibido, recortado', () => {
  const r = anotacionEntrante('vacaciones', { status: 400, error: 'El cuerpo no es un JSON válido.', crudo: 'slack_id=U0&' + 'x'.repeat(5000) })
  expect(r.cuerpo).toBe(null)
  expect(r.cuerpo_texto).toHaveLength(2000)
  expect(r.cuerpo_texto!.startsWith('slack_id=U0&')).toBe(true)
})

test('anotacionEntrante: un cuerpo enorme no se guarda entero', () => {
  const grande = [{ ...cuerpo[0], relleno: 'x'.repeat(30_000) }]
  const r = anotacionEntrante('vacaciones', { status: 400, error: 'x', cuerpo: grande })
  expect(r.cuerpo).toBe(null)
  expect(r.cuerpo_texto).toMatch(/^Cuerpo de \d+ caracteres, recortado: /)
  expect(r.cuerpo_texto!.length).toBeLessThanOrEqual(2100)
})

const fila = (id: number, status: number, minuto: number) =>
  ({ id, status, created_at: `2026-09-29T10:${String(minuto).padStart(2, '0')}:00Z` })

test('recibidosParaVer: los últimos, más los rechazos que quedarían fuera, sin repetir', () => {
  const ultimos = [fila(9, 200, 59), fila(8, 200, 58)]
  const rechazos = [fila(8, 200, 58), fila(3, 400, 10), fila(1, 422, 5)] // el 8 no debería venir, pero no se repite
  expect(recibidosParaVer(ultimos, rechazos).map((r) => r.id)).toEqual([9, 8, 3, 1])
})
