import { test, expect } from '@playwright/test'
import { aPerfil, managerDe, managerPorNombre, type Perfil } from '../lib/avisos/personas'

type Raw = Parameters<typeof aPerfil>[0]
const perfil = (id: string, nombre: string, extra: Partial<Raw> = {}): Perfil => aPerfil({
  id, full_name: nombre, email: `${id}@ejemplo.com`, role: 'manager', status: 'activo', manager_id: null,
  created_at: '2026-07-01T10:00:00Z', registro_dias_atras: null, positions: { name: 'CRM' },
  equipos: { name: 'Clientes' }, slack_id: null, ...extra,
})
const mapa = (...ps: Perfil[]) => new Map(ps.map((p) => [p.persona.id, p]))

test('aPerfil: posición y equipo (objeto o lista), Slack, día de alta en Madrid y estado', () => {
  const a = perfil('u1', 'Laura Gómez', {
    created_at: '2026-09-13T23:30:00Z', positions: [{ name: 'SEO Strategist' }], equipos: [{ name: 'RRHH' }],
    slack_id: 'U01LAURA001', status: 'inactivo',
  })
  expect(a.persona).toEqual({
    id: 'u1', nombre: 'Laura Gómez', email: 'u1@ejemplo.com', posicion: 'SEO Strategist', equipo: 'RRHH',
    slack_id: 'U01LAURA001', rol: 'manager',
  })
  expect(a.alta).toBe('2026-09-14') // 23:30 UTC = 01:30 del día siguiente en Madrid (verano)
  expect(a.activo).toBe(false)
  expect(perfil('u2', 'Sin Posición', { positions: null }).persona.posicion).toBeNull()
  // Nadie tiene equipo ni Slack hasta que el admin los asigne (0049, 0050): null es el
  // caso normal al principio, no un error, y el aviso tiene que salir igual.
  expect(perfil('u3', 'Sin Equipo', { equipos: null }).persona.equipo).toBeNull()
  expect(perfil('u4', 'Sin Slack').persona.slack_id).toBeNull()
})

test('managerDe: el manager directo si existe', () => {
  const jefe = perfil('m1', 'Carlos Ruiz', { equipos: { name: 'RRHH' }, slack_id: 'U01CARLOS01' })
  const laura = perfil('u1', 'Laura Gómez', { manager_id: 'm1', slack_id: 'U01LAURA001' })
  const todos = mapa(jefe, laura)
  // El manager lleva SU equipo y SU Slack, no los de la persona avisada: es a él a quien
  // hay que enrutar el mensaje y mencionar.
  expect(managerDe(laura, todos)).toEqual({
    id: 'm1', nombre: 'Carlos Ruiz', email: 'm1@ejemplo.com', equipo: 'RRHH', slack_id: 'U01CARLOS01',
  })
  expect(managerDe(jefe, todos)).toBeNull()
  expect(managerDe(perfil('u3', 'Huérfano', { manager_id: 'no-existe' }), todos)).toBeNull()
})

test('managerPorNombre: sin mayúsculas ni espacios; ambiguo o desconocido sin email', () => {
  const todos = mapa(perfil('m1', 'Carlos Ruiz', { slack_id: 'U01CARLOS01' }), perfil('m2', 'Ana Pérez'), perfil('m3', 'Ana Pérez'))
  expect(managerPorNombre('  carlos ruiz ', todos)).toEqual({
    id: 'm1', nombre: 'Carlos Ruiz', email: 'm1@ejemplo.com', equipo: 'Clientes', slack_id: 'U01CARLOS01',
  })
  // Ambiguo o desconocido: equipo y Slack van a null porque no se sabe de quién es, igual
  // que el email. Inventar uno sería peor que no mandarlo (mencionaría a otra persona).
  expect(managerPorNombre('Ana Pérez', todos)).toEqual({ id: null, nombre: 'Ana Pérez', email: null, equipo: null, slack_id: null })
  expect(managerPorNombre('Pilar', todos)).toEqual({ id: null, nombre: 'Pilar', email: null, equipo: null, slack_id: null })
  expect(managerPorNombre('', todos)).toBeNull()
  expect(managerPorNombre(undefined, todos)).toBeNull()
})
