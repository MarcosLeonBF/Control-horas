import { test, expect } from '@playwright/test'
import { mesesEnRango } from '../lib/horas/format'

test('mesesEnRango incluye el mes de los dos extremos', () => {
  expect(mesesEnRango('2026-06-15', '2026-08-03')).toEqual(['2026-06', '2026-07', '2026-08'])
})

test('mesesEnRango de un rango dentro del mismo mes da un solo mes', () => {
  expect(mesesEnRango('2026-07-01', '2026-07-24')).toEqual(['2026-07'])
})

test('mesesEnRango cruza el cambio de año', () => {
  expect(mesesEnRango('2025-11-20', '2026-02-05')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
})

test('mesesEnRango con hasta anterior a desde no da meses', () => {
  expect(mesesEnRango('2026-08-01', '2026-06-01')).toEqual([])
})
