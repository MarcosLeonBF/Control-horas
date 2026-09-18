// Personas y managers para los avisos: perfil con su posición, manager directo (0046) y
// manager del proyecto (el Excel trae un nombre suelto: se casa por nombre, como HUCHA).
import type { SupabaseClient } from '@supabase/supabase-js'
import { diaMadrid } from '@/lib/horas/auditoria-types'
import type { ManagerAviso, PersonaAviso } from '@/lib/avisos/contrato'

export interface Perfil {
  persona: PersonaAviso
  managerId: string | null
  alta: string // día del alta en Madrid (YYYY-MM-DD)
  diasAtras: number | null // ventana de registro ampliada (0043); null = la ventana por defecto
  activo: boolean
}

interface PerfilRaw {
  id: string
  full_name: string | null
  email: string | null
  role: string
  status: string
  manager_id: string | null
  created_at: string
  registro_dias_atras: number | null
  positions: { name: string } | { name: string }[] | null
  equipos: { name: string } | { name: string }[] | null
}

const SELECT_PERFIL = 'id, full_name, email, role, status, manager_id, created_at, registro_dias_atras, positions(name), equipos(name)'

export function aPerfil(r: PerfilRaw): Perfil {
  const pos = Array.isArray(r.positions) ? r.positions[0] : r.positions
  // Igual que positions: el join llega como objeto o como array de uno según cómo
  // resuelva PostgREST la relación, y se normaliza aquí y no en cada consumidor.
  const eq = Array.isArray(r.equipos) ? r.equipos[0] : r.equipos
  return {
    persona: { id: r.id, nombre: r.full_name ?? '', email: r.email ?? '', posicion: pos?.name ?? null, equipo: eq?.name ?? null, rol: r.role },
    managerId: r.manager_id,
    alta: diaMadrid(r.created_at),
    diasAtras: r.registro_dias_atras,
    activo: r.status === 'activo',
  }
}

// Todos los perfiles (son pocas decenas): hacen falta enteros para resolver los managers.
export async function perfilesPorId(db: SupabaseClient): Promise<Map<string, Perfil>> {
  const { data, error } = await db.from('profiles').select(SELECT_PERFIL)
  if (error) throw new Error(`profiles: ${error.message}`)
  return new Map(((data ?? []) as unknown as PerfilRaw[]).map((r) => [r.id, aPerfil(r)]))
}

function comoManager(p: Perfil): ManagerAviso {
  return { id: p.persona.id, nombre: p.persona.nombre, email: p.persona.email || null, equipo: p.persona.equipo }
}

export function managerDe(perfil: Perfil | undefined, todos: Map<string, Perfil>): ManagerAviso | null {
  if (!perfil?.managerId) return null
  const m = todos.get(perfil.managerId)
  return m ? comoManager(m) : null
}

// Sin coincidencia única (nadie, o dos personas con el mismo nombre) se devuelve el
// nombre del Excel sin email ni equipo: el flujo puede avisar al canal aunque no sepa
// a quién. El equipo va a null porque no se sabe de quién es, no porque no tenga.
export function managerPorNombre(nombre: string | undefined, todos: Map<string, Perfil>): ManagerAviso | null {
  const n = (nombre ?? '').trim()
  if (!n) return null
  const clave = n.toLowerCase()
  const iguales = [...todos.values()].filter((p) => p.persona.nombre.trim().toLowerCase() === clave)
  return iguales.length === 1 ? comoManager(iguales[0]) : { id: null, nombre: n, email: null, equipo: null }
}
