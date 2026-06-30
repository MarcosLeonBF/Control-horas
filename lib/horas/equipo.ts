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
export async function getEquipoComposicion(scope: ViewerScope): Promise<AreaEquipo[]> {
  if (scope.role === 'operativo') return []
  const db = createAdminClient()

  // Áreas objetivo: las del manager, o todas las no internas para el admin.
  let areaIds: string[]
  if (scope.role === 'manager') {
    areaIds = scope.areaIds
  } else {
    const { data: areas } = await db.from('areas').select('id').eq('active', true).eq('is_internal', false)
    areaIds = (areas ?? []).map((a) => a.id as string)
  }
  if (!areaIds.length) return []

  const { data } = await db
    .from('user_areas')
    .select('area_id, areas(name), profiles(full_name, role, status)')
    .in('area_id', areaIds)

  type Row = {
    area_id: string
    areas: { name: string } | null
    profiles: { full_name: string | null; role: string; status: string } | null
  }
  const byArea = new Map<string, AreaEquipo>()
  for (const r of (data ?? []) as unknown as Row[]) {
    const areaName = r.areas?.name ?? '—'
    const p = r.profiles
    if (!p) continue
    if (!byArea.has(areaName)) byArea.set(areaName, { area: areaName, managers: [], operativos: [] })
    const entry = byArea.get(areaName)!
    const miembro: MiembroEquipo = { name: p.full_name || '—', status: p.status === 'inactivo' ? 'inactivo' : 'activo' }
    if (p.role === 'manager') entry.managers.push(miembro)
    else if (p.role === 'operativo') entry.operativos.push(miembro)
  }

  const sortMiembros = (m: MiembroEquipo[]) => m.sort((a, b) => a.name.localeCompare(b.name))
  return [...byArea.values()]
    .map((e) => ({ ...e, managers: sortMiembros(e.managers), operativos: sortMiembros(e.operativos) }))
    .sort((a, b) => a.area.localeCompare(b.area))
}
