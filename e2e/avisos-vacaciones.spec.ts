import { test, expect } from '@playwright/test'
import { validarVacacion, resolverPersona, procesarEnvio, type PerfilIdentificable } from '../lib/avisos/vacaciones'

// Las vacaciones llegan desde Airtable (flujo de Julián), una fila por envío. Lo que se
// valida aquí es lo que decide si una persona deja de recibir recordatorios: un fallo
// silencioso (una fecha absurda, un estado mal escrito, la persona equivocada) no lo vería
// nadie hasta que alguien se quejara.

const fila = (cambios: Record<string, unknown> = {}) => ({
  id: 'recA1b2C3d4E5f6G7',
  slack_id: 'U09L2RSD2S1',
  email: 'maria.ruiz@bastidafarina.com',
  desde: '2026-10-13',
  hasta: '2026-10-17',
  estado: 'aprobada',
  ...cambios,
})

const errorDe = (body: unknown): string => {
  const r = validarVacacion(body)
  if (r.ok) throw new Error('se esperaba un error y la fila pasó')
  return r.error
}

// --- validarVacacion ------------------------------------------------------

test('validarVacacion: acepta una fila completa y normaliza slack_id y email', () => {
  expect(validarVacacion(fila({ slack_id: ' u09l2rsd2s1 ', email: ' Maria.Ruiz@BastidaFarina.com ' }))).toEqual({
    ok: true,
    valor: {
      id: 'recA1b2C3d4E5f6G7', slack_id: 'U09L2RSD2S1', email: 'maria.ruiz@bastidafarina.com',
      desde: '2026-10-13', hasta: '2026-10-17', estado: 'aprobada',
    },
  })
})

test('validarVacacion: basta con slack_id o con email', () => {
  const soloSlack = validarVacacion(fila({ email: undefined }))
  expect(soloSlack.ok && soloSlack.valor.email).toBe(null)
  const soloEmail = validarVacacion(fila({ slack_id: null }))
  expect(soloEmail.ok && soloEmail.valor.slack_id).toBe(null)
  // Vacío cuenta como que no viene (es lo que manda Airtable con el campo en blanco).
  const slackVacio = validarVacacion(fila({ slack_id: '' }))
  expect(slackVacio.ok && slackVacio.valor.slack_id).toBe(null)
})

test('validarVacacion: sin slack_id ni email no se sabe de quién es', () => {
  expect(errorDe(fila({ slack_id: null, email: '' }))).toMatch(/slack_id.*email/)
})

test('validarVacacion: el id de Airtable es obligatorio', () => {
  expect(errorDe(fila({ id: undefined }))).toMatch(/id/)
  expect(errorDe(fila({ id: '   ' }))).toMatch(/id/)
  expect(errorDe(fila({ id: 123 }))).toMatch(/id/)
  expect(errorDe(fila({ id: 'x'.repeat(201) }))).toMatch(/id/)
})

test('validarVacacion: rechaza un slack_id que no es un ID de miembro', () => {
  expect(errorDe(fila({ slack_id: '@maria.ruiz' }))).toMatch(/slack_id/)
  expect(errorDe(fila({ slack_id: 'C01ABCD2EFG' }))).toMatch(/slack_id/) // un canal
  expect(errorDe(fila({ slack_id: 42 }))).toMatch(/slack_id/)
})

test('validarVacacion: rechaza un email mal formado', () => {
  expect(errorDe(fila({ email: 'maria.ruiz' }))).toMatch(/email/)
  expect(errorDe(fila({ email: 'maria ruiz@bastidafarina.com' }))).toMatch(/email/)
  expect(errorDe(fila({ email: 42 }))).toMatch(/email/)
})

test('validarVacacion: las fechas son YYYY-MM-DD y existen', () => {
  expect(errorDe(fila({ desde: '13/10/2026' }))).toMatch(/desde/)
  expect(errorDe(fila({ hasta: '2026-10-1' }))).toMatch(/hasta/)
  expect(errorDe(fila({ desde: '2026-02-30', hasta: '2026-03-02' }))).toMatch(/desde/)
  expect(errorDe(fila({ hasta: undefined }))).toMatch(/hasta/)
})

test('validarVacacion: hasta no puede ser anterior a desde; un solo día vale', () => {
  expect(errorDe(fila({ desde: '2026-10-17', hasta: '2026-10-13' }))).toMatch(/hasta.*desde/)
  expect(validarVacacion(fila({ desde: '2026-10-13', hasta: '2026-10-13' })).ok).toBe(true)
})

