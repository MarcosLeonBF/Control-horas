import { createClient } from '@/lib/supabase/server'
import type { AreaRow, EtapaRow, DepartamentoRow } from '@/lib/horas/types'

export async function getCatalogos(): Promise<{ areas: AreaRow[]; etapas: EtapaRow[]; departamentos: DepartamentoRow[] }> {
  const supabase = await createClient()
  const [{ data: areas }, { data: etapas }, { data: descripciones }, { data: deps }, { data: depEtapas }, { data: depDescr }] = await Promise.all([
    supabase.from('areas').select('id,name,is_internal').eq('active', true).order('name'),
    supabase.from('etapas').select('id,name').eq('active', true).order('name'),
    supabase.from('descripciones').select('id,name').order('name'),
    supabase.from('departamentos').select('id,name,active').eq('active', true).order('name'),
    supabase.from('departamento_etapas').select('departamento_id,etapa_id'),
    supabase.from('departamento_descripciones').select('departamento_id,descripcion_id')
  ])

  // Mapa id→nombre para resolver las descripciones de cada departamento (se guardan por nombre).
  const descNombre = new Map((descripciones ?? []).map((d) => [d.id as string, d.name as string]))

  const departamentos: DepartamentoRow[] = (deps ?? []).map(d => ({
    id: d.id as string,
    name: d.name as string,
    active: d.active as boolean,
    etapaIds: (depEtapas ?? []).filter(de => de.departamento_id === d.id).map(de => de.etapa_id as string),
    descripciones: (depDescr ?? [])
      .filter(dd => dd.departamento_id === d.id)
      .map(dd => descNombre.get(dd.descripcion_id as string))
      .filter((n): n is string => !!n),
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

// Ids de las etapas ligadas a la posición del usuario. Determinan las etapas
// seleccionables al registrar horas en un proyecto cliente. Vacío si no tiene
// posición o su posición no tiene etapas asignadas.
export async function getMyPositionEtapaIds(userId: string): Promise<string[]> {
  const supabase = await createClient()
  const { data: me } = await supabase.from('profiles').select('position_id').eq('id', userId).single()
  if (!me?.position_id) return []
  const { data } = await supabase.from('position_etapas').select('etapa_id').eq('position_id', me.position_id)
  return (data ?? []).map((r) => r.etapa_id as string)
}

// Ids de los departamentos ligados a la posición del usuario. Determinan el
// desplegable de departamento al registrar en el proyecto interno "Departamento".
export async function getMyPositionDepartamentoIds(userId: string): Promise<string[]> {
  const supabase = await createClient()
  const { data: me } = await supabase.from('profiles').select('position_id').eq('id', userId).single()
  if (!me?.position_id) return []
  const { data } = await supabase.from('position_departamentos').select('departamento_id').eq('position_id', me.position_id)
  return (data ?? []).map((r) => r.departamento_id as string)
}
