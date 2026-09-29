import { test, expect } from '@playwright/test'
import { validarEnvio, planificar, type PerfilIdentificable, type AusenciaActual, type EventoRef } from '../lib/avisos/vacaciones'

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
const pulso = (accion: 'activar' | 'desactivar', slack_id = 'U096AGWQJN4', eventos: EventoRef[] = []) => ({ slack_id, accion, eventos })

test('planificar: activar abre una ausencia desde hoy', () => {
  const p = planificar([pulso('activar', 'U096AGWQJN4', estefania.eventos)], perfiles, [], HOY)
  expect(p.operaciones).toEqual([{ op: 'abrir', slack_id: 'U096AGWQJN4', desde: HOY, eventos: estefania.eventos }])
  expect(p.respuesta).toEqual({
    ok: true,
    personas: [{ slack_id: 'U096AGWQJN4', accion: 'activar', persona: { id: 'p-estefania', nombre: 'Estefanía García' }, resultado: 'iniciada' }],
  })
})

test('planificar: un activar repetido no abre otra ausencia', () => {
  const abierta: AusenciaActual = { id: 7, slack_id: 'U096AGWQJN4', desde: '2026-09-28', hasta: null, eventos: [] }
  const p = planificar([pulso('activar')], perfiles, [abierta], HOY)
  expect(p.operaciones).toEqual([])
  expect(p.respuesta.personas[0].resultado).toBe('ya_iniciada')
})

test('planificar: desactivar cierra la ausencia abierta hoy (hoy todavía cuenta)', () => {
  const abierta: AusenciaActual = { id: 7, slack_id: 'U096AGWQJN4', desde: '2026-09-25', hasta: null, eventos: [] }
  const p = planificar([pulso('desactivar')], perfiles, [abierta], HOY)
  expect(p.operaciones).toEqual([{ op: 'cerrar', id: 7, hasta: HOY }])
  expect(p.respuesta.personas[0].resultado).toBe('terminada')
})

