import { test, expect } from '@playwright/test'
import { agruparDescripciones, descripcionValidaEnDepartamento, esDescripcionHuerfana } from '../lib/horas/descripciones'

// El desplegable de "Departamento" muestra las generales y, aparte, las específicas de
// la posición del usuario. Agrupar es la única lógica del lado del cliente: la regla de
// quién ve qué la impone guardar_registro (migración 0044).

test('agruparDescripciones ordena cada grupo alfabeticamente', () => {
  expect(agruparDescripciones(['Reuniones', 'Formación'], ['Keyword research', 'Auditoría'])).toEqual({
    generales: ['Formación', 'Reuniones'],
    posicion: ['Auditoría', 'Keyword research'],
  })
})

// Sin específicas el formulario tiene que verse exactamente como antes de la 0044:
// una lista plana, sin cabecera de grupo que separe nada de nada.
test('agruparDescripciones sin especificas deja el grupo de posicion vacio', () => {
  expect(agruparDescripciones(['Formación'], [])).toEqual({ generales: ['Formación'], posicion: [] })
})

// Una descripción es general O específica, nunca las dos. Si por lo que sea llegara en
// las dos listas, en el desplegable saldría dos veces: gana la de la posición.
test('agruparDescripciones no repite un nombre que llega en las dos listas', () => {
  expect(agruparDescripciones(['Formación', 'Auditoría'], ['Auditoría'])).toEqual({
    generales: ['Formación'],
    posicion: ['Auditoría'],
  })
})

test('agruparDescripciones sin nada devuelve los dos grupos vacios', () => {
  expect(agruparDescripciones([], [])).toEqual({ generales: [], posicion: [] })
})

// El panel de catálogos avisa de la específica que no llegó a asignarse: existe, está
// activa y no la ve nadie.
test('esDescripcionHuerfana marca la especifica sin posiciones', () => {
  expect(esDescripcionHuerfana({ alcance: 'posicion', positionIds: [] })).toBe(true)
})

test('esDescripcionHuerfana no marca la especifica ya asignada', () => {
  expect(esDescripcionHuerfana({ alcance: 'posicion', positionIds: ['p1'] })).toBe(false)
})

// Una general sin posiciones es lo normal, no un descuido.
test('esDescripcionHuerfana no marca una general sin posiciones', () => {
  expect(esDescripcionHuerfana({ alcance: 'general', positionIds: [] })).toBe(false)
})

// Libertad de descripción por posición (0044): con el permiso puesto, en "Departamento"
// se puede escribir a mano; sin él, hay que elegir del catálogo. Espejo de la condición
// que aplica guardar_registro; aquí sirve para no borrar lo escrito al cambiar de proyecto.
const CATALOGO = ['Formación', 'Auditoría técnica']

test('descripcionValidaEnDepartamento acepta texto a mano si la posicion tiene libertad', () => {
  expect(descripcionValidaEnDepartamento('Lo que sea', CATALOGO, true)).toBe(true)
})

// El motor exige descripción no vacía tenga o no libertad: la libertad es para escribir,
// no para dejarlo en blanco.
test('descripcionValidaEnDepartamento rechaza el vacio aun con libertad', () => {
  expect(descripcionValidaEnDepartamento('', CATALOGO, true)).toBe(false)
  expect(descripcionValidaEnDepartamento('   ', CATALOGO, true)).toBe(false)
})

// La libertad añade, no sustituye: quien la tiene sigue pudiendo elegir del catálogo.
test('descripcionValidaEnDepartamento acepta el catalogo tambien con libertad', () => {
  expect(descripcionValidaEnDepartamento('Formación', CATALOGO, true)).toBe(true)
})

test('descripcionValidaEnDepartamento sin libertad solo acepta el catalogo', () => {
  expect(descripcionValidaEnDepartamento('Formación', CATALOGO, false)).toBe(true)
  expect(descripcionValidaEnDepartamento('Lo que sea', CATALOGO, false)).toBe(false)
})
