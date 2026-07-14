import { test, expect } from '@playwright/test'
import { carrySplit, CARRY_FORWARD_PCT } from '../lib/horas/carry-forward'

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

test('la constante del corte es 25%', () => {
  expect(CARRY_FORWARD_PCT).toBe(0.25)
})
