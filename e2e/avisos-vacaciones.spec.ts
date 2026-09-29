import { test, expect } from '@playwright/test'
import {
  validarEnvio, planificar, ausenciasPorPersona, ausenciasHoy, ausenciasSinUsuario, ausenciasSinDesactivar, etiquetaAusencia,
  type PerfilIdentificable, type AusenciaActual, type EventoRef, type Operacion,
} from '../lib/avisos/vacaciones'

// Las ausencias (vacaciones, festivos…) llegan del flujo de Julián como un interruptor por
// persona: `activar` lo enciende el día que empieza y `desactivar` lo apaga el día que
// termina (ese día todavía es de vacaciones). Las fechas del pulso no deciden cuándo se
// enciende ni se apaga: son la red por si el desactivar no llega a tiempo.

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

test('validarEnvio: las fechas no hacen fallar un pulso: se guardan si se entienden', () => {
  // Son de referencia: una fecha mal escrita no puede impedir encender o apagar el interruptor.
  const base = { Accion: 'activar', 'Slack ID': 'U096AGWQJN4' }
  const r = validarEnvio({ ...base, 'Fecha inicio': '29/09/2026', 'Fecha fin': '2026-10-02' })
  expect(r.ok && r.valor[0].eventos).toEqual([{ fin: '2026-10-02' }])
  expect(validarEnvio({ ...base, 'Fecha inicio': '2026-10-02', 'Fecha fin': '2026-09-29' }).ok).toBe(true)
  expect(validarEnvio({ ...base, eventos: [{ inicio: 'mal' }] }).ok).toBe(true)
})

test('validarEnvio: de cada evento de la lista solo se guarda inicio, fin y tipo, en texto y limpio', () => {
  const r = validarEnvio([{ ...santiago, eventos: [{ inicio: ' 2026-10-02 ', fin: '2026-10-02', tipo: 'ausencia', nota: 'x', id: 9 }, { tipo: 'fes\u0000tivo' }, 42] }])
  expect(r.ok && r.valor[0].eventos).toEqual([{ inicio: '2026-10-02', fin: '2026-10-02', tipo: 'ausencia' }, { tipo: 'festivo' }])
})

// --- planificar: el interruptor ------------------------------------------------

const HOY = '2026-09-29'
const MANANA = '2026-09-30'
const S = 'U096AGWQJN4'
const perfiles: PerfilIdentificable[] = [{ id: 'p-estefania', nombre: 'Estefanía García', slack_id: S }]
const pulso = (accion: 'activar' | 'desactivar', eventos: EventoRef[] = [], slack_id = S) => ({ slack_id, accion, eventos })
const fechas = (inicio: string, fin: string): EventoRef[] => [{ inicio, fin }]
const fila = (id: number, desde: string, hasta: string | null, eventos: EventoRef[] = [], slack_id = S): AusenciaActual =>
  ({ id, slack_id, desde, hasta, eventos })

// Aplica las operaciones sobre las filas, como la ruta sobre la base (índices únicos:
// persona + día de inicio, y una encendida por persona).
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
      if (o.hasta === null && r.some((x) => x.slack_id === o.slack_id && x.hasta === null)) throw new Error('índice de una encendida')
      r.push({ id: ++id, slack_id: o.slack_id, desde: o.desde, hasta: o.hasta, eventos: o.eventos })
    }
  }
  return r
}
const envio = (filas: AusenciaActual[], p: ReturnType<typeof pulso>, hoy = HOY) => {
  const plan = planificar([p], perfiles, filas, hoy)
  return { filas: aplicar(filas, plan.operaciones), resultado: plan.respuesta.personas[0].resultado, plan }
}
const periodos = (filas: AusenciaActual[]) => filas.map((f) => [f.desde, f.hasta])

test('interruptor: activar lo enciende desde hoy; desactivar lo apaga ese día (que todavía cuenta)', () => {
  let r = envio([], pulso('activar'))
  expect(r.plan.operaciones).toEqual([{ op: 'alta', slack_id: S, desde: HOY, hasta: null, eventos: [] }])
  expect(r.resultado).toBe('iniciada')
  expect(r.plan.respuesta.personas[0].persona).toEqual({ id: 'p-estefania', nombre: 'Estefanía García' })
  r = envio(r.filas, pulso('desactivar'), '2026-10-02')
  expect(periodos(r.filas)).toEqual([[HOY, '2026-10-02']])
  expect(r.resultado).toBe('terminada')
})

