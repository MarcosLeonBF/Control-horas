// Personas y managers para los avisos: perfil con su posición, manager directo (0046) y
// manager del proyecto (el Excel trae un nombre suelto: se casa por nombre, como HUCHA).
import type { SupabaseClient } from '@supabase/supabase-js'
import { diaMadrid } from '@/lib/horas/auditoria-types'
import type { ActorAviso, ManagerAviso, PersonaAviso } from '@/lib/avisos/contrato'

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
  equipos: EquipoRaw
  slack_id: string | null
}

// El equipo (0049) tal como llega de un join de PostgREST: objeto o array de uno según
// cómo resuelva la relación. Se normaliza con nombreEquipo en un solo sitio, y no en
// cada consumidor (perfiles, managers de HUCHA, actor de una ampliación).
export type EquipoRaw = { name: string } | { name: string }[] | null

export function nombreEquipo(e: EquipoRaw): string | null {
  return (Array.isArray(e) ? e[0] : e)?.name ?? null
}

const SELECT_PERFIL = 'id, full_name, email, role, status, manager_id, created_at, registro_dias_atras, slack_id, positions(name), equipos(name)'

export function aPerfil(r: PerfilRaw): Perfil {
  const pos = Array.isArray(r.positions) ? r.positions[0] : r.positions
  return {
    persona: {
      id: r.id, nombre: r.full_name ?? '', email: r.email ?? '', posicion: pos?.name ?? null,
      equipo: nombreEquipo(r.equipos), slack_id: r.slack_id ?? null, rol: r.role,
    },
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

// Quien hizo una ampliación (de HUCHA o de horas), a partir del perfil que la registró.
// El nombre viene del propio movimiento —es lo que quedó guardado— y aquí solo se
// completan el email, el equipo y el Slack. Si el perfil no se encuentra (o ya no existe),
// van a null: el aviso sale igual con el nombre.
export async function actorDe(db: SupabaseClient, perfilId: string | null, nombre: string): Promise<ActorAviso> {
  if (!perfilId) return { nombre, email: null, equipo: null, slack_id: null }
  const { data } = await db.from('profiles').select('email, slack_id, equipos(name)').eq('id', perfilId).maybeSingle()
  const p = data as { email: string | null; slack_id: string | null; equipos: EquipoRaw } | null
  return { nombre, email: p?.email ?? null, equipo: nombreEquipo(p?.equipos ?? null), slack_id: p?.slack_id ?? null }
}

function comoManager(p: Perfil): ManagerAviso {
  return {
    id: p.persona.id, nombre: p.persona.nombre, email: p.persona.email || null,
    equipo: p.persona.equipo, slack_id: p.persona.slack_id,
  }
}

export function managerDe(perfil: Perfil | undefined, todos: Map<string, Perfil>): ManagerAviso | null {
  if (!perfil?.managerId) return null
  const m = todos.get(perfil.managerId)
  return m ? comoManager(m) : null
}

// Sin coincidencia única (nadie, o dos personas con el mismo nombre) se devuelve el
// nombre del Excel sin email, equipo ni Slack: el flujo puede avisar al canal aunque no
// sepa a quién. Van a null porque no se sabe de quién es, no porque no los tenga; con dos
// "Ana Pérez", mandar el Slack de una mencionaría a la persona equivocada.
export function managerPorNombre(nombre: string | undefined, todos: Map<string, Perfil>): ManagerAviso | null {
  const n = (nombre ?? '').trim()
  if (!n) return null
  const clave = n.toLowerCase()
  const iguales = [...todos.values()].filter((p) => p.persona.nombre.trim().toLowerCase() === clave)
  return iguales.length === 1 ? comoManager(iguales[0]) : { id: null, nombre: n, email: null, equipo: null, slack_id: null }
}
