import { test, expect } from '@playwright/test'
import { aPerfil, managerDe, managerPorNombre, type Perfil } from '../lib/avisos/personas'

type Raw = Parameters<typeof aPerfil>[0]
const perfil = (id: string, nombre: string, extra: Partial<Raw> = {}): Perfil => aPerfil({
  id, full_name: nombre, email: `${id}@ejemplo.com`, role: 'manager', status: 'activo', manager_id: null,
  created_at: '2026-07-01T10:00:00Z', registro_dias_atras: null, positions: { name: 'CRM' }, ...extra,
})
const mapa = (...ps: Perfil[]) => new Map(ps.map((p) => [p.persona.id, p]))

test('aPerfil: posición (objeto o lista), día de alta en Madrid y estado', () => {
  const a = perfil('u1', 'Laura Gómez', { created_at: '2026-09-13T23:30:00Z', positions: [{ name: 'SEO Strategist' }], status: 'inactivo' })
  expect(a.persona).toEqual({ id: 'u1', nombre: 'Laura Gómez', email: 'u1@ejemplo.com', posicion: 'SEO Strategist', rol: 'manager' })
  expect(a.alta).toBe('2026-09-14') // 23:30 UTC = 01:30 del día siguiente en Madrid (verano)
  expect(a.activo).toBe(false)
  expect(perfil('u2', 'Sin Posición', { positions: null }).persona.posicion).toBeNull()
})

test('managerDe: el manager directo si existe', () => {
  const jefe = perfil('m1', 'Carlos Ruiz')
  const laura = perfil('u1', 'Laura Gómez', { manager_id: 'm1' })
  const todos = mapa(jefe, laura)
  expect(managerDe(laura, todos)).toEqual({ id: 'm1', nombre: 'Carlos Ruiz', email: 'm1@ejemplo.com' })
  expect(managerDe(jefe, todos)).toBeNull()
  expect(managerDe(perfil('u3', 'Huérfano', { manager_id: 'no-existe' }), todos)).toBeNull()
})

test('managerPorNombre: sin mayúsculas ni espacios; ambiguo o desconocido sin email', () => {
  const todos = mapa(perfil('m1', 'Carlos Ruiz'), perfil('m2', 'Ana Pérez'), perfil('m3', 'Ana Pérez'))
  expect(managerPorNombre('  carlos ruiz ', todos)).toEqual({ id: 'm1', nombre: 'Carlos Ruiz', email: 'm1@ejemplo.com' })
  expect(managerPorNombre('Ana Pérez', todos)).toEqual({ id: null, nombre: 'Ana Pérez', email: null })
  expect(managerPorNombre('Pilar', todos)).toEqual({ id: null, nombre: 'Pilar', email: null })
  expect(managerPorNombre('', todos)).toBeNull()
  expect(managerPorNombre(undefined, todos)).toBeNull()
})
