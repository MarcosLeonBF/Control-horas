import { createAdminClient } from '@/lib/supabase/admin'
import type { ViewerScope } from '@/lib/horas/scope'

export interface MiembroEquipo { name: string; status: 'activo' | 'inactivo' }
export interface AreaEquipo {
  area: string
  managers: MiembroEquipo[]
  operativos: MiembroEquipo[]
}

// Composición del equipo por área (PDF §9/§15). El "equipo" emerge de las áreas:
//   admin   → estructura global: todas las áreas con sus managers y operativos
//   manager → solo sus áreas, con los miembros que las comparten
// Se lee con el cliente admin y se acota por el alcance del que mira.
export interface ComposicionEquipo {
  areas: AreaEquipo[]
  totalPersonas: number // personas ÚNICAS (un usuario en varias áreas cuenta una vez)
}

export async function getEquipoComposicion(scope: ViewerScope): Promise<ComposicionEquipo> {
  if (scope.role === 'operativo') return { areas: [], totalPersonas: 0 }
  const db = createAdminClient()

  // Áreas objetivo: las del manager, o todas las no internas para el admin.
  let areaIds: string[]
  if (scope.role === 'manager') {
    areaIds = scope.areaIds
  } else {
    const { data: areas } = await db.from('areas').select('id').eq('active', true).eq('is_internal', false)
    areaIds = (areas ?? []).map((a) => a.id as string)
  }
  if (!areaIds.length) return { areas: [], totalPersonas: 0 }

  // La pertenencia sale de la POSICIÓN (position_areas, modelo 0028): cada persona
  // aparece en todas las áreas de su posición. user_areas ya no gobierna la composición
  // (quedó como visibilidad del manager, y los operativos ni siquiera tienen filas).
  const [{ data: areaRows }, { data: posAreas }] = await Promise.all([
    db.from('areas').select('id, name').in('id', areaIds),
    db.from('position_areas').select('position_id, area_id').in('area_id', areaIds),
  ])
  const positionIds = [...new Set((posAreas ?? []).map((r) => r.position_id as string))]
  if (!positionIds.length) return { areas: [], totalPersonas: 0 }

  const { data: gente } = await db
    .from('profiles')
    .select('id, full_name, role, status, position_id')
    .in('position_id', positionIds)
    .in('role', ['manager', 'operativo'])

  const nombreArea = new Map((areaRows ?? []).map((a) => [a.id as string, a.name as string]))
  const areasPorPosicion = new Map<string, string[]>()
  for (const r of (posAreas ?? []) as { position_id: string; area_id: string }[]) {
    if (!areasPorPosicion.has(r.position_id)) areasPorPosicion.set(r.position_id, [])
    areasPorPosicion.get(r.position_id)!.push(r.area_id)
  }

  type Perfil = { id: string; full_name: string | null; role: string; status: string; position_id: string | null }
  const byArea = new Map<string, AreaEquipo>()
  const personas = new Set<string>() // ids únicos de quienes mostramos
  for (const p of (gente ?? []) as Perfil[]) {
    const miembro: MiembroEquipo = { name: p.full_name || '—', status: p.status === 'inactivo' ? 'inactivo' : 'activo' }
    for (const areaId of areasPorPosicion.get(p.position_id ?? '') ?? []) {
      const areaName = nombreArea.get(areaId) ?? '—'
      if (!byArea.has(areaName)) byArea.set(areaName, { area: areaName, managers: [], operativos: [] })
      const entry = byArea.get(areaName)!
      if (p.role === 'manager') entry.managers.push(miembro)
      else entry.operativos.push(miembro)
      personas.add(p.id)
    }
  }

  const sortMiembros = (m: MiembroEquipo[]) => m.sort((a, b) => a.name.localeCompare(b.name))
  const areas = [...byArea.values()]
    .map((e) => ({ ...e, managers: sortMiembros(e.managers), operativos: sortMiembros(e.operativos) }))
    .sort((a, b) => a.area.localeCompare(b.area))
  return { areas, totalPersonas: personas.size }
}
