import { test, expect } from '@playwright/test'
import { mesesEnRango } from '../lib/horas/format'
import type { ReporteLine } from '../lib/horas/reportes-types'
import { aggregate, conMesesVacios } from '../lib/horas/reportes-types'

// Línea mínima: para agrupar por mes solo importan `date` y `hours`.
const linea = (date: string, hours: number): ReporteLine => ({
  date, project: 'Proyecto', area: 'Área', etapa: 'Etapa', department: 'Clientes',
  userId: 'u1', user: 'Usuario', position: 'Posición', hours, description: '',
  isInternal: false, historico: false,
})

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

test('aggregate por mes suma las líneas de cada mes', () => {
  const rows = aggregate([linea('2026-07-01', 2), linea('2026-07-24', 3), linea('2026-06-30', 4)], 'month')
  expect(rows).toEqual([
    { key: '2026-07', label: 'Jul 2026', hours: 5 },
    { key: '2026-06', label: 'Jun 2026', hours: 4 },
  ])
})

test('aggregate por mes ordena cronológico descendente, no por horas', () => {
  const rows = aggregate([linea('2026-06-10', 100), linea('2026-07-10', 1)], 'month')
  expect(rows.map((r) => r.key)).toEqual(['2026-07', '2026-06'])
})

test('conMesesVacios rellena a 0h el mes sin registros', () => {
  const rows = [
    { key: '2026-08', label: 'Ago 2026', hours: 10 },
    { key: '2026-06', label: 'Jun 2026', hours: 20 },
  ]
  expect(conMesesVacios(rows, '2026-06-01', '2026-08-31')).toEqual([
    { key: '2026-08', label: 'Ago 2026', hours: 10 },
    { key: '2026-07', label: 'Jul 2026', hours: 0 },
    { key: '2026-06', label: 'Jun 2026', hours: 20 },
  ])
})

test('conMesesVacios no duplica un mes que ya venía', () => {
  const rows = [{ key: '2026-07', label: 'Jul 2026', hours: 5 }]
  expect(conMesesVacios(rows, '2026-07-01', '2026-07-24')).toEqual(rows)
})

// Sin ninguna línea, la tabla debe seguir mostrando su estado vacío. Un rango de tres
// años daría 36 filas huecas que no dicen nada.
test('conMesesVacios sin filas no inventa meses', () => {
  expect(conMesesVacios([], '2024-01-01', '2026-12-31')).toEqual([])
})
