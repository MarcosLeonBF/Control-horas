import { test, expect } from '@playwright/test'
import { carrySplit, reglaCarry, CARRY_FORWARD_PCT } from '../lib/horas/carry-forward'

const MES_ACTUAL = '2026-07'
// Tabla de referencia de la spec (hoja del usuario, enero–julio).
const TABLA = [
  { month: '2026-01', assigned: 5, consumed: 2 },
  { month: '2026-02', assigned: 5, consumed: 2 },
  { month: '2026-03', assigned: 5, consumed: 0 },
  { month: '2026-04', assigned: 5, consumed: 1 },
  { month: '2026-05', assigned: 5, consumed: 0 },
  { month: '2026-06', assigned: 0, consumed: 3 },
  { month: '2026-07', assigned: 5, consumed: 0 },
]

test('la tabla de referencia da inutilizables 15, carry bruto 5 y neto 2', () => {
  const { totales } = carrySplit(TABLA, MES_ACTUAL)
  expect(totales.inutilizables).toBeCloseTo(15)
  expect(totales.carryBruto).toBeCloseTo(5)
  expect(totales.carryNeto).toBeCloseTo(2)
})

test('el mes en curso no sufre el corte (julio no aparece en porMes)', () => {
  const { porMes } = carrySplit(TABLA, MES_ACTUAL)
  expect(porMes.map((m) => m.month)).not.toContain('2026-07')
  expect(porMes).toHaveLength(6)
})

test('enero: sobrante 3 → 0.75 libres y 2.25 inutilizables', () => {
  const { porMes } = carrySplit(TABLA, MES_ACTUAL)
  const enero = porMes.find((m) => m.month === '2026-01')!
  expect(enero.libres).toBeCloseTo(0.75)
  expect(enero.inutilizables).toBeCloseTo(2.25)
  expect(enero.exceso).toBe(0)
})

test('junio excedido: sobrante 0, sin libres, exceso 3', () => {
  const { porMes } = carrySplit(TABLA, MES_ACTUAL)
  const junio = porMes.find((m) => m.month === '2026-06')!
  expect(junio.libres).toBe(0)
  expect(junio.inutilizables).toBe(0)
  expect(junio.exceso).toBe(3)
})

test('el ejemplo de abril: 16 asignadas y 8 consumidas → 6 inútiles y 2 libres', () => {
  const { porMes } = carrySplit([{ month: '2026-04', assigned: 16, consumed: 8 }], '2026-05')
  expect(porMes[0].libres).toBeCloseTo(2)
  expect(porMes[0].inutilizables).toBeCloseTo(6)
})

test('sin meses: todo en cero', () => {
  const { porMes, totales } = carrySplit([], MES_ACTUAL)
  expect(porMes).toEqual([])
  expect(totales).toEqual({ inutilizables: 0, carryBruto: 0, carryNeto: 0 })
})

test('los excesos nunca dejan el carry negativo', () => {
  const { totales } = carrySplit(
    [
      { month: '2026-01', assigned: 4, consumed: 0 }, // libres 1
      { month: '2026-02', assigned: 0, consumed: 9 }, // exceso 9
    ],
    MES_ACTUAL,
  )
  expect(totales.carryNeto).toBe(0)
})

// Ampliaciones por posición (spec 2026-10-15): lo ampliado va dentro de `assigned` pero no
// entra en el corte. Ejemplo de la spec: 16 Excel + 10 ampliadas, 12 consumidas.
test('lo ampliado no sufre el corte: 16 Excel + 10 ampliadas, 12 consumidas → 1 libre, 3 inútiles', () => {
  const { porMes, totales } = carrySplit([{ month: '2026-09', assigned: 26, ampliado: 10, consumed: 12 }], '2026-10')
  expect(porMes[0].libres).toBeCloseTo(1)
  expect(porMes[0].inutilizables).toBeCloseTo(3)
  expect(porMes[0].exceso).toBe(0)
  expect(totales.inutilizables).toBeCloseTo(3)
})

test('el consumo sale primero del Excel: lo que pasa de la base es exceso aunque haya ampliado', () => {
  // 16 Excel + 10 ampliadas, 20 consumidas: la base se agota (sin sobrante) y 4 son exceso.
  const { porMes } = carrySplit([{ month: '2026-09', assigned: 26, ampliado: 10, consumed: 20 }], '2026-10')
  expect(porMes[0].libres).toBe(0)
  expect(porMes[0].inutilizables).toBe(0)
  expect(porMes[0].exceso).toBe(4)
})

