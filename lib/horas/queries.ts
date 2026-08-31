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

// ── Catálogo de la posición ───────────────────────────────────────────────────
// Todo lo que la POSICIÓN de un usuario aporta al formulario de registro, en UNA
// consulta. Antes eran cinco funciones y diez viajes: cada una releía por su cuenta el
// mismo profiles.position_id y luego pedía su tabla, y en /registrar se esperaban en
// fila. Salían 350 lecturas de `profiles` en 24 h y unos dos segundos de espera pura
// por carga. PostgREST resuelve el árbol entero de una vez por las claves ajenas.
export interface CatalogoDePosicion {
  positionName: string | null
  areas: AreaRow[]          // áreas de la posición: de aquí sale el área de cada línea
  etapaIds: string[]        // etapas seleccionables en un proyecto de cliente
  departamentoIds: string[] // departamentos del proyecto interno "Departamento"
  descripciones: string[]   // descripciones ESPECÍFICAS y activas de la posición (0044)
  descripcionLibre: boolean // puede escribir la descripción a mano en "Departamento" (0044)
}

const SIN_POSICION: CatalogoDePosicion = {
  positionName: null, areas: [], etapaIds: [], departamentoIds: [], descripciones: [], descripcionLibre: false,
}

// Forma del embed anidado. Supabase tipa los to-one como array pero en runtime son
// objetos: de ahí el cast por unknown, igual que en reportes.ts y bancos.ts.
interface DescripcionAnidada { name: string; active: boolean; alcance: string }
interface PosicionAnidada {
  name: string
  descripcion_libre: boolean
  position_areas: { areas: AreaRow | null }[]
  position_etapas: { etapa_id: string }[]
  position_departamentos: { departamento_id: string }[]
  position_descripciones: { descripciones: DescripcionAnidada | null }[]
}

export async function getCatalogoDePosicion(userId: string): Promise<CatalogoDePosicion> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select(`
      positions (
        name,
        descripcion_libre,
        position_areas ( areas ( id, name, is_internal ) ),
        position_etapas ( etapa_id ),
        position_departamentos ( departamento_id ),
        position_descripciones ( descripciones ( name, active, alcance ) )
      )
    `)
    .eq('id', userId)
    .single()

  // El error NO se descarta. Si el embed dejara de resolver, descartarlo devolvería un
  // catálogo vacío y el formulario aparecería sin áreas ni etapas, como si el usuario
  // no tuviera posición: un fallo mudo justo donde más cuesta verlo.
  if (error) throw new Error(`No se pudo leer el catálogo de la posición: ${error.message}`)

  const pos = (data as unknown as { positions: PosicionAnidada | null } | null)?.positions
  if (!pos) return SIN_POSICION

  return {
    positionName: pos.name,
    areas: (pos.position_areas ?? []).map((r) => r.areas).filter((a): a is AreaRow => !!a),
    etapaIds: (pos.position_etapas ?? []).map((r) => r.etapa_id),
    departamentoIds: (pos.position_departamentos ?? []).map((r) => r.departamento_id),
    // Solo específicas y activas: una desactivada desaparece del desplegable aunque siga
    // asignada, y una que volvió a general ya la trae getCatalogos —contarla aquí la duplicaría.
    descripciones: (pos.position_descripciones ?? [])
      .map((r) => r.descripciones)
      .filter((d): d is DescripcionAnidada => !!d && d.active && d.alcance === 'posicion')
      .map((d) => d.name),
    descripcionLibre: pos.descripcion_libre === true,
  }
}