test('interruptor: las fechas no deciden cuándo se enciende ni se apaga', () => {
  // Aunque digan otra cosa, se enciende hoy y se apaga cuando llega el desactivar.
  let r = envio([], pulso('activar', fechas('2026-10-05', '2026-10-09')))
  expect(periodos(r.filas)).toEqual([[HOY, null]])
  expect(r.filas[0].eventos).toEqual(fechas('2026-10-05', '2026-10-09'))
  r = envio(r.filas, pulso('desactivar', fechas('2026-10-05', '2026-10-09')), MANANA)
  expect(periodos(r.filas)).toEqual([[HOY, MANANA]])
})

test('interruptor: encendido, otro activar no hace nada (guarda sus fechas si trae nuevas)', () => {
  const r = envio([fila(1, '2026-09-28', null)], pulso('activar', fechas('2026-09-28', '2026-10-02')))
  expect(r.plan.operaciones).toEqual([{ op: 'cambio', id: 1, eventos: fechas('2026-09-28', '2026-10-02') }])
  expect(periodos(r.filas)).toEqual([['2026-09-28', null]])
  expect(r.resultado).toBe('ya_iniciada')
  expect(envio(r.filas, pulso('activar', fechas('2026-09-28', '2026-10-02'))).plan.operaciones).toEqual([])
})

test('interruptor: apagado, un desactivar no hace nada', () => {
  const repetido = envio([fila(1, '2026-09-25', HOY)], pulso('desactivar'))
  expect(repetido.plan.operaciones).toEqual([])
  expect(repetido.resultado).toBe('ya_terminada')
  const sinActivar = envio([], pulso('desactivar'))
  expect(sinActivar.plan.operaciones).toEqual([])
  expect(sinActivar.resultado).toBe('sin_ausencia')
})

test('interruptor: un activar el mismo día en que se apagó no lo vuelve a encender', () => {
  // Solo puede ser un reintento del activar de esa mañana: volver a encender dejaría a la
  // persona de vacaciones sin fin.
  const r = envio([fila(1, '2026-09-25', HOY)], pulso('activar'))
  expect(r.plan.operaciones).toEqual([])
  expect(r.resultado).toBe('ya_terminada')
})

test('interruptor: un festivo de un día, activar y desactivar el mismo día', () => {
  let r = envio([], pulso('activar'))
  r = envio(r.filas, pulso('desactivar'))
  expect(periodos(r.filas)).toEqual([[HOY, HOY]])
})

test('interruptor: se enciende de nuevo otro día para otras vacaciones', () => {
  const r = envio([fila(1, '2026-09-01', '2026-09-05')], pulso('activar'))
  expect(periodos(r.filas)).toEqual([['2026-09-01', '2026-09-05'], [HOY, null]])
})

test('varias personas y pulsos en un envío, en orden; sin usuario se guarda igual', () => {
  const plan = planificar([pulso('activar'), pulso('desactivar'), pulso('activar', [], 'U0A85K6107L')], perfiles, [], HOY)
  const filas = aplicar([], plan.operaciones)
  expect(filas.map((f) => [f.slack_id, f.desde, f.hasta])).toEqual([[S, HOY, HOY], ['U0A85K6107L', HOY, null]])
  expect(plan.respuesta.personas.map((p) => p.resultado)).toEqual(['iniciada', 'terminada', 'iniciada'])
  expect(plan.respuesta.personas[2].persona).toBe(null)
  expect(plan.resumen).toBe('Estefanía García: iniciada · Estefanía García: terminada · U0A85K6107L (sin usuario): iniciada')
})

