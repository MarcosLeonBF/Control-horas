import { test, expect } from '@playwright/test'
import {
  validarEnvio, planificar, ausenciasPorPersona, ausenciasHoy, ausenciasSinUsuario, etiquetaAusencia,
  type PerfilIdentificable, type AusenciaActual, type EventoRef, type Operacion,
} from '../lib/avisos/vacaciones'

// Las ausencias (vacaciones, festivos…) llegan del flujo de Julián como pulsos por persona:
// `activar` el día que empieza y `desactivar` el día que termina, con sus fechas ("Fecha
// inicio", "Fecha fin"). Con fechas, cada pulso apunta a un periodo (persona + día de
// inicio) y da igual el orden, las repeticiones o que lleguen a la vez. Sin fechas, se
// interpreta por el pulso: activar abre desde hoy, desactivar cierra hoy.

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

test('validarEnvio: un slack_id que no es texto lo dice', () => {
  expect(errorDe([{ slack_id: 12345, accion: 'activar' }])).toMatch(/slack_id tiene que ser texto/)
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

test('validarEnvio: acepta los nombres de campo tal como vienen de Airtable', () => {
  expect(validarEnvio({ Accion: 'activar', 'Slack ID': 'U0A85K6107L' })).toEqual({
    ok: true, valor: [{ slack_id: 'U0A85K6107L', accion: 'activar', eventos: [] }],
  })
  const r = validarEnvio([{ 'Acción': 'desactivar', 'slack-id': 'U096AGWQJN4', Eventos: [{ inicio: '2026-09-29', fin: '2026-09-29' }] }])
  expect(r.ok && r.valor).toEqual([{ slack_id: 'U096AGWQJN4', accion: 'desactivar', eventos: [{ inicio: '2026-09-29', fin: '2026-09-29' }] }])
})

test('validarEnvio: las fechas sueltas de Airtable ("Fecha inicio", "Fecha fin") son el evento de ese pulso', () => {
  const r = validarEnvio({ Accion: 'activar', 'Slack ID': 'U096AGWQJN4', 'Fecha fin': '2026-10-02', 'Fecha inicio': '2026-09-29' })
  expect(r.ok && r.valor).toEqual([{ slack_id: 'U096AGWQJN4', accion: 'activar', eventos: [{ inicio: '2026-09-29', fin: '2026-10-02' }] }])
  // Vacías, como llegaron en una prueba: no hay evento.
  const vacias = validarEnvio({ Accion: 'activar', 'Slack ID': 'U096AGWQJN4', 'Fecha inicio': '', 'Fecha fin': '' })
  expect(vacias.ok && vacias.valor[0].eventos).toEqual([])
})

test('validarEnvio: fechas con hora: en UTC valen por su día en Madrid; sin zona, por su día', () => {
  // La medianoche de Madrid serializada en UTC es el día anterior a las 22:00.
  const r = validarEnvio({ Accion: 'activar', 'Slack ID': 'U096AGWQJN4', 'Fecha inicio': '2026-09-28T22:00:00.000Z', 'Fecha fin': '2026-10-02T00:00:00' })
  expect(r.ok && r.valor[0].eventos).toEqual([{ inicio: '2026-09-29', fin: '2026-10-02' }])
})

test('validarEnvio: las fechas sueltas se validan: formato, las dos, orden y como mucho un año', () => {
  // Son las que mandan: una fecha mal escrita tiene que fallar, no ignorarse.
  const base = { Accion: 'activar', 'Slack ID': 'U096AGWQJN4' }
  expect(errorDe({ ...base, 'Fecha inicio': '29/09/2026', 'Fecha fin': '2026-10-02' })).toMatch(/Fecha inicio.*YYYY-MM-DD/)
  expect(errorDe({ ...base, 'Fecha inicio': '2026-09-29' })).toMatch(/las dos/)
  expect(errorDe({ ...base, 'Fecha inicio': '2026-10-02', 'Fecha fin': '2026-09-29' })).toMatch(/fin.*anterior/)
  expect(errorDe({ ...base, 'Fecha inicio': '2026-09-29', 'Fecha fin': '2062-09-29' })).toMatch(/año/)
})

test('validarEnvio: de cada evento de la lista solo se guarda inicio, fin y tipo, en texto y limpio', () => {
  const r = validarEnvio([{ ...santiago, eventos: [{ inicio: ' 2026-10-02 ', fin: '2026-10-02', tipo: 'ausencia', nota: 'x', id: 9 }, { tipo: 'fes\u0000tivo' }, 42] }])
  expect(r.ok && r.valor[0].eventos).toEqual([{ inicio: '2026-10-02', fin: '2026-10-02', tipo: 'ausencia' }, { tipo: 'festivo' }])
})

// --- planificar -----------------------------------------------------------

const HOY = '2026-09-29'
const MANANA = '2026-09-30'
const S = 'U096AGWQJN4'
const perfiles: PerfilIdentificable[] = [{ id: 'p-estefania', nombre: 'Estefanía García', slack_id: S }]
const pulso = (accion: 'activar' | 'desactivar', eventos: EventoRef[] = [], slack_id = S) => ({ slack_id, accion, eventos })
const fechas = (inicio: string, fin: string): EventoRef[] => [{ inicio, fin }]
const fila = (id: number, desde: string, hasta: string | null, eventos: EventoRef[] = [], slack_id = S): AusenciaActual =>
  ({ id, slack_id, desde, hasta, eventos })

// Aplica las operaciones sobre las filas, como la ruta sobre la base (con el índice único
// persona + día de inicio): así los tests encadenan envíos como llegan de verdad.
function aplicar(filas: AusenciaActual[], ops: Operacion[]): AusenciaActual[] {
  let id = Math.max(0, ...filas.map((f) => f.id))
  const r = filas.map((f) => ({ ...f }))
  for (const o of ops) {
    if (o.op === 'cambio') {
      const f = r.find((x) => x.id === o.id)!
      if (o.hasta !== undefined) f.hasta = o.hasta
      if (o.eventos !== undefined) f.eventos = o.eventos
    } else {
      if (r.some((x) => x.slack_id === o.slack_id && x.desde === o.desde)) throw new Error('índice único persona + desde')
      r.push({ id: ++id, slack_id: o.slack_id, desde: o.desde, hasta: o.hasta, eventos: o.eventos })
    }
  }
  return r
}
const envio = (filas: AusenciaActual[], p: ReturnType<typeof pulso>, hoy = HOY) => {
  const plan = planificar([p], perfiles, filas, hoy)
  return { filas: aplicar(filas, plan.operaciones), resultado: plan.respuesta.personas[0].resultado, plan }
}

test('con fechas: activar guarda el periodo entero', () => {
  const r = envio([], pulso('activar', fechas(HOY, '2026-10-02')))
  expect(r.plan.operaciones).toEqual([{ op: 'alta', slack_id: S, desde: HOY, hasta: '2026-10-02', eventos: fechas(HOY, '2026-10-02') }])
  expect(r.resultado).toBe('iniciada')
  expect(r.plan.respuesta.personas[0].persona).toEqual({ id: 'p-estefania', nombre: 'Estefanía García' })
})

test('con fechas: activar y desactivar de un periodo son la misma fila, en cualquier orden', () => {
  const ev = fechas(HOY, HOY) // festivo de un día
  const enOrden = envio(envio([], pulso('activar', ev)).filas, pulso('desactivar', ev))
  const alReves = envio(envio([], pulso('desactivar', ev)).filas, pulso('activar', ev))
  for (const r of [enOrden, alReves]) expect(r.filas.map((f) => [f.desde, f.hasta])).toEqual([[HOY, HOY]])
  expect(alReves.resultado).toBe('ya_iniciada')
})

test('con fechas: repetidos, también pasada la medianoche, no cambian nada', () => {
  const ev = fechas('2026-09-28', HOY)
  let filas = envio([], pulso('activar', ev), '2026-09-28').filas
  filas = envio(filas, pulso('desactivar', ev)).filas
  const antes = JSON.stringify(filas)
  for (const [p, dia] of [[pulso('activar', ev), HOY], [pulso('desactivar', ev), HOY], [pulso('activar', ev), MANANA], [pulso('desactivar', ev), MANANA]] as const) {
    const r = envio(filas, p, dia)
    expect(r.plan.operaciones).toEqual([])
    expect(JSON.stringify(r.filas)).toBe(antes)
  }
})

test('con fechas: el desactivar termina el periodo hoy (vuelta anticipada) o en su fin (si llega tarde)', () => {
  const ev = fechas('2026-09-28', '2026-10-02')
  const filas = envio([], pulso('activar', ev), '2026-09-28').filas
  expect(envio(filas, pulso('desactivar', ev)).filas[0].hasta).toBe(HOY) // vuelve antes
  expect(envio(filas, pulso('desactivar', ev), '2026-10-05').filas[0].hasta).toBe('2026-10-02') // llegó tarde
})

test('con fechas: un desactivar antes de que empiece no guarda nada', () => {
  const r = envio([], pulso('desactivar', fechas('2026-10-05', '2026-10-06')))
  expect(r.plan.operaciones).toEqual([])
  expect(r.resultado).toBe('sin_ausencia')
})

test('con fechas: sin su activar, el desactivar guarda el periodo hasta hoy', () => {
  const r = envio([], pulso('desactivar', fechas('2026-09-24', HOY)))
  expect(r.filas.map((f) => [f.desde, f.hasta])).toEqual([['2026-09-24', HOY]])
  expect(r.resultado).toBe('terminada')
})

test('con fechas: un activar tardío o con fechas ya pasadas guarda el periodo tal cual', () => {
  // Sus días cuentan como ausencia en días sin registrar; no deja a nadie ausente hoy.
  const r = envio([], pulso('activar', fechas('2026-09-21', '2026-09-23')))
  expect(r.filas.map((f) => [f.desde, f.hasta])).toEqual([['2026-09-21', '2026-09-23']])
})

test('con fechas: dos periodos seguidos de la misma persona son dos filas', () => {
  let filas = envio([], pulso('activar', fechas('2026-12-07', '2026-12-07')), '2026-12-07').filas
  filas = envio(filas, pulso('desactivar', fechas('2026-12-07', '2026-12-07')), '2026-12-07').filas
  filas = envio(filas, pulso('desactivar', fechas('2026-12-08', '2026-12-08')), '2026-12-08').filas // al revés
  filas = envio(filas, pulso('activar', fechas('2026-12-08', '2026-12-08')), '2026-12-08').filas
  expect(filas.map((f) => [f.desde, f.hasta])).toEqual([['2026-12-07', '2026-12-07'], ['2026-12-08', '2026-12-08']])
})

test('con fechas: si ya había una abierta sin fechas de ese periodo, la cierra en su fin', () => {
  // El primer pulso llegó sin fechas (abrió desde hoy) y el siguiente las trae.
  const abierta = fila(1, HOY, null)
  const r = envio([abierta], pulso('activar', fechas(HOY, '2026-10-02')))
  expect(r.filas.map((f) => [f.desde, f.hasta])).toEqual([[HOY, '2026-10-02']])
  expect(r.resultado).toBe('ya_iniciada')
})

test('con fechas: una abierta sin fechas que empezó dentro del periodo se cierra en su fin', () => {
  const abierta = fila(1, '2026-09-30', null)
  const r = envio([abierta], pulso('activar', fechas(HOY, '2026-10-02')), '2026-09-30')
  expect(r.filas.map((f) => [f.desde, f.hasta])).toEqual([['2026-09-30', '2026-10-02'], [HOY, '2026-10-02']])
})

test('sin fechas: activar abre desde hoy y desactivar la cierra hoy', () => {
  let r = envio([], pulso('activar'))
  expect(r.filas.map((f) => [f.desde, f.hasta])).toEqual([[HOY, null]])
  r = envio(r.filas, pulso('desactivar'), '2026-10-02')
  expect(r.filas.map((f) => [f.desde, f.hasta])).toEqual([[HOY, '2026-10-02']])
  expect(r.resultado).toBe('terminada')
})

test('sin fechas: repetidos no abren otra; al revés en envíos separados queda un día', () => {
  expect(envio([fila(1, HOY, null)], pulso('activar')).plan.operaciones).toEqual([])
  const alReves = envio(envio([], pulso('desactivar')).filas, pulso('activar'))
  expect(alReves.filas.map((f) => [f.desde, f.hasta])).toEqual([[HOY, HOY]])
  expect(alReves.resultado).toBe('ya_iniciada')
})

test('sin fechas: desactivar cuando lo que hay es un periodo con fechas lo termina hoy', () => {
  const r = envio([fila(1, '2026-09-28', '2026-10-02', fechas('2026-09-28', '2026-10-02'))], pulso('desactivar'))
  expect(r.filas[0].hasta).toBe(HOY)
})

test('sin fechas: un activar el día después de terminar otra ausencia se toma por repetido', () => {
  // Pasada la medianoche no se puede distinguir un reintento de una ausencia nueva sin
  // fechas: se prefiere no dejar a nadie ausente sin fin.
  const r = envio([fila(1, '2026-09-28', HOY)], pulso('activar'), MANANA)
  expect(r.plan.operaciones).toEqual([])
  expect(r.resultado).toBe('ya_terminada')
})

test('sin fechas: activar cuando ya hay un periodo con fechas en curso no abre otra', () => {
  const r = envio([fila(1, '2026-09-28', '2026-10-02')], pulso('activar'))
  expect(r.plan.operaciones).toEqual([])
  expect(r.resultado).toBe('ya_iniciada')
})

test('varias personas y pulsos en un envío, en orden; sin usuario se guarda igual', () => {
  const plan = planificar([
    pulso('activar', fechas(HOY, HOY)), pulso('desactivar', fechas(HOY, HOY)), pulso('activar', [], 'U0A85K6107L'),
  ], perfiles, [], HOY)
  const filas = aplicar([], plan.operaciones)
  expect(filas.map((f) => [f.slack_id, f.desde, f.hasta])).toEqual([[S, HOY, HOY], ['U0A85K6107L', HOY, null]])
  expect(plan.respuesta.personas.map((p) => p.resultado)).toEqual(['iniciada', 'terminada', 'iniciada'])
  expect(plan.respuesta.personas[2].persona).toBe(null)
  // En Recibidos se nota qué pulsos llegaron sin fechas.
  expect(plan.resumen).toBe('Estefanía García: iniciada · Estefanía García: terminada · U0A85K6107L (sin usuario): iniciada (sin fechas)')
})

test('el pulso real de Julián: activar el día de inicio con sus fechas', () => {
  const v = validarEnvio({ Accion: 'activar', 'Slack ID': S, 'Fecha inicio': HOY, 'Fecha fin': '2026-10-02' })
  if (!v.ok) throw new Error(v.error)
  const r = envio([], v.valor[0])
  expect(r.filas.map((f) => [f.desde, f.hasta])).toEqual([[HOY, '2026-10-02']])
  expect(ausenciasHoy(r.filas, HOY).get(S)).toEqual({ desde: HOY, fin: '2026-10-02' })
  expect(ausenciasHoy(r.filas, '2026-10-03').has(S)).toBe(false) // termina sola aunque no llegue el desactivar
})

// --- lectura: días sin registrar, avisos y panel ------------------------------

test('ausenciasPorPersona: fuera hoy si hoy cae en el periodo; sus días, hasta hoy', () => {
  const a = ausenciasPorPersona([fila(1, '2026-09-25', '2026-10-02')], HOY, '2026-07-01').get(S)!
  expect(a.ausenteHoy).toBe(true)
  expect([...a.dias]).toEqual(['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', HOY])
})

test('ausenciasPorPersona: una abierta sin fechas sigue hasta hoy; una ya terminada no silencia', () => {
  expect(ausenciasPorPersona([fila(1, '2026-09-25', null)], HOY, '2026-07-01').get(S)!.ausenteHoy).toBe(true)
  const pasada = ausenciasPorPersona([fila(1, '2026-09-21', '2026-09-23')], HOY, '2026-07-01').get(S)!
  expect(pasada.ausenteHoy).toBe(false)
  expect([...pasada.dias]).toEqual(['2026-09-21', '2026-09-22', '2026-09-23'])
})

test('ausenciasPorPersona: suma varias ausencias, recorta por la ventana e ignora las futuras', () => {
  const a = ausenciasPorPersona([
    fila(1, '2026-06-29', '2026-07-02'), fila(2, '2026-09-28', null), fila(3, '2026-10-05', '2026-10-06'),
  ], HOY, '2026-07-01').get(S)!
  expect([...a.dias].sort()).toEqual(['2026-07-01', '2026-07-02', '2026-09-28', HOY])
  expect(a.ausenteHoy).toBe(true)
})

test('ausenciasHoy: desde cuándo y hasta cuándo si se sabe; las pasadas y futuras no', () => {
  const m = ausenciasHoy([
    fila(1, '2026-09-25', null), // sin fechas: vuelta desconocida
    fila(2, HOY, '2026-10-02', [], 'U0B999D77AN'),
    fila(3, '2026-09-28', HOY, [], 'U09L2RSD2S1'), // hoy es su último día
    fila(4, '2026-09-21', '2026-09-23', [], 'U0APJJT2811'),
    fila(5, '2026-10-05', '2026-10-06', [], 'U07TUQRL4TT'),
  ], HOY)
  expect(m.get(S)).toEqual({ desde: '2026-09-25', fin: null })
  expect(m.get('U0B999D77AN')).toEqual({ desde: HOY, fin: '2026-10-02' })
  expect(m.get('U09L2RSD2S1')).toEqual({ desde: '2026-09-28', fin: HOY })
  expect(m.has('U0APJJT2811')).toBe(false)
  expect(m.has('U07TUQRL4TT')).toBe(false)
})

test('ausenciasHoy: dos ausencias a la vez de la misma persona se juntan', () => {
  expect(ausenciasHoy([fila(1, '2026-09-28', HOY), fila(2, HOY, '2026-10-05')], HOY).get(S)).toEqual({ desde: '2026-09-28', fin: '2026-10-05' })
  expect(ausenciasHoy([fila(1, '2026-09-28', HOY), fila(2, HOY, null)], HOY).get(S)).toEqual({ desde: '2026-09-28', fin: null })
})

test('ausenciasSinUsuario: las de hoy cuyo slack_id no es de ningún usuario', () => {
  const r = ausenciasSinUsuario([fila(1, HOY, null), fila(2, HOY, null, [], 'U0A85K6107L'), fila(3, '2026-09-01', '2026-09-02', [], 'U0A85K6107X')],
    new Set([S]), HOY)
  expect(r).toEqual([{ slack_id: 'U0A85K6107L', desde: HOY, fin: null }])
})

test('etiquetaAusencia: con la fecha de vuelta si se sabe', () => {
  expect(etiquetaAusencia({ desde: HOY, fin: '2026-10-02' }, HOY)).toBe('Ausente hasta el 02/10')
  expect(etiquetaAusencia({ desde: '2026-09-25', fin: HOY }, HOY)).toBe('Ausente hasta hoy')
  expect(etiquetaAusencia({ desde: HOY, fin: null }, HOY)).toBe('Ausente desde el 29/09')
})

// --- ronda 3: fechas que cambian en Airtable, abiertas sin fechas, ISO, resultados -----

test('con fechas: si Airtable alarga la Fecha fin, el desactivar con la nueva la alarga', () => {
  const filas = envio([], pulso('activar', fechas(HOY, '2026-10-02'))).filas
  const r = envio(filas, pulso('desactivar', fechas(HOY, '2026-10-09')), '2026-10-09')
  expect(r.filas.map((f) => [f.desde, f.hasta])).toEqual([[HOY, '2026-10-09']])
  expect(r.resultado).toBe('terminada')
})

test('con fechas: el desactivar normal (el día de fin) contesta terminada; repetido días después, ya_terminada', () => {
  const filas = envio([], pulso('activar', fechas(HOY, '2026-10-02'))).filas
  const normal = envio(filas, pulso('desactivar', fechas(HOY, '2026-10-02')), '2026-10-02')
  expect(normal.resultado).toBe('terminada')
  const tarde = envio(normal.filas, pulso('desactivar', fechas(HOY, '2026-10-02')), '2026-10-05')
  expect(tarde.plan.operaciones).toEqual([])
  expect(tarde.resultado).toBe('ya_terminada')
})

test('con fechas: una ausencia nueva cierra la abierta sin fechas de antes el día anterior a su inicio', () => {
  // Se perdió el desactivar de una sin fechas: la siguiente con fechas le pone límite.
  const r = envio([fila(1, '2026-09-10', null)], pulso('activar', fechas(HOY, '2026-10-02')))
  expect(r.filas.map((f) => [f.desde, f.hasta])).toEqual([['2026-09-10', '2026-09-28'], [HOY, '2026-10-02']])
})

test('sin fechas: el desactivar termina la ausencia que empezó más tarde (el festivo, no las vacaciones)', () => {
  const vacaciones = fila(1, '2026-09-20', '2026-10-12', fechas('2026-09-20', '2026-10-12'))
  const festivo = fila(2, HOY, HOY, fechas(HOY, HOY))
  const r = envio([vacaciones, festivo], pulso('desactivar'))
  expect(r.plan.operaciones).toEqual([])
  expect(r.filas.find((f) => f.id === 1)!.hasta).toBe('2026-10-12')
})

test('validarEnvio: una fecha ISO con microsegundos y zona cuenta por su día en Madrid', () => {
  const r = validarEnvio({ Accion: 'activar', 'Slack ID': S, 'Fecha inicio': '2026-09-28T22:00:00.123456+00:00', 'Fecha fin': '2026-10-02' })
  expect(r.ok && r.valor[0].eventos).toEqual([{ inicio: HOY, fin: '2026-10-02' }])
})

test('validarEnvio: un evento de la lista con fechas mal escritas da 400, no se ignora', () => {
  expect(errorDe({ ...santiago, eventos: [{ inicio: '29/09/2026', fin: '2026-10-02' }] })).toMatch(/evento 1/)
  expect(errorDe({ ...santiago, eventos: [{ inicio: '2026-09-29' }] })).toMatch(/evento 1/)
})