test('validarVacacion: como mucho 90 días por periodo, los dos extremos incluidos', () => {
  // Una errata tipo 2062 dejaría a alguien sin recordatorios durante años.
  expect(validarVacacion(fila({ desde: '2026-10-01', hasta: '2026-12-29' })).ok).toBe(true) // 90 días
  expect(errorDe(fila({ desde: '2026-10-01', hasta: '2026-12-30' }))).toMatch(/90/) // 91 días
  expect(errorDe(fila({ desde: '2026-10-13', hasta: '2062-10-17' }))).toMatch(/90/)
})

test('validarVacacion: estado solo "aprobada" o "cancelada", tal cual', () => {
  expect(validarVacacion(fila({ estado: 'cancelada' })).ok).toBe(true)
  // Estricto a propósito: aceptar "Aprobado" como "no cuenta" apagaría las vacaciones sin
  // que nadie se enterara.
  expect(errorDe(fila({ estado: 'Aprobado' }))).toMatch(/estado/)
  expect(errorDe(fila({ estado: 'Aprobada' }))).toMatch(/estado/)
  expect(errorDe(fila({ estado: 'pendiente' }))).toMatch(/estado/)
  expect(errorDe(fila({ estado: undefined }))).toMatch(/estado/)
})

test('validarVacacion: el cuerpo tiene que ser un objeto JSON', () => {
  expect(errorDe(null)).toMatch(/objeto/)
  expect(errorDe([fila()])).toMatch(/objeto/)
  expect(errorDe('recA1b2C3d4E5f6G7')).toMatch(/objeto/)
})

test('validarVacacion: casos límite', () => {
  const w = validarVacacion(fila({ slack_id: 'W0123ABCDEF' })) // Enterprise Grid
  expect(w.ok && w.valor.slack_id).toBe('W0123ABCDEF')
  expect(validarVacacion(fila({ desde: '2028-02-29', hasta: '2028-03-01' })).ok).toBe(true) // bisiesto
  expect(errorDe(fila({ desde: '2026-02-29', hasta: '2026-03-01' }))).toMatch(/desde/)
  const emailBlanco = validarVacacion(fila({ email: '   ' })) // en blanco = no viene
  expect(emailBlanco.ok && emailBlanco.valor.email).toBe(null)
  expect(errorDe(fila({ estado: 'aprobada ' }))).toMatch(/estado/)
})

// --- resolverPersona ------------------------------------------------------

const maria: PerfilIdentificable = { id: 'p-maria', nombre: 'Maria Ruiz', email: 'maria.ruiz@bastidafarina.com', slack_id: 'U09L2RSD2S1' }
const anna: PerfilIdentificable = { id: 'p-anna', nombre: 'Anna Paula Reboredo', email: 'Anna.paula@bastidafarina.com', slack_id: 'U0APJJT2811' }
const tania: PerfilIdentificable = { id: 'p-tania', nombre: 'Tania Lunar', email: 'tanilunar4@gmail.com', slack_id: 'U09UBKWUER3' }
const sinSlack: PerfilIdentificable = { id: 'p-nuevo', nombre: 'Persona Nueva', email: 'nueva@bastidafarina.com', slack_id: null }
const perfiles = [maria, anna, tania, sinSlack]

test('resolverPersona: por slack_id', () => {
  expect(resolverPersona({ slack_id: 'U09L2RSD2S1', email: null }, perfiles)).toEqual({ tipo: 'encontrada', perfil: maria })
})

test('resolverPersona: por email, sin distinguir mayúsculas', () => {
  expect(resolverPersona({ slack_id: null, email: 'anna.paula@bastidafarina.com' }, perfiles)).toEqual({ tipo: 'encontrada', perfil: anna })
})

test('resolverPersona: manda el slack_id si el email no es de nadie', () => {
  // Tania tiene un Gmail en la plataforma; Airtable puede traer el de empresa.
  expect(resolverPersona({ slack_id: 'U09UBKWUER3', email: 'tania@bastidafarina.com' }, perfiles))
    .toEqual({ tipo: 'encontrada', perfil: tania })
})

