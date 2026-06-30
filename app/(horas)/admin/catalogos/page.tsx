import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CatalogosPanel, { type CatalogoRow } from '@/components/horas/CatalogosPanel'

export default async function CatalogosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/registrar')

  const [{ data: areas }, { data: etapas }] = await Promise.all([
    supabase.from('areas').select('id, name, active, is_internal').order('name'),
    supabase.from('etapas').select('id, name, active').order('name'),
  ])

  return (
    <div className="space-y-7">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Catálogos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Áreas y etapas del registro de horas. Los proyectos y bancos vienen del Excel; los departamentos son fijos.
        </p>
      </header>

      <CatalogosPanel
        areas={(areas ?? []) as CatalogoRow[]}
        etapas={(etapas ?? []) as CatalogoRow[]}
      />
    </div>
  )
}