test('el pulso real de Julián: activar el día de inicio', () => {
  const v = validarEnvio({ Accion: 'activar', 'Slack ID': S, 'Fecha inicio': HOY, 'Fecha fin': '2026-10-02' })
  if (!v.ok) throw new Error(v.error)
  const r = envio([], v.valor[0])
  expect(periodos(r.filas)).toEqual([[HOY, null]])
  expect(ausenciasHoy(r.filas, HOY).get(S)).toEqual({ desde: HOY, fin: '2026-10-02' }) // se ve cuándo vuelve
  // Si pasa su Fecha fin sin que llegue el desactivar, se da por apagado en esa fecha.
  expect(ausenciasHoy(r.filas, '2026-10-05').has(S)).toBe(false)
})

// --- lectura: días sin registrar, avisos y panel ------------------------------

test('ausenciasPorPersona: encendido, fuera hoy; sus días, hasta hoy', () => {
  const a = ausenciasPorPersona([fila(1, '2026-09-25', null)], HOY, '2026-07-01').get(S)!
  expect(a.ausenteHoy).toBe(true)
  expect([...a.dias]).toEqual(['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', HOY])
})

test('ausenciasPorPersona: apagado hoy, todavía fuera hoy; apagado antes, no silencia pero sus días no cuentan', () => {
  expect(ausenciasPorPersona([fila(1, '2026-09-25', HOY)], HOY, '2026-07-01').get(S)!.ausenteHoy).toBe(true)
  const pasada = ausenciasPorPersona([fila(1, '2026-09-21', '2026-09-23')], HOY, '2026-07-01').get(S)!
  expect(pasada.ausenteHoy).toBe(false)
  expect([...pasada.dias]).toEqual(['2026-09-21', '2026-09-22', '2026-09-23'])
})

test('ausenciasPorPersona: suma varias ausencias y recorta por la ventana', () => {
  const a = ausenciasPorPersona([fila(1, '2026-06-29', '2026-07-02'), fila(2, '2026-09-28', null)], HOY, '2026-07-01').get(S)!
  expect([...a.dias].sort()).toEqual(['2026-07-01', '2026-07-02', '2026-09-28', HOY])
  expect(a.ausenteHoy).toBe(true)
})