test('resolverPersona: por email si esa persona aún no tiene slack_id cargado', () => {
  expect(resolverPersona({ slack_id: 'U0ZZZZZZZZ1', email: 'nueva@bastidafarina.com' }, perfiles))
    .toEqual({ tipo: 'encontrada', perfil: sinSlack })
})

test('resolverPersona: conflicto si slack_id y email son de personas distintas', () => {
  const r = resolverPersona({ slack_id: 'U09L2RSD2S1', email: 'anna.paula@bastidafarina.com' }, perfiles)
  expect(r.tipo).toBe('conflicto')
})

test('resolverPersona: conflicto si el email es de alguien con otro slack_id cargado', () => {
  // El slack_id que llega no es de nadie, pero el del email ya tiene uno y no coincide.
  const r = resolverPersona({ slack_id: 'U0ZZZZZZZZ1', email: 'maria.ruiz@bastidafarina.com' }, perfiles)
  expect(r.tipo).toBe('conflicto')
})

test('resolverPersona: conflicto si el email está en dos perfiles', () => {
  const doble = { ...sinSlack, id: 'p-doble', nombre: 'Otra Persona', email: 'NUEVA@bastidafarina.com' }
  expect(resolverPersona({ slack_id: null, email: 'nueva@bastidafarina.com' }, [...perfiles, doble]).tipo).toBe('conflicto')
})

test('resolverPersona: sin perfil en la plataforma', () => {
  expect(resolverPersona({ slack_id: 'U0ZZZZZZZZ1', email: 'externa@bastidafarina.com' }, perfiles)).toEqual({ tipo: 'no_encontrada' })
  expect(resolverPersona({ slack_id: null, email: 'externa@bastidafarina.com' }, perfiles)).toEqual({ tipo: 'no_encontrada' })
})

// --- procesarEnvio: lo que contesta la URL y lo que se guarda ---------------
// Recibe la fila ya validada: la ruta valida antes de leer los perfiles.

const valida = (cambios: Record<string, unknown> = {}) => {
  const r = validarVacacion(fila(cambios))
  if (!r.ok) throw new Error(r.error)
  return r.valor
}

test('procesarEnvio: 422 si slack_id y email son de personas distintas, y no se guarda', () => {
  const r = procesarEnvio(valida({ slack_id: 'U09L2RSD2S1', email: 'anna.paula@bastidafarina.com' }), perfiles)
  expect(r.status).toBe(422)
  expect('fila' in r).toBe(false)
  expect(r.respuesta).toEqual({ ok: false, error: expect.stringContaining('Anna Paula Reboredo') })
})

test('procesarEnvio: una cancelación con datos en conflicto se guarda igual', () => {
  // Una fila cancelada no le asigna vacaciones a nadie. Si se rechazara, seguiría en vigor
  // la versión aprobada que se guardó antes con esa misma fila.
  const r = procesarEnvio(valida({ slack_id: 'U09L2RSD2S1', email: 'anna.paula@bastidafarina.com', estado: 'cancelada' }), perfiles)
  expect(r.status).toBe(200)
  expect('fila' in r && r.fila.estado).toBe('cancelada')
  expect(r.respuesta).toEqual({ ok: true, id: 'recA1b2C3d4E5f6G7', persona: null, cuenta: false })
})

test('procesarEnvio: 200 con la persona encontrada y la fila a guardar', () => {
  const r = procesarEnvio(valida(), perfiles)
  expect(r).toEqual({
    status: 200,
    fila: {
      airtable_id: 'recA1b2C3d4E5f6G7', slack_id: 'U09L2RSD2S1', email: 'maria.ruiz@bastidafarina.com',
      desde: '2026-10-13', hasta: '2026-10-17', estado: 'aprobada',
    },
    respuesta: { ok: true, id: 'recA1b2C3d4E5f6G7', persona: { id: 'p-maria', nombre: 'Maria Ruiz' }, cuenta: true },
  })
})

test('procesarEnvio: sin perfil en la plataforma se guarda igual, con persona null', () => {
  const r = procesarEnvio(valida({ slack_id: 'U0ZZZZZZZZ1', email: 'externa@bastidafarina.com' }), perfiles)
  expect(r.status).toBe(200)
  expect('fila' in r && r.fila.email).toBe('externa@bastidafarina.com')
  expect(r.respuesta).toEqual({ ok: true, id: 'recA1b2C3d4E5f6G7', persona: null, cuenta: true })
})
