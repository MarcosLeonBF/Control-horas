import { createClient } from '@/lib/supabase/server'
import type { AreaRow, EtapaRow, DepartamentoRow } from '@/lib/horas/types'

export async function getCatalogos(): Promise<{ areas: AreaRow[]; etapas: EtapaRow[]; departamentos: DepartamentoRow[] }> {
  const supabase = await createClient()
  const [{ data: areas }, { data: etapas }, { data: deps }, { data: depEtapas }] = await Promise.all([
    supabase.from('areas').select('id,name,is_internal').eq('active', true).order('name'),
    supabase.from('etapas').select('id,name').eq('active', true).order('name'),
    supabase.from('departamentos').select('id,name').eq('active', true).order('name'),
    supabase.from('departamento_etapas').select('departamento_id,etapa_id')
  ])
  
  const departamentos = (deps ?? []).map(d => ({
    id: d.id as string,
    name: d.name as string,
    etapaIds: (depEtapas ?? []).filter(de => de.departamento_id === d.id).map(de => de.etapa_id as string)
  }))

  return { areas: areas ?? [], etapas: etapas ?? [], departamentos }
}

export async function getMyAreas(userId: string): Promise<AreaRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('user_areas')
    .select('areas(id,name,is_internal)')
    .eq('user_id', userId)
  // Supabase tipa el embed to-one como array; en runtime es un objeto. Cast como en reportes.ts/bancos.ts.
  return ((data ?? []) as unknown as { areas: AreaRow }[]).map((r) => r.areas)
}
