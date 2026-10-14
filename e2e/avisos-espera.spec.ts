import { test, expect } from '@playwright/test'
import {
  armarGuardado, planAvisosRegistro, estadoTrasFallo, resumirPorDia, plazoRestante, esperasAtrasadas, type RegistroActual,
} from '../lib/avisos/reglas'

// Los avisos de un registro esperan 5 minutos y se arman con cómo quedaron sus registros
// (spec 2026-10-14-avisos-espera-registro). Aquí, la parte pura: qué guardado queda y qué
// avisos salen de él.

const reg = (id: string, entry_date: string, lineas: [string, number][], status = 'guardado'): RegistroActual =>
  ({ id, entry_date, status, lineas: lineas.map(([project, hours]) => ({ project, hours })) })

const totalesDe = (lineas: { entry_date: string; project: string; hours: number }[]) =>
  resumirPorDia(lineas.map((l) => ({ dia: l.entry_date, proyecto: l.project, horas: l.hours })))

// Estefania, 09/10: guardó Vagheggi el 08/10 y tres líneas con la fecha que se quedó en
// «hoy»; 25 s después movió ese registro al 08/10. Al vencer la espera los dos están el 08/10.
const estefania = [
  reg('d0206224', '2026-10-08', [['Vagheggi', 1]]),
  reg('a304fff4', '2026-10-08', [['Abogados Concursales 2', 1], ['Departamento', 2], ['Departamento', 4]], 'editado'),
]

test('armarGuardado: la fecha movida en la espera cuenta con la fecha nueva', () => {
  const { lineas, logPorDia } = armarGuardado(estefania)
  expect(lineas).toHaveLength(4)
  expect(new Set(lineas.map((l) => l.entry_date))).toEqual(new Set(['2026-10-08']))
  // Dos registros acaban el mismo día: el día enlaza el de más horas.
  expect(logPorDia).toEqual(new Map([['2026-10-08', 'a304fff4']]))
})

test('plan: el caso de Estefania sale como un pulso del 08/10 con 8 h y sin llamativo', () => {
  const { lineas } = armarGuardado(estefania)
  const plan = planAvisosRegistro({ esAlta: true, lineas, totales: totalesDe(lineas) })
  expect(plan.pulsos).toEqual([{
    dia: '2026-10-08', horasRegistro: 8, horasDia: 8,
    proyectos: [{ proyecto: 'Abogados Concursales 2', horas: 1 }, { proyecto: 'Departamento', horas: 6 }, { proyecto: 'Vagheggi', horas: 1 }],
  }])
  expect(plan.llamativos).toEqual([])
})

test('armarGuardado: un registro anulado no cuenta', () => {
  const { lineas, logPorDia } = armarGuardado([
    reg('a', '2026-10-08', [['Fundares', 2]]),
    reg('b', '2026-10-09', [['Cipsa', 3]], 'anulado'),
  ])
  expect(lineas).toEqual([{ entry_date: '2026-10-08', project: 'Fundares', hours: 2 }])
  expect(logPorDia).toEqual(new Map([['2026-10-08', 'a']]))
})

test('armarGuardado: todo anulado deja el guardado vacío y no sale nada', () => {
  const { lineas, logPorDia } = armarGuardado([reg('a', '2026-10-08', [['Fundares', 2]], 'anulado')])
  expect(lineas).toEqual([])
  expect(logPorDia.size).toBe(0)
  expect(planAvisosRegistro({ esAlta: true, lineas, totales: new Map() })).toEqual({ pulsos: [], llamativos: [] })
})

test('armarGuardado: a igualdad de horas el día enlaza el id menor, sea cual sea el orden', () => {
  const a = reg('b2', '2026-10-08', [['Fundares', 2]])
  const b = reg('a1', '2026-10-08', [['Cipsa', 2]])
  expect(armarGuardado([a, b]).logPorDia.get('2026-10-08')).toBe('a1')
  expect(armarGuardado([b, a]).logPorDia.get('2026-10-08')).toBe('a1')
})

test('plan: el llamativo mira el día entero tal como quedó', () => {
  const lineas = [{ entry_date: '2026-10-09', project: 'Departamento', hours: 7 }]
  // El otro registro va a Departamento para que solo pueda saltar el día largo.
  const conOtro = (otro: number) => totalesDe([...lineas, { entry_date: '2026-10-09', project: 'Departamento', hours: otro }])
  // Con otro registro de 8,5 h ese día: 15,5 h, llamativo.
  expect(planAvisosRegistro({ esAlta: true, lineas, totales: conOtro(8.5) }).llamativos).toEqual([
    { dia: '2026-10-09', motivo: { regla: 'dia_largo', valor: 15.5, limite: 10, proyecto: null }, horasDia: 15.5 },
  ])
  // Si el día quedó en 8,5 h (el otro registro se movió), nada.
  expect(planAvisosRegistro({ esAlta: true, lineas, totales: conOtro(1.5) }).llamativos).toEqual([])
})

test('plan: una edición no manda pulso, pero sí el llamativo', () => {
  const lineas = [{ entry_date: '2026-10-09', project: 'Fundares', hours: 6 }]
  const plan = planAvisosRegistro({ esAlta: false, lineas, totales: totalesDe(lineas) })
  expect(plan.pulsos).toEqual([])
  expect(plan.llamativos).toEqual([
    { dia: '2026-10-09', motivo: { regla: 'proyecto_largo', valor: 6, limite: 5, proyecto: 'Fundares' }, horasDia: 6 },
  ])
})

test('plan: un pulso por fecha, en orden de fecha', () => {
  const { lineas } = armarGuardado([
    reg('a', '2026-10-09', [['Fundares', 2]]),
    reg('b', '2026-10-07', [['Cipsa', 3]]),
  ])
  const plan = planAvisosRegistro({ esAlta: true, lineas, totales: totalesDe(lineas) })
  expect(plan.pulsos.map((p) => [p.dia, p.horasRegistro])).toEqual([['2026-10-07', 3], ['2026-10-09', 2]])
})

test('plan: horasDia suma los otros registros del día; horasRegistro, solo los de este guardado', () => {
  const lineas = [{ entry_date: '2026-10-09', project: 'Fundares', hours: 2 }]
  const totales = totalesDe([...lineas, { entry_date: '2026-10-09', project: 'Departamento', hours: 6 }])
  const [p] = planAvisosRegistro({ esAlta: true, lineas, totales }).pulsos
  expect([p.horasRegistro, p.horasDia]).toEqual([2, 8])
})

test('plazoRestante: lo que falta hasta el límite, nunca negativo', () => {
  expect(plazoRestante(10_000, 4_000)).toBe(6_000)
  expect(plazoRestante(10_000, 12_000)).toBe(0)
})

test('esperasAtrasadas: cuenta las que vencieron hace más de 15 min (reloj parado)', () => {
  const ahora = Date.parse('2026-10-14T12:00:00Z')
  expect(esperasAtrasadas([
    '2026-10-14T11:59:00Z', // vencida hace 1 min: lo normal
    '2026-10-14T11:46:00Z', // 14 min: todavía no
    '2026-10-14T11:44:00Z', // 16 min: atrasada
    '2026-10-13T09:00:00Z', // de ayer: atrasada
  ], ahora)).toBe(2)
})

test('estadoTrasFallo: se reintenta hasta el tercer intento', () => {
  expect(estadoTrasFallo(1)).toBe('pendiente')
  expect(estadoTrasFallo(2)).toBe('pendiente')
  expect(estadoTrasFallo(3)).toBe('fallida')
})