test('consumo igual a la base con ampliado: ni sobrante ni exceso por ruido de coma flotante', () => {
  // (7,35 + 2,2) − 2,2 !== 7,35 en coma flotante: sin redondear saldría un exceso de 1e-15.
  const { porMes } = carrySplit([{ month: '2026-09', assigned: 7.35 + 2.2, ampliado: 2.2, consumed: 7.35 }], '2026-10')
  expect(porMes[0]).toEqual({ month: '2026-09', libres: 0, inutilizables: 0, exceso: 0 })
})

test('un mes solo con ampliado no genera libres ni inutilizables', () => {
  const { porMes, totales } = carrySplit([{ month: '2026-09', assigned: 8, ampliado: 8, consumed: 0 }], '2026-10')
  expect(porMes[0]).toEqual({ month: '2026-09', libres: 0, inutilizables: 0, exceso: 0 })
  expect(totales).toEqual({ inutilizables: 0, carryBruto: 0, carryNeto: 0 })
})

test('la constante del corte es 25%', () => {
  expect(CARRY_FORWARD_PCT).toBe(0.25)
})

// Reparto por posición (Roberto, 2026-10-16): cada posición conserva su propio porcentaje
// del sobrante y algunas no recortan el primer mes del proyecto (el de la Fecha Inicio
// Contable, el mismo del setup).
test('cada posición tiene su reparto y su regla del primer mes', () => {
  const esperado: [string, number, boolean][] = [
    ['CRM', 0.3, true],
    ['Project Manager', 0.3, true],
    ['Growth Strategist', 0.3, true],
    ['SEO Strategist', 0.3, true],
    ['SEO Content Strategist', 0.3, true],
    ['SEO Asistente', 0.3, true],
    ['Sales Coach', 0.3, true],
    ['Copywriter', 0.5, true],
    ['Hiring Manager', 0.25, true],
    ['Asistente RRHH', 0.25, true],
    ['Director de Operaciones', 0.25, false],
    ['BDR', 0.1, false],
  ]
  for (const [posicion, libres, primerMesSinCorte] of esperado) {
    expect(reglaCarry(posicion), posicion).toEqual({ libres, primerMesSinCorte })
  }
})

test('una posición fuera de la lista se queda con la regla de siempre', () => {
  const deSiempre = { libres: CARRY_FORWARD_PCT, primerMesSinCorte: false }
  expect(reglaCarry('Administración')).toEqual(deSiempre)
  expect(reglaCarry('Posición que aún no existe')).toEqual(deSiempre)
})

test('la posición casa sin mayúsculas, tildes ni espacios de más', () => {
  expect(reglaCarry('  seo   content strategist ')).toEqual({ libres: 0.3, primerMesSinCorte: true })
  expect(reglaCarry('DIRECTOR DE OPERACIONES')).toEqual({ libres: 0.25, primerMesSinCorte: false })
  expect(reglaCarry('Cópywriter')).toEqual({ libres: 0.5, primerMesSinCorte: true })
})

test('sin regla, carrySplit sigue cortando 75/25', () => {
  const { porMes } = carrySplit([{ month: '2026-09', assigned: 16, consumed: 8 }], '2026-10')
  expect(porMes[0].libres).toBeCloseTo(2)
  expect(porMes[0].inutilizables).toBeCloseTo(6)
})

test('CRM 70/30: sobrante 10 → 3 libres y 7 inutilizables', () => {
  const { porMes } = carrySplit([{ month: '2026-09', assigned: 16, consumed: 6 }], '2026-10', { regla: reglaCarry('CRM') })
  expect(porMes[0].libres).toBeCloseTo(3)
  expect(porMes[0].inutilizables).toBeCloseTo(7)
})

test('70/30 y 90/10 sin ruido de coma flotante: 0,3 × 10 da 3 justo', () => {
  const mes = [{ month: '2026-09', assigned: 16, consumed: 6 }]
  expect(carrySplit(mes, '2026-10', { regla: reglaCarry('CRM') }).porMes[0]).toEqual({ month: '2026-09', libres: 3, inutilizables: 7, exceso: 0 })
  expect(carrySplit(mes, '2026-10', { regla: reglaCarry('BDR') }).porMes[0]).toEqual({ month: '2026-09', libres: 1, inutilizables: 9, exceso: 0 })
})

