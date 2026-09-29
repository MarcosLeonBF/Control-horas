import { test, expect } from '@playwright/test'
import { validarEnvio, planificar, type PerfilIdentificable, type AusenciaActual } from '../lib/avisos/vacaciones'

// Las ausencias (vacaciones, festivos…) llegan del flujo de Julián como pulsos por persona:
// `activar` el día que empieza y `desactivar` el día que termina. Lo que cuenta es el
// slack_id y la acción; las fechas de `eventos` son un extra que se guarda de referencia.

const estefania = { slack_id: 'U096AGWQJN4', accion: 'activar', eventos: [{ inicio: '2026-09-29', fin: '2026-10-02', tipo: 'ausencia' }] }
const santiago = { slack_id: 'U0A85K6107L', accion: 'activar' }

const errorDe = (body: unknown): string => {
  const r = validarEnvio(body)
  if (r.ok) throw new Error('se esperaba un error y el envío pasó')
  return r.error
}

// --- validarEnvio ---------------------------------------------------------

test('validarEnvio: una lista de personas, con slack_id normalizado', () => {
  expect(validarEnvio([{ ...estefania, slack_id: ' u096agwqjn4 ' }, santiago])).toEqual({
    ok: true,
    valor: [
      { slack_id: 'U096AGWQJN4', accion: 'activar', eventos: estefania.eventos },
      { slack_id: 'U0A85K6107L', accion: 'activar', eventos: [] },
    ],
  })
})

test('validarEnvio: una persona suelta, sin lista, también vale', () => {
  const r = validarEnvio({ slack_id: 'U096AGWQJN4', accion: 'desactivar' })
  expect(r.ok && r.valor).toEqual([{ slack_id: 'U096AGWQJN4', accion: 'desactivar', eventos: [] }])
})

test('validarEnvio: una lista vacía no trae a nadie', () => {
  expect(errorDe([])).toMatch(/ninguna persona/)
})

test('validarEnvio: slack_id obligatorio y de miembro, con la posición y lo que llegó', () => {
  expect(errorDe([estefania, { accion: 'activar' }])).toMatch(/^Persona 2: .*slack_id.*Campos recibidos: accion \(texto\)\.$/)
  expect(errorDe([{ slack_id: '@estefania', accion: 'activar' }])).toMatch(/^Persona 1: .*slack_id/)
})

test('validarEnvio: accion solo "activar" o "desactivar", tal cual', () => {
  expect(errorDe([{ ...santiago, accion: 'Activar' }])).toMatch(/Persona 1 \(U0A85K6107L\): .*accion/)
  expect(errorDe([{ ...santiago, accion: undefined }])).toMatch(/accion/)
})

test('validarEnvio: eventos es opcional; si viene, es una lista', () => {
  expect(errorDe([{ ...santiago, eventos: { inicio: '2026-10-02' } }])).toMatch(/eventos/)
  expect(validarEnvio([{ ...santiago, eventos: null }]).ok).toBe(true)
})

test('validarEnvio: lo que no es una persona se rechaza con su posición', () => {
  expect(errorDe([estefania, 'U0A85K6107L'])).toMatch(/^Persona 2: .*objeto/)
  expect(errorDe('U0A85K6107L')).toMatch(/lista de personas.*llegó: texto/)
})

test('validarEnvio: como mucho 500 personas por envío', () => {
  expect(errorDe(Array.from({ length: 501 }, () => santiago))).toMatch(/500/)
})

// --- planificar -----------------------------------------------------------

const HOY = '2026-09-29'
const perfiles: PerfilIdentificable[] = [{ id: 'p-estefania', nombre: 'Estefanía García', slack_id: 'U096AGWQJN4' }]
const pulso = (accion: 'activar' | 'desactivar', slack_id = 'U096AGWQJN4', eventos: unknown[] = []) => ({ slack_id, accion, eventos })

test('planificar: activar abre una ausencia desde hoy', () => {
  const p = planificar([pulso('activar', 'U096AGWQJN4', estefania.eventos)], perfiles, [], HOY)
  expect(p.operaciones).toEqual([{ op: 'abrir', slack_id: 'U096AGWQJN4', desde: HOY, eventos: estefania.eventos }])
  expect(p.respuesta).toEqual({
    ok: true,
    personas: [{ slack_id: 'U096AGWQJN4', accion: 'activar', persona: { id: 'p-estefania', nombre: 'Estefanía García' }, resultado: 'iniciada' }],
  })
})

