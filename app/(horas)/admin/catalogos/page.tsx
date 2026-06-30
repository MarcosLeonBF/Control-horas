import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CatalogosPanel, { type CatalogoRow, type PosicionRow } from '@/components/horas/CatalogosPanel'

export default async function CatalogosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/registrar')

  const [{ data: areas }, { data: etapas }, { data: departamentos }, { data: positions }, { data: posAreas }] = await Promise.all([
    supabase.from('areas').select('id, name, active, is_internal').order('name'),
    supabase.from('etapas').select('id, name, active').order('name'),
    supabase.from('departamentos').select('id, name, active').order('name'),
    supabase.from('positions').select('id, name, active').order('name'),
    supabase.from('position_areas').select('position_id, area_id'),
  ])

  const posiciones: PosicionRow[] = (positions ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    active: p.active as boolean,
    areaIds: (posAreas ?? []).filter((pa) => pa.position_id === p.id).map((pa) => pa.area_id as string),
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
        departamentos={(departamentos ?? []) as CatalogoRow[]}
      />
    </div>
  )
}