test('Copywriter 50/50 y BDR 90/10', () => {
  const mes = [{ month: '2026-09', assigned: 16, consumed: 6 }]
  const copy = carrySplit(mes, '2026-10', { regla: reglaCarry('Copywriter') }).porMes[0]
  expect(copy.libres).toBeCloseTo(5)
  expect(copy.inutilizables).toBeCloseTo(5)
  const bdr = carrySplit(mes, '2026-10', { regla: reglaCarry('BDR') }).porMes[0]
  expect(bdr.libres).toBeCloseTo(1)
  expect(bdr.inutilizables).toBeCloseTo(9)
})

const DOS_MESES = [
  { month: '2026-08', assigned: 16, consumed: 6 },
  { month: '2026-09', assigned: 16, consumed: 6 },
]

test('el primer mes del proyecto pasa entero como libres si la posición no lo recorta', () => {
  const { porMes, totales } = carrySplit(DOS_MESES, '2026-10', { regla: reglaCarry('CRM'), mesInicio: '2026-08' })
  const agosto = porMes.find((m) => m.month === '2026-08')!
  const septiembre = porMes.find((m) => m.month === '2026-09')!
  expect(agosto).toEqual({ month: '2026-08', libres: 10, inutilizables: 0, exceso: 0 })
  expect(septiembre.libres).toBeCloseTo(3)
  expect(septiembre.inutilizables).toBeCloseTo(7)
  expect(totales.inutilizables).toBeCloseTo(7)
  expect(totales.carryBruto).toBeCloseTo(13)
})

test('BDR y Director de Operaciones recortan también el primer mes', () => {
  const bdr = carrySplit(DOS_MESES, '2026-10', { regla: reglaCarry('BDR'), mesInicio: '2026-08' }).porMes[0]
  expect(bdr.libres).toBeCloseTo(1)
  expect(bdr.inutilizables).toBeCloseTo(9)
  const director = carrySplit(DOS_MESES, '2026-10', { regla: reglaCarry('Director de Operaciones'), mesInicio: '2026-08' }).porMes[0]
  expect(director.libres).toBeCloseTo(2.5)
  expect(director.inutilizables).toBeCloseTo(7.5)
})

test('sin Fecha Inicio Contable no hay primer mes que liberar', () => {
  const agosto = carrySplit(DOS_MESES, '2026-10', { regla: reglaCarry('CRM'), mesInicio: '' }).porMes[0]
  expect(agosto.libres).toBeCloseTo(3)
  expect(agosto.inutilizables).toBeCloseTo(7)
})

test('solo el mes de inicio del proyecto: los demás meses cerrados se recortan', () => {
  // La posición arranca en septiembre, pero el proyecto empezó en julio: septiembre se recorta.
  const { porMes } = carrySplit(DOS_MESES.slice(1), '2026-10', { regla: reglaCarry('Copywriter'), mesInicio: '2026-07' })
  expect(porMes[0].libres).toBeCloseTo(5)
  expect(porMes[0].inutilizables).toBeCloseTo(5)
})

test('el primer mes sin corte mide el sobrante sin lo ampliado y su exceso sigue restando', () => {
  // 16 Excel + 10 ampliadas, 6 consumidas: el sobrante es de la base (10), todo libre.
  const ampliado = carrySplit([{ month: '2026-08', assigned: 26, ampliado: 10, consumed: 6 }], '2026-10', { regla: reglaCarry('CRM'), mesInicio: '2026-08' })
  expect(ampliado.porMes[0]).toEqual({ month: '2026-08', libres: 10, inutilizables: 0, exceso: 0 })
  // Primer mes excedido: no hay libres y el exceso descuenta del carry de los meses siguientes.
  const excedido = carrySplit(
    [{ month: '2026-08', assigned: 16, consumed: 20 }, { month: '2026-09', assigned: 16, consumed: 6 }],
    '2026-10', { regla: reglaCarry('CRM'), mesInicio: '2026-08' },
  )
  expect(excedido.porMes[0]).toEqual({ month: '2026-08', libres: 0, inutilizables: 0, exceso: 4 })
  expect(excedido.totales.carryNeto).toBe(0) // 3 libres de septiembre − 4 de exceso
})

test('si el proyecto arranca este mes, aún no hay corte', () => {
  const { porMes } = carrySplit([{ month: '2026-10', assigned: 16, consumed: 6 }], '2026-10', { regla: reglaCarry('CRM'), mesInicio: '2026-10' })
  expect(porMes).toEqual([])
})
