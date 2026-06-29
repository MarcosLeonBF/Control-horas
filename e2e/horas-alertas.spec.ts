import { test, expect } from '@playwright/test'
import { nivelesAlcanzados, masSevero, mensajeAlerta } from '../lib/horas/alertas-core'

test('por debajo del 80% no se alcanza ningún umbral', () => {
  expect(nivelesAlcanzados(100, 79.9)).toEqual([])
})

test('al 80% se alcanza el umbral 80', () => {
  expect(nivelesAlcanzados(100, 80)).toEqual(['80'])
})

test('al 100% se alcanzan 80 y 100', () => {
  expect(nivelesAlcanzados(100, 100)).toEqual(['80', '100'])
})

test('por encima del 100% se alcanzan los tres', () => {
  expect(nivelesAlcanzados(100, 120)).toEqual(['80', '100', 'exceso'])
})

test('sin presupuesto asignado no se alerta', () => {
  expect(nivelesAlcanzados(0, 5)).toEqual([])
})

test('masSevero elige el umbral más alto', () => {
  expect(masSevero(['80', '100', 'exceso'])).toBe('exceso')
  expect(masSevero(['80'])).toBe('80')
  expect(masSevero([])).toBeNull()
})

test('el mensaje de exceso reporta contratadas, consumidas y exceso', () => {
  const m = mensajeAlerta('Droident', 'exceso', 100, 130)
  expect(m).toContain('Droident')
  expect(m).toContain('Contratadas: 100')
  expect(m).toContain('exceso: 30')
})
