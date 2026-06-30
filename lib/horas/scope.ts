import { createClient } from '@/lib/supabase/server'

// Alcance de lectura del usuario que mira (PDF §15/§17.6).
//   admin    → todo
//   manager  → su equipo = usuarios que comparten al menos un área con él
//   operativo→ solo lo suyo
export type ViewerScope =
  | { role: 'admin'; userId: string }
  | { role: 'manager'; userId: string; areaIds: string[]; teamUserIds: string[] }
  | { role: 'operativo'; userId: string }

// Equipo del manager: usuarios que comparten alguna de sus áreas (incluido él).
export async function getViewerScope(): Promise<ViewerScope | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const role = me?.role

  if (role === 'admin') return { role: 'admin', userId: user.id }

  if (role === 'manager') {
    const { data: mine } = await supabase.from('user_areas').select('area_id').eq('user_id', user.id)
    const areaIds = (mine ?? []).map((a) => a.area_id as string)

    const team = new Set<string>([user.id])
    if (areaIds.length) {
      const { data: peers } = await supabase.from('user_areas').select('user_id').in('area_id', areaIds)
      for (const p of (peers ?? []) as { user_id: string }[]) team.add(p.user_id)
    }
    return { role: 'manager', userId: user.id, areaIds, teamUserIds: [...team] }
  }

  return { role: 'operativo', userId: user.id }
}
