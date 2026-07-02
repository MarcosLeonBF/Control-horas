import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CatalogosPanel, { type CatalogoRow, type PosicionRow } from '@/components/horas/CatalogosPanel'

export default async function CatalogosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/registrar')

  const [{ data: areas }, { data: etapas }, { data: descripciones }, { data: departamentos }, { data: positions }, { data: posAreas }, { data: posEtapas }, { data: posDescripciones }, { data: posDepartamentos }, { data: depEtapas }] = await Promise.all([
    supabase.from('areas').select('id, name, active, is_internal').order('name'),
    supabase.from('etapas').select('id, name, active').order('name'),
    supabase.from('descripciones').select('id, name, active').order('name'),
    supabase.from('departamentos').select('id, name, active').order('name'),
    supabase.from('positions').select('id, name, active').order('name'),
    supabase.from('position_areas').select('position_id, area_id'),
    supabase.from('position_etapas').select('position_id, etapa_id'),
    supabase.from('position_descripciones').select('position_id, descripcion_id'),
    supabase.from('position_departamentos').select('position_id, departamento_id'),
    supabase.from('departamento_etapas').select('departamento_id, etapa_id'),
  ])

  const posiciones: PosicionRow[] = (positions ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    active: p.active as boolean,
    areaIds: (posAreas ?? []).filter((pa) => pa.position_id === p.id).map((pa) => pa.area_id as string),
    etapaIds: (posEtapas ?? []).filter((pe) => pe.position_id === p.id).map((pe) => pe.etapa_id as string),
    descripcionIds: (posDescripciones ?? []).filter((pd) => pd.position_id === p.id).map((pd) => pd.descripcion_id as string),
    departamentoIds: (posDepartamentos ?? []).filter((pd) => pd.position_id === p.id).map((pd) => pd.departamento_id as string),
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
        <p className="mt-1 text-sm text-muted-foreground">
          Posiciones, áreas, etapas y departamentos del registro de horas. Los proyectos y bancos vienen del Excel.
        </p>
      </header>

      <CatalogosPanel
        posiciones={posiciones}
        areas={(areas ?? []) as CatalogoRow[]}
        etapas={(etapas ?? []) as CatalogoRow[]}
        descripciones={(descripciones ?? []) as CatalogoRow[]}
        departamentos={depsConEtapas}
      />
    </div>
  )
}
