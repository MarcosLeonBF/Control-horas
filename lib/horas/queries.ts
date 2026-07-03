import { createClient } from '@/lib/supabase/server'
import type { AreaRow, EtapaRow, DepartamentoRow } from '@/lib/horas/types'

export async function getCatalogos(): Promise<{ areas: AreaRow[]; etapas: EtapaRow[]; descripciones: string[]; departamentos: DepartamentoRow[] }> {
  const supabase = await createClient()
  const [{ data: areas }, { data: etapas }, { data: descripciones }, { data: deps }, { data: depEtapas }] = await Promise.all([
    supabase.from('areas').select('id,name,is_internal').eq('active', true).order('name'),
    supabase.from('etapas').select('id,name').eq('active', true).order('name'),
    supabase.from('descripciones').select('name').eq('active', true).order('name'),
    supabase.from('departamentos').select('id,name,active').eq('active', true).order('name'),
    supabase.from('departamento_etapas').select('departamento_id,etapa_id')
  ])

  const departamentos: DepartamentoRow[] = (deps ?? []).map(d => ({
    id: d.id as string,
    name: d.name as string,
    active: d.active as boolean,
    etapaIds: (depEtapas ?? []).filter(de => de.departamento_id === d.id).map(de => de.etapa_id as string),
  }))

  // Descripciones del proyecto "Departamento": lista general (activas), compartida por todos.
  const descripcionesNombres = (descripciones ?? []).map((d) => d.name as string)

  return { areas: areas ?? [], etapas: etapas ?? [], descripciones: descripcionesNombres, departamentos }
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

// Áreas de la POSICIÓN del usuario. Al registrar, el área de cada línea de proyecto
// cliente sale de aquí (la posición define las áreas a las que se pertenece), para todos
// los roles. user_areas (getMyAreas) queda solo como la visibilidad del manager.
export async function getMyPositionAreas(userId: string): Promise<AreaRow[]> {
  const supabase = await createClient()
  const { data: me } = await supabase.from('profiles').select('position_id').eq('id', userId).single()
  if (!me?.position_id) return []
  const { data } = await supabase
    .from('position_areas')
    .select('areas(id,name,is_internal)')
    .eq('position_id', me.position_id)
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