test('planificar: un desactivar repetido el mismo día no hace nada', () => {
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

// --- casos de la revisión: reintentos, orden y pulsos perdidos ---------------

const cerradaHoy: AusenciaActual = { id: 7, slack_id: 'U096AGWQJN4', desde: '2026-09-25', hasta: HOY, eventos: [] }

test('planificar: un activar reintentado después del desactivar de hoy no reabre nada', () => {
  const p = planificar([pulso('activar', 'U096AGWQJN4', [{ inicio: '2026-09-25', fin: HOY }])], perfiles, [cerradaHoy], HOY)
  expect(p.operaciones).toEqual([])
  expect(p.respuesta.personas[0].resultado).toBe('ya_terminada')
})

test('planificar: tras cerrar hoy, un activar cuyo evento sigue mañana sí abre otra ausencia', () => {
  const p = planificar([pulso('activar', 'U096AGWQJN4', [{ inicio: HOY, fin: '2026-10-05', tipo: 'vacaciones' }])], perfiles, [cerradaHoy], HOY)
  expect(p.operaciones).toEqual([{ op: 'abrir', slack_id: 'U096AGWQJN4', desde: HOY, eventos: [{ inicio: HOY, fin: '2026-10-05', tipo: 'vacaciones' }] }])
  expect(p.respuesta.personas[0].resultado).toBe('iniciada')
})

test('planificar: desactivar y activar al revés en el mismo envío = ausencia de un día', () => {
  const p = planificar([pulso('desactivar'), pulso('activar')], perfiles, [], HOY)
  expect(p.operaciones).toEqual([{ op: 'cerrada', slack_id: 'U096AGWQJN4', desde: HOY, hasta: HOY, eventos: [] }])
  expect(p.respuesta.personas.map((x) => x.resultado)).toEqual(['sin_ausencia', 'iniciada'])
})

test('planificar: reenviar [activar, desactivar] ya aplicado no crea otra fila', () => {
  const p = planificar([pulso('activar'), pulso('desactivar')], perfiles, [cerradaHoy], HOY)
  expect(p.operaciones).toEqual([])
  expect(p.respuesta.personas.map((x) => x.resultado)).toEqual(['ya_terminada', 'ya_terminada'])
})

test('planificar: sin su activar, solo cuentan los eventos que siguen en curso hoy', () => {
  // Un evento viejo (agosto) no puede convertir en ausencia todo lo que hay en medio.
  const ev = [{ inicio: '2026-08-01', fin: '2026-08-05' }, { inicio: '2026-09-28', fin: HOY }]
  const p = planificar([pulso('desactivar', 'U096AGWQJN4', ev)], perfiles, [], HOY)
  expect(p.operaciones).toEqual([{ op: 'cerrada', slack_id: 'U096AGWQJN4', desde: '2026-09-28', hasta: HOY, eventos: ev }])
})

test('planificar: un desactivar reintentado al día siguiente no crea otra ausencia', () => {
  const p = planificar([pulso('desactivar', 'U096AGWQJN4', [{ inicio: '2026-09-24', fin: '2026-09-28' }])], perfiles, [], HOY)
  expect(p.operaciones).toEqual([])
  expect(p.respuesta.personas[0].resultado).toBe('sin_ausencia')
})

test('planificar: un activar que llega tarde empieza en el inicio de su evento en curso', () => {
  const p = planificar([pulso('activar', 'U096AGWQJN4', [{ inicio: '2026-09-28', fin: '2026-10-02' }])], perfiles, [], HOY)
  expect(p.operaciones).toEqual([{ op: 'abrir', slack_id: 'U096AGWQJN4', desde: '2026-09-28', eventos: [{ inicio: '2026-09-28', fin: '2026-10-02' }] }])
})

test('planificar: si se perdió el desactivar, el siguiente activar cierra la vieja en su fin', () => {
  const vieja: AusenciaActual = { id: 3, slack_id: 'U096AGWQJN4', desde: '2026-08-03', hasta: null, eventos: [{ inicio: '2026-08-03', fin: '2026-08-14' }] }
  const p = planificar([pulso('activar')], perfiles, [vieja], HOY)
  expect(p.operaciones).toEqual([
    { op: 'cerrar', id: 3, hasta: '2026-08-14' },
    { op: 'abrir', slack_id: 'U096AGWQJN4', desde: HOY, eventos: [] },
  ])
  expect(p.respuesta.personas[0].resultado).toBe('iniciada')
})

test('validarEnvio: de cada evento solo se guarda inicio, fin y tipo, en texto y limpio', () => {
  const r = validarEnvio([{ ...santiago, eventos: [{ inicio: ' 2026-10-02 ', fin: '2026-10-02', tipo: 'ausencia', nota: 'x', id: 9 }, { tipo: 'fes\u0000tivo' }, 42] }])
  expect(r.ok && r.valor[0].eventos).toEqual([{ inicio: '2026-10-02', fin: '2026-10-02', tipo: 'ausencia' }, { tipo: 'festivo' }])
})

test('validarEnvio: un slack_id que no es texto lo dice', () => {
  expect(errorDe([{ slack_id: 12345, accion: 'activar' }])).toMatch(/slack_id tiene que ser texto/)
})

test('validarEnvio: acepta los nombres de campo tal como vienen de Airtable', () => {
  // Lo que manda el flujo de Julián: los nombres de las columnas de Airtable.
  expect(validarEnvio({ Accion: 'activar', 'Slack ID': 'U0A85K6107L' })).toEqual({
    ok: true, valor: [{ slack_id: 'U0A85K6107L', accion: 'activar', eventos: [] }],
  })
  const r = validarEnvio([{ 'Acción': 'desactivar', 'slack-id': 'U096AGWQJN4', Eventos: [{ inicio: '2026-09-29', fin: '2026-09-29' }] }])
  expect(r.ok && r.valor).toEqual([{ slack_id: 'U096AGWQJN4', accion: 'desactivar', eventos: [{ inicio: '2026-09-29', fin: '2026-09-29' }] }])
})
