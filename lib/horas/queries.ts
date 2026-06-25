import { createClient } from '@/lib/supabase/server'
import type { AreaRow, EtapaRow } from '@/lib/horas/types'

export async function getCatalogos(): Promise<{ areas: AreaRow[]; etapas: EtapaRow[] }> {
  const supabase = await createClient()
  const [{ data: areas }, { data: etapas }] = await Promise.all([
    supabase.from('areas').select('id,name,is_internal').eq('active', true).order('name'),
    supabase.from('etapas').select('id,name').eq('active', true).order('name'),
  ])
  return { areas: areas ?? [], etapas: etapas ?? [] }
}

export async function getMyAreas(userId: string): Promise<AreaRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('user_areas')
    .select('areas(id,name,is_internal)')
    .eq('user_id', userId)
  return (data ?? []).map((r: { areas: AreaRow }) => r.areas)
}
