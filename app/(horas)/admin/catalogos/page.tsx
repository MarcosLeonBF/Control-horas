import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CatalogosPanel, { type CatalogoRow, type PosicionRow, type DescripcionRow } from '@/components/horas/CatalogosPanel'

export default async function CatalogosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/registrar')

  const [{ data: areas }, { data: etapas }, { data: descripciones, error: descripcionesError }, { data: departamentos }, { data: positions }, { data: posAreas }, { data: posEtapas }, { data: posDepartamentos }, { data: depEtapas }, { data: posDescripciones, error: posDescripcionesError }] = await Promise.all([
    supabase.from('areas').select('id, name, active, is_internal').order('name'),
    supabase.from('etapas').select('id, name, active').order('name'),
    supabase.from('descripciones').select('id, name, active, alcance').order('name'),
    supabase.from('departamentos').select('id, name, active').order('name'),
    supabase.from('positions').select('id, name, active, descripcion_libre').order('name'),
    supabase.from('position_areas').select('position_id, area_id'),
    supabase.from('position_etapas').select('position_id, etapa_id'),
    supabase.from('position_departamentos').select('position_id, departamento_id'),
    supabase.from('departamento_etapas').select('departamento_id, etapa_id'),
    supabase.from('position_descripciones').select('position_id, descripcion_id'),
  ])

  const posiciones: PosicionRow[] = (positions ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    active: p.active as boolean,
    areaIds: (posAreas ?? []).filter((pa) => pa.position_id === p.id).map((pa) => pa.area_id as string),
    etapaIds: (posEtapas ?? []).filter((pe) => pe.position_id === p.id).map((pe) => pe.etapa_id as string),
    departamentoIds: (posDepartamentos ?? []).filter((pd) => pd.position_id === p.id).map((pd) => pd.departamento_id as string),
    descripcionLibre: (p.descripcion_libre as boolean) ?? false,
  }))

  // Los errores de estas dos NO se descartan: piden lo que añade la 0044 (la columna
  // `alcance` y la tabla de vínculos), así que si la migración no está aplicada fallan.
  // Descartarlos pintaría la sección vacía, como si no hubiera descripciones.
  if (descripcionesError) throw new Error(`No se pudieron leer las descripciones: ${descripcionesError.message}`)
  if (posDescripcionesError) throw new Error(`No se pudieron leer las descripciones por posición: ${posDescripcionesError.message}`)

  // Cada descripción con su alcance y, si es específica, las posiciones que la ven (0044).
  const descripcionesConPosiciones: DescripcionRow[] = (descripciones ?? []).map((d) => ({
    id: d.id as string,
    name: d.name as string,
    active: d.active as boolean,
    alcance: (d.alcance as 'general' | 'posicion') ?? 'general',
    positionIds: (posDescripciones ?? []).filter((pd) => pd.descripcion_id === d.id).map((pd) => pd.position_id as string),
  }))

  const depsConEtapas = (departamentos ?? []).map((d) => ({
    id: d.id as string,
    name: d.name as string,
    active: d.active as boolean,
    etapaIds: (depEtapas ?? []).filter((de) => de.departamento_id === d.id).map((de) => de.etapa_id as string),
  }))

  return (
    <div className="space-y-7">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Catálogos</h1>
        {/* Antes esto era el inventario de las secciones de abajo, que ya se ven. Decir
            cómo encajan entre sí es lo que no se puede deducir mirando la página. */}
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Una posición define qué puede registrar cada persona: sus áreas, sus etapas, sus departamentos y sus
          descripciones. Lo demás son las listas de las que se nutre. Los proyectos y los bancos vienen del Excel.
        </p>
      </header>

      <CatalogosPanel
        posiciones={posiciones}
        areas={(areas ?? []) as CatalogoRow[]}
        etapas={(etapas ?? []) as CatalogoRow[]}
        descripciones={descripcionesConPosiciones}
        departamentos={depsConEtapas}
      />
    </div>
  )
}