test('ausenciasHoy: desde cuándo y, para mostrar, hasta cuándo si las fechas lo dicen', () => {
  const m = ausenciasHoy([
    fila(1, '2026-09-25', null), // encendido sin fechas
    fila(2, HOY, null, fechas(HOY, '2026-10-02'), 'U0B999D77AN'), // encendido; sus fechas dicen el 02/10
    fila(3, '2026-09-28', HOY, [], 'U09L2RSD2S1'), // apagado hoy: hoy es su último día
    fila(4, '2026-09-21', '2026-09-23', [], 'U0APJJT2811'), // apagado antes
  ], HOY)
  expect(m.get(S)).toEqual({ desde: '2026-09-25', fin: null })
  expect(m.get('U0B999D77AN')).toEqual({ desde: HOY, fin: '2026-10-02' })
  expect(m.get('U09L2RSD2S1')).toEqual({ desde: '2026-09-28', fin: HOY })
  expect(m.has('U0APJJT2811')).toBe(false)
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

// --- las fechas como red: si el desactivar no llega a tiempo ---------------------------

const encendidoHasta = (fin: string) => fila(1, HOY, null, fechas(HOY, fin))

test('red: si pasa la Fecha fin y no llegó el desactivar, se da por apagado en su fin', () => {
  const filas = [encendidoHasta('2026-10-02')]
  expect(ausenciasHoy(filas, '2026-10-02').get(S)).toEqual({ desde: HOY, fin: '2026-10-02' })
  expect(ausenciasHoy(filas, '2026-10-03').has(S)).toBe(false)
  const a = ausenciasPorPersona(filas, '2026-10-06', '2026-07-01').get(S)!
  expect(a.ausenteHoy).toBe(false)
  expect([...a.dias]).toEqual([HOY, '2026-09-30', '2026-10-01', '2026-10-02'])
})

test('red: la lista de a quién no le llegó el desactivar a tiempo', () => {
  const filas = [encendidoHasta('2026-10-02'), fila(2, HOY, null, fechas(HOY, '2026-10-09'), 'U0B999D77AN'), fila(3, HOY, null, [], 'U09L2RSD2S1')]
  expect(ausenciasSinDesactivar(filas, '2026-10-05')).toEqual([{ slack_id: S, desde: HOY, fin: '2026-10-02' }])
})

test('red: un desactivar que llega tarde se corrige a su Fecha fin', () => {
  const r = envio([encendidoHasta('2026-10-02')], pulso('desactivar'), '2026-10-05')
  expect(periodos(r.filas)).toEqual([[HOY, '2026-10-02']])
})

test('red: si Airtable alarga la Fecha fin, el desactivar con la nueva manda', () => {
  const r = envio([encendidoHasta('2026-10-02')], pulso('desactivar', fechas(HOY, '2026-10-09')), '2026-10-09')
  expect(periodos(r.filas)).toEqual([[HOY, '2026-10-09']])
  expect(r.resultado).toBe('terminada')
})

test('red: un activar nuevo tras un desactivar perdido cierra la vieja en su Fecha fin', () => {
  const r = envio([encendidoHasta('2026-10-02')], pulso('activar', fechas('2026-10-20', '2026-10-23')), '2026-10-20')
  expect(periodos(r.filas)).toEqual([[HOY, '2026-10-02'], ['2026-10-20', null]])
  expect(r.resultado).toBe('iniciada')
})

test('red: un activar cuyas fechas ya pasaron no enciende nada', () => {
  // Un reintento muy tardío: esa ausencia ya terminó.
  const r = envio([], pulso('activar', fechas('2026-09-21', '2026-09-23')))
  expect(r.plan.operaciones).toEqual([])
  expect(r.resultado).toBe('ya_terminada')
})

// --- verificación del interruptor: las fechas no pueden encender ni apagar a destiempo ---

test('interruptor: un activar el día de inicio con una Fecha fin mal tecleada enciende igual', () => {
  // Fecha fin anterior a la de inicio (errata de año): se ignora, no bloquea el interruptor.
  const r = envio([], pulso('activar', fechas('2026-12-22', '2026-01-07')), '2026-12-22')
  expect(periodos(r.filas)).toEqual([['2026-12-22', null]])
  expect(r.resultado).toBe('iniciada')
})

test('interruptor: un festivo dentro de unas vacaciones no las apaga', () => {
  const vacaciones = fechas('2026-10-05', '2026-10-16')
  let r = envio([], pulso('activar', vacaciones), '2026-10-05')
  r = envio(r.filas, pulso('activar', fechas('2026-10-12', '2026-10-12')), '2026-10-12') // ya encendido
  r = envio(r.filas, pulso('desactivar', fechas('2026-10-12', '2026-10-12')), '2026-10-12')
  expect(periodos(r.filas)).toEqual([['2026-10-05', null]])
  expect(r.resultado).toBe('ya_iniciada') // sigue de vacaciones
  r = envio(r.filas, pulso('desactivar', vacaciones), '2026-10-16')
  expect(periodos(r.filas)).toEqual([['2026-10-05', '2026-10-16']])
  expect(r.resultado).toBe('terminada')
})

test('interruptor: un desactivar tardío de una ausencia anterior no apaga la siguiente', () => {
  const r = envio([fila(1, '2026-09-21', '2026-09-23', fechas('2026-09-21', '2026-09-23')), fila(2, '2026-10-05', null, fechas('2026-10-05', '2026-10-09'))],
    pulso('desactivar', fechas('2026-09-21', '2026-09-23')), '2026-10-06')
  expect(r.plan.operaciones).toEqual([])
  expect(r.resultado).toBe('ya_terminada')
})

test('interruptor: un desactivar tardío con la Fecha fin acortada se corrige a la que trae', () => {
  // Iba hasta el 09/10, volvió el 02/10 (Airtable lo acortó) y el desactivar llega el 05/10.
  const r = envio([encendidoHasta('2026-10-09')], pulso('desactivar', fechas(HOY, '2026-10-02')), '2026-10-05')
  expect(periodos(r.filas)).toEqual([[HOY, '2026-10-02']])
})

test('interruptor: un desactivar tardío repetido, ya apagado, contesta ya_terminada', () => {
  const r = envio([fila(1, HOY, '2026-10-02', fechas(HOY, '2026-10-02'))], pulso('desactivar', fechas(HOY, '2026-10-02')), '2026-10-05')
  expect(r.plan.operaciones).toEqual([])
  expect(r.resultado).toBe('ya_terminada')
})
