import { createClient } from '@/lib/supabase/server'
import { getCatalogos, getMyAreas } from '@/lib/horas/queries'
import { getCachedBancoHoras } from '@/lib/graph/client'
import RegistroForm from '@/components/horas/RegistroForm'
import type { LineInput } from '@/app/(horas)/registrar/actions'

export default async function RegistrarPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { areas, etapas } = await getCatalogos()
  const myAreas = await getMyAreas(user!.id)
  const internal = areas.find((a) => a.is_internal)!
  // Para el selector: las áreas del usuario + la interna (para proyecto "Departamento")
  const selectableAreas = [...myAreas, internal]

  let projects: string[] = []
  try { projects = (await getCachedBancoHoras()).map((b) => b.project) } catch { /* Excel caído: solo Departamento */ }
  projects = [...projects, 'Departamento']

  // Modo edición: precargar el registro propio (RLS limita el acceso) si no está anulado.
  let initial: { id: string; entryDate: string; lines: LineInput[] } | undefined
  if (edit) {
    const { data: log } = await supabase
      .from('time_logs')
      .select('id, entry_date, status, time_log_lines(project, area_id, department, etapa_id, hours, description)')
      .eq('id', edit).single()
    if (log && log.status !== 'anulado') {
      initial = {
        id: log.id, entryDate: log.entry_date,
        lines: (log.time_log_lines as LineInput[]).map((l) => ({
          project: l.project, area_id: l.area_id, department: l.department,
          etapa_id: l.etapa_id, hours: Number(l.hours), description: l.description,
        })),
      }
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl">{initial ? 'Editar registro' : 'Registrar horas'}</h1>
      <RegistroForm projects={projects} areas={selectableAreas} etapas={etapas} internalAreaId={internal.id} initial={initial} />
    </div>
  )
}
