import { test, expect } from '@playwright/test'
import { computeHorasStatus, groupBancosByProject, type BancoHorasRow } from '../lib/horas/bancos-status'

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