test('planificar: un activar repetido no abre otra ausencia', () => {
  const abierta: AusenciaActual = { id: 7, slack_id: 'U096AGWQJN4', desde: '2026-09-28', hasta: null }
  const p = planificar([pulso('activar')], perfiles, [abierta], HOY)
  expect(p.operaciones).toEqual([])
  expect(p.respuesta.personas[0].resultado).toBe('ya_iniciada')
})

test('planificar: desactivar cierra la ausencia abierta hoy (hoy todavía cuenta)', () => {
  const abierta: AusenciaActual = { id: 7, slack_id: 'U096AGWQJN4', desde: '2026-09-25', hasta: null }
  const p = planificar([pulso('desactivar')], perfiles, [abierta], HOY)
  expect(p.operaciones).toEqual([{ op: 'cerrar', id: 7, hasta: HOY }])
  expect(p.respuesta.personas[0].resultado).toBe('terminada')
})

test('planificar: un desactivar repetido el mismo día no hace nada', () => {
  const cerradaHoy: AusenciaActual = { id: 7, slack_id: 'U096AGWQJN4', desde: '2026-09-25', hasta: HOY }
  const p = planificar([pulso('desactivar')], perfiles, [cerradaHoy], HOY)
  expect(p.operaciones).toEqual([])
  expect(p.respuesta.personas[0].resultado).toBe('ya_terminada')
})

test('planificar: sin su activar, el desactivar la guarda con la fecha de inicio de eventos', () => {
  const ev = [{ inicio: '2026-09-24', fin: '2026-09-29', tipo: 'vacaciones' }, { inicio: 'mal', fin: '2026-09-29' }]
  const p = planificar([pulso('desactivar', 'U096AGWQJN4', ev)], perfiles, [], HOY)
  expect(p.operaciones).toEqual([{ op: 'cerrada', slack_id: 'U096AGWQJN4', desde: '2026-09-24', hasta: HOY, eventos: ev }])
  expect(p.respuesta.personas[0].resultado).toBe('terminada')
})

test('planificar: sin activar ni fechas útiles, el desactivar no tiene nada que cerrar', () => {
  // Una fecha futura no sirve de inicio: no se inventa una ausencia que no ha empezado.
  const p = planificar([pulso('desactivar', 'U096AGWQJN4', [{ inicio: '2026-10-09', fin: '2026-10-09' }])], perfiles, [], HOY)
  expect(p.operaciones).toEqual([])
  expect(p.respuesta.personas[0].resultado).toBe('sin_ausencia')
})

test('planificar: la fecha de inicio de eventos no va más de 90 días atrás', () => {
  const p = planificar([pulso('desactivar', 'U096AGWQJN4', [{ inicio: '2025-01-01', fin: HOY }])], perfiles, [], HOY)
  expect(p.operaciones).toEqual([{ op: 'cerrada', slack_id: 'U096AGWQJN4', desde: '2026-07-01', hasta: HOY, eventos: [{ inicio: '2025-01-01', fin: HOY }] }])
})

test('planificar: activar y desactivar de la misma persona en un envío, en orden', () => {
  const p = planificar([pulso('activar'), pulso('desactivar')], perfiles, [], HOY)
  // La que se abre en este mismo envío se guarda ya cerrada: una ausencia de un día.
  expect(p.operaciones).toEqual([{ op: 'cerrada', slack_id: 'U096AGWQJN4', desde: HOY, hasta: HOY, eventos: [] }])
  expect(p.respuesta.personas.map((x) => x.resultado)).toEqual(['iniciada', 'terminada'])
})

test('planificar: sin usuario en la plataforma se guarda igual, con persona null', () => {
  const p = planificar([pulso('activar', 'U0A85K6107L')], perfiles, [], HOY)
  expect(p.operaciones).toHaveLength(1)
  expect(p.respuesta.personas[0]).toEqual({ slack_id: 'U0A85K6107L', accion: 'activar', persona: null, resultado: 'iniciada' })
})

test('planificar: el resumen para Recibidos nombra a cada persona y lo que pasó', () => {
  const p = planificar([pulso('activar'), pulso('activar', 'U0A85K6107L')], perfiles, [], HOY)
  expect(p.resumen).toBe('Estefanía García: iniciada · U0A85K6107L (sin usuario): iniciada')
})
