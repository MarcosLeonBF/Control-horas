import { test, expect } from '@playwright/test'
import { mesesEnRango } from '../lib/horas/format'
import type { ReporteLine } from '../lib/horas/reportes-types'
import { aggregate, conMesesVacios, detalleDeLinea, ordenInicial, ordenarFilas } from '../lib/horas/reportes-types'

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

// Línea a medida: aquí lo que importa son `etapa`, `description` e `historico`.
const conDetalle = (etapa: string, description: string, historico = false): ReporteLine => ({
  date: '2026-07-15', project: 'Vancubic', area: 'Área', etapa, department: 'Clientes',
  userId: 'u1', user: 'Usuario', position: 'Posición', hours: 1, description,
  isInternal: false, historico,
})

test('detalleDeLinea junta etapa y motivo con un punto medio', () => {
  expect(detalleDeLinea(conDetalle('Servicios Mensuales', 'Ajustes del CRM')))
    .toBe('Servicios Mensuales · Ajustes del CRM')
})

// getReporteLines rellena `etapa` con '—' cuando falta, no con cadena vacía.
test('detalleDeLinea descarta la etapa cuando vale la raya', () => {
  expect(detalleDeLinea(conDetalle('—', 'Ajustes del CRM'))).toBe('Ajustes del CRM')
})

test('detalleDeLinea sin motivo deja solo la etapa, sin separador colgando', () => {
  expect(detalleDeLinea(conDetalle('Desarrollo', ''))).toBe('Desarrollo')
})

test('detalleDeLinea rotula el historico donde iria el motivo', () => {
  expect(detalleDeLinea(conDetalle('Servicios Mensuales', '', true)))
    .toBe('Servicios Mensuales · Histórico')
})

test('detalleDeLinea sin nada que decir devuelve cadena vacia', () => {
  expect(detalleDeLinea(conDetalle('—', ''))).toBe('')
})

const FILAS = [
  { key: 'b', label: 'Bravo', hours: 5 },
  { key: 'a', label: 'Alfa', hours: 20 },
  { key: 'c', label: 'Charlie', hours: 12 },
]
const porLabel = (r: { label: string }) => r.label

test('ordenarFilas sin orden devuelve las filas tal cual', () => {
  expect(ordenarFilas(FILAS, null, porLabel, 'project')).toEqual(FILAS)
})

test('ordenarFilas por horas descendente', () => {
  expect(ordenarFilas(FILAS, { col: 'hours', dir: 'desc' }, porLabel, 'project').map((r) => r.hours)).toEqual([20, 12, 5])
})

test('ordenarFilas por horas ascendente', () => {
  expect(ordenarFilas(FILAS, { col: 'hours', dir: 'asc' }, porLabel, 'project').map((r) => r.hours)).toEqual([5, 12, 20])
})

test('ordenarFilas alfabetico usa la etiqueta que recibe, no row.label', () => {
  // La tabla muestra el nombre con email en los homónimos: el orden debe seguir a eso.
  const visible = (r: { key: string }) => ({ a: 'Zeta', b: 'Alfa', c: 'Mike' })[r.key] ?? ''
  expect(ordenarFilas(FILAS, { col: 'label', dir: 'asc' }, visible, 'user').map((r) => r.key)).toEqual(['b', 'c', 'a'])
})

test('ordenarFilas no muta el array que recibe', () => {
  const original = [...FILAS]
  ordenarFilas(FILAS, { col: 'hours', dir: 'asc' }, porLabel, 'project')
  expect(FILAS).toEqual(original)
})

// En Día y Mes la etiqueta es la fecha ya escrita para leerla (DD/MM/AAAA, "Jul 2026").
// Ordenar ESE texto ordena por el número del día y va saltando de mes en mes; el orden
// tiene que salir de la clave ISO, que es el valor del que la etiqueta es un dibujo.
const DIAS = [
  { key: '2026-07-05', label: '05/07/2026', hours: 1 },
  { key: '2026-08-02', label: '02/08/2026', hours: 2 },
  { key: '2026-06-30', label: '30/06/2026', hours: 3 },
]

test('ordenarFilas por etiqueta en una dimension de tiempo ordena cronologico', () => {
  expect(ordenarFilas(DIAS, { col: 'label', dir: 'asc' }, porLabel, 'date').map((r) => r.key))
    .toEqual(['2026-06-30', '2026-07-05', '2026-08-02'])
})

test('ordenarFilas por etiqueta en tiempo descendente pone lo mas reciente arriba', () => {
  expect(ordenarFilas(DIAS, { col: 'label', dir: 'desc' }, porLabel, 'date').map((r) => r.key))
    .toEqual(['2026-08-02', '2026-07-05', '2026-06-30'])
})

// La marca de tiempo no puede colarse en las demás dimensiones: ahí la clave es un id
// o un nombre, y el orden lo sigue mandando lo que se ve.
test('ordenarFilas fuera del tiempo sigue ordenando por la etiqueta visible', () => {
  const visible = (r: { key: string }) => ({ a: 'Zeta', b: 'Alfa', c: 'Mike' })[r.key] ?? ''
  expect(ordenarFilas(FILAS, { col: 'label', dir: 'asc' }, visible, 'position').map((r) => r.key))
    .toEqual(['b', 'c', 'a'])
})

// Ordenar por horas no cambia en las dimensiones de tiempo.
test('ordenarFilas por horas en tiempo sigue ordenando por horas', () => {
  expect(ordenarFilas(DIAS, { col: 'hours', dir: 'desc' }, porLabel, 'date').map((r) => r.hours))
    .toEqual([3, 2, 1])
})

// Dirección del PRIMER clic en una cabecera (el segundo siempre invierte).
test('ordenInicial de la columna de horas es de mayor a menor', () => {
  expect(ordenInicial('hours', 'project')).toBe('desc')
})

test('ordenInicial de una etiqueta de texto es A→Z', () => {
  expect(ordenInicial('label', 'project')).toBe('asc')
})

// En Día y Mes la tabla ya entra con lo más reciente arriba: que el primer clic
// mandara al año pasado sería un salto, no una ordenación.
test('ordenInicial en Dia empieza por lo mas reciente', () => {
  expect(ordenInicial('label', 'date')).toBe('desc')
})

test('ordenInicial en Mes empieza por lo mas reciente', () => {
  expect(ordenInicial('label', 'month')).toBe('desc')
})
