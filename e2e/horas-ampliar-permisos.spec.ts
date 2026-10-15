import { test, expect } from '@playwright/test'
import { esManagerDelProyecto, errorAlAmpliar, puedeAnular } from '../lib/horas/ampliar-permisos'

// Quién amplía y quién anula horas del banco (spec 2026-10-15-ampliaciones-por-posicion).
const candidatos = [
  { id: 'u-antonio', full_name: 'Antonio Parrilla' },
  { id: 'u-jen', full_name: 'Jennifer Arias' },
  { id: 'u-ana1', full_name: 'Ana López' },
  { id: 'u-ana2', full_name: 'Ana Martín' },
]

test('esManagerDelProyecto: el Excel trae el nombre de pila y casa con el perfil', () => {
  expect(esManagerDelProyecto('Antonio', 'u-antonio', candidatos)).toBe(true)
  expect(esManagerDelProyecto('Antonio Parrilla', 'u-antonio', candidatos)).toBe(true)
  expect(esManagerDelProyecto('Antonio', 'u-jen', candidatos)).toBe(false)
})

test('esManagerDelProyecto: sin nombre o con dos que casan, no es nadie', () => {
  expect(esManagerDelProyecto(undefined, 'u-antonio', candidatos)).toBe(false)
  expect(esManagerDelProyecto('  ', 'u-antonio', candidatos)).toBe(false)
  expect(esManagerDelProyecto('Ana', 'u-ana1', candidatos)).toBe(false) // ambiguo: dos Anas
})

const alcance = ['CRM', 'SEO Strategist']

test('errorAlAmpliar: el admin amplía en cualquier proyecto, en una posición del catálogo', () => {
  expect(errorAlAmpliar({ role: 'admin', esManagerDelProyecto: false, position: 'CRM', posicionesAlcance: alcance })).toBeNull()
})

test('errorAlAmpliar: el manager, solo si es el manager del proyecto y la posición es de sus áreas', () => {
  expect(errorAlAmpliar({ role: 'manager', esManagerDelProyecto: true, position: 'CRM', posicionesAlcance: alcance })).toBeNull()
  expect(errorAlAmpliar({ role: 'manager', esManagerDelProyecto: false, position: 'CRM', posicionesAlcance: alcance }))
    .toMatch(/manager del proyecto/)
  expect(errorAlAmpliar({ role: 'manager', esManagerDelProyecto: true, position: 'Paid Media', posicionesAlcance: alcance }))
    .toMatch(/posición/)
})

test('errorAlAmpliar: si no se pudo leer el Excel, el manager no amplía (y el admin sí)', () => {
  expect(errorAlAmpliar({ role: 'manager', esManagerDelProyecto: null, position: 'CRM', posicionesAlcance: alcance }))
    .toMatch(/No se pudo comprobar/)
  expect(errorAlAmpliar({ role: 'admin', esManagerDelProyecto: null, position: 'CRM', posicionesAlcance: alcance })).toBeNull()
})

test('errorAlAmpliar: posición obligatoria; el operativo nunca amplía', () => {
  expect(errorAlAmpliar({ role: 'admin', esManagerDelProyecto: null, position: ' ', posicionesAlcance: alcance })).toMatch(/posición/)
  expect(errorAlAmpliar({ role: 'operativo', esManagerDelProyecto: true, position: 'CRM', posicionesAlcance: alcance })).toMatch(/No autorizado/)
})

test('puedeAnular: el admin, cualquiera; el manager, solo las suyas', () => {
  expect(puedeAnular('admin', 'u-admin', 'u-otro')).toBe(true)
  expect(puedeAnular('admin', 'u-admin', null)).toBe(true)
  expect(puedeAnular('manager', 'u-antonio', 'u-antonio')).toBe(true)
  expect(puedeAnular('manager', 'u-antonio', 'u-jen')).toBe(false)
  expect(puedeAnular('manager', 'u-antonio', null)).toBe(false)
  expect(puedeAnular('operativo', 'u-x', 'u-x')).toBe(false)
})
