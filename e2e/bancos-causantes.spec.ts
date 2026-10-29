import { test, expect } from '@playwright/test'
import { computeHorasStatus, filaDeMeses, groupBancosByProject, mesesPorDefecto, type BancoHorasRow } from '../lib/horas/bancos-status'

const fila = (position: string, assigned: number, consumed: number, inutilizables = 0): BancoHorasRow => ({
  project: 'P', position, assigned, consumed, inutilizables, ampliado: 0, carryNeto: 0, monthly: [],
  remaining: assigned - consumed - inutilizables, status: computeHorasStatus(assigned - inutilizables, consumed),
})

// "Bajo" sobre el total no dice en qué: se nombran las posiciones bajas o peores, la peor primero.
test('un proyecto bajo nombra las posiciones que lo dejan bajo', () => {
  const [g] = groupBancosByProject([fila('CRM', 10, 2), fila('SEO', 10, 9.5), fila('Web', 10, 11), fila('Copy', 50, 45)])
  expect(g.status).toBe('bajo')
  expect(g.causantes).toEqual(['Web', 'Copy', 'SEO'])
})

// El caso de la lista: el consumido está lejos del asignado, pero los inutilizables del
// carry dejan el banco bajo. La posición que los perdió es la que se nombra.
test('los inutilizables que dejan bajo al proyecto señalan su posición', () => {
  const [g] = groupBancosByProject([fila('CRM', 60, 20, 36), fila('SEO', 10, 8)])
  expect(g.status).toBe('bajo')
  expect(g.causantes).toEqual(['CRM'])
})

test('un proyecto excedido nombra solo las posiciones excedidas', () => {
  const [g] = groupBancosByProject([fila('A', 10, 12), fila('B', 10, 9.5)])
  expect(g.status).toBe('excedido')
  expect(g.causantes).toEqual(['A'])
})

test('un proyecto disponible no nombra ninguna', () => {
  const [g] = groupBancosByProject([fila('A', 10, 2), fila('B', 10, 9.5)])
  expect(g.status).toBe('disponible')
  expect(g.causantes).toEqual([])
})

// Vista Mensual (y avisos de banco): solo los meses elegidos, con el estado crudo. Septiembre
// perdió 4 h en el corte: descontándolas sería «bajo» (6 de 36); en crudo queda 10 de 40.
test('filaDeMeses suma solo los meses elegidos y no descuenta el corte', () => {
  const r: BancoHorasRow = {
    ...fila('CRM', 60, 50, 4),
    monthly: [
      { month: '2026-08', assigned: 20, consumed: 20 },
      { month: '2026-09', assigned: 20, consumed: 15, libres: 1, inutilizables: 4 },
      { month: '2026-10', assigned: 20, consumed: 15, ampliado: 2, provisional: true },
    ],
  }
  expect(filaDeMeses(r, new Set(['2026-09', '2026-10']))).toMatchObject({
    assigned: 40, consumed: 30, ampliado: 2, remaining: 10, status: 'disponible',
    inutilizables: 4, carryNeto: 1, provisional: true,
  })
  expect(filaDeMeses(r, new Set(['2026-11']))).toMatchObject({ assigned: 0, consumed: 0, status: 'sin_asignacion', provisional: false })
})

// Al entrar en Mensual: el mes de quien mira si tiene datos; si no, el último que los tiene.
test('mesesPorDefecto: el mes en curso, o el último con datos', () => {
  expect(mesesPorDefecto(['2026-09', '2026-10', '2026-11'], '2026-10')).toEqual(['2026-10'])
  expect(mesesPorDefecto(['2026-08', '2026-09'], '2026-10')).toEqual(['2026-09'])
  expect(mesesPorDefecto([], '2026-10')).toEqual(['2026-10'])
})
