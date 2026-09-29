// Personas y managers para los avisos: perfil con su posición, manager directo (0046) y
// manager del proyecto (el Excel trae un nombre suelto: se casa por nombre, como HUCHA).
import type { SupabaseClient } from '@supabase/supabase-js'
import { diaMadrid } from '@/lib/horas/auditoria-types'
import type { ActorAviso, ManagerAviso, PersonaAviso } from '@/lib/avisos/contrato'
import { ausenciasHoy, type FilaAusencia } from '@/lib/avisos/vacaciones'

export interface Perfil {
  persona: PersonaAviso
  managerId: string | null
  alta: string // día del alta en Madrid (YYYY-MM-DD)
  diasAtras: number | null // ventana de registro ampliada (0043); null = la ventana por defecto
  activo: boolean
  // De ausencia hoy según los pulsos del flujo (0054). No viaja en el payload: de quien está
  // fuera no se manda nada, y solo el manager de días sin registrar lo dice (true/false).
  ausenteHoy: boolean
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

// Las ausencias guardadas que pueden cubrir `hoy`: abiertas o terminadas hoy mismo.
export async function filasAusenciaDeHoy(db: SupabaseClient, hoy: string): Promise<FilaAusencia[]> {
  const { data, error } = await db.from('vacaciones').select('slack_id, desde, hasta, eventos')
    .lte('desde', hoy).or(`hasta.is.null,hasta.gte.${hoy}`)
  if (error) throw new Error(`vacaciones: ${error.message}`)
  return (data ?? []) as FilaAusencia[]
}

export function aPerfil(r: PerfilRaw, ausenteHoy = false): Perfil {
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
    ausenteHoy,
  }
}

// Todos los perfiles (son pocas decenas): hacen falta enteros para resolver los managers.
// `ausenciasDe`: el día en que mirar quién está de ausencia. Solo lo pasan quienes lo usan
// (días sin registrar y los avisos de registro); sin él no se consulta y ausenteHoy es false,
// para que un fallo de esa consulta no se lleve por delante avisos que no dependen de ella
// (bancos, ampliaciones, resúmenes). Con él, si falla, falla todo: sin ella, a quien está
// fuera le llegarían avisos y su manager saldría como si estuviera trabajando.
export async function perfilesPorId(db: SupabaseClient, ausenciasDe?: string): Promise<Map<string, Perfil>> {
  const [{ data, error }, filas] = await Promise.all([
    db.from('profiles').select(SELECT_PERFIL),
    ausenciasDe ? filasAusenciaDeHoy(db, ausenciasDe) : Promise.resolve([] as FilaAusencia[]),
  ])
  if (error) throw new Error(`profiles: ${error.message}`)
  const ausentes = ausenciasDe ? ausenciasHoy(filas, ausenciasDe) : new Map()
  return new Map(((data ?? []) as unknown as PerfilRaw[])
    .map((r) => [r.id, aPerfil(r, r.slack_id !== null && ausentes.has(r.slack_id))]))
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

// Equipos cuya gente no registra horas (Roberto, 2026-09-29): no reciben avisos SOBRE sí
// mismos (registro.enviado, registro.llamativo, días sin registrar). Como managers siguen
// apareciendo: las escaladas de su gente les tienen que llegar. Por el nombre del equipo del
// organigrama (0049), sin mayúsculas ni tildes; si se renombra el equipo, hay que tocar esto.
const EQUIPOS_SIN_AVISOS_PROPIOS = ['direccion', 'administracion']

function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

export function sinAvisosPropios(equipo: string | null): boolean {
  return equipo !== null && EQUIPOS_SIN_AVISOS_PROPIOS.includes(sinTildes(equipo))
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

// El manager directo de días sin registrar, con `vacaciones`: si está de ausencia hoy, el
// flujo puede mandar la escalada a otra persona. Es el único sitio del payload donde viaja.
export function managerConVacaciones(perfil: Perfil | undefined, todos: Map<string, Perfil>): (ManagerAviso & { vacaciones: boolean }) | null {
  if (!perfil?.managerId) return null
  const m = todos.get(perfil.managerId)
  return m ? { ...comoManager(m), vacaciones: m.ausenteHoy } : null
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
