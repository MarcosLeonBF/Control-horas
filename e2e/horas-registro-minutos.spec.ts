import { test, expect } from '@playwright/test'
import { horasAMinutos, minutosAHoras } from '../lib/horas/format'

// El caso que motivó la feature: 10 minutos no caben exactos en centésimas de hora
// (0,1666…), y la decisión tomada es redondear.
test('minutosAHoras redondea 10 minutos a centesimas', () => {
  expect(minutosAHoras(10)).toBe(0.17)
})

test('minutosAHoras es exacto en los multiplos de 3 minutos', () => {
  expect(minutosAHoras(15)).toBe(0.25)
  expect(minutosAHoras(30)).toBe(0.5)
  expect(minutosAHoras(3)).toBe(0.05)
})

// Un minuto tiene que dar algo > 0: la RPC rechaza `horas <= 0`.
test('minutosAHoras de un minuto no cae a cero', () => {
  expect(minutosAHoras(1)).toBe(0.02)
})

test('minutosAHoras redondea hacia abajo cuando toca', () => {
  // 20 min = 0,3333… → 0,33
  expect(minutosAHoras(20)).toBe(0.33)
})

test('minutosAHoras de cero es cero', () => {
  expect(minutosAHoras(0)).toBe(0)
})

test('horasAMinutos convierte a minutos enteros', () => {
  expect(horasAMinutos(2)).toBe(120)
  expect(horasAMinutos(0.5)).toBe(30)
})

// El valor guardado de "10 minutos" tiene que volver a leerse como 10 minutos, o el
// campo mostraría 10,2 al cambiar de unidad.
test('horasAMinutos redondea el valor guardado de 10 minutos', () => {
  expect(horasAMinutos(0.17)).toBe(10)
})

test('el viaje de ida y vuelta de 10 minutos cierra', () => {
  expect(horasAMinutos(minutosAHoras(10))).toBe(10)
})

test('el viaje de ida y vuelta de 2 horas cierra', () => {
  expect(minutosAHoras(horasAMinutos(2))).toBe(2)
})

// El campo se repinta desde `hours` mientras se escribe, así que la proyección a
// minutos tiene que ser estable para CUALQUIER entero: si no, escribir 25 mostraría
// 25,2 y el número bailaría bajo el cursor.
test('la proyeccion a minutos es estable para todos los enteros de una jornada', () => {
  for (let min = 1; min <= 600; min++) {
    expect(horasAMinutos(minutosAHoras(min))).toBe(min)
  }
})
