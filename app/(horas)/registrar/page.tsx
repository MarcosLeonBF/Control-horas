import { createClient } from '@/lib/supabase/server'
import { getCatalogos, getMyAreas, getMyPositionEtapaIds } from '@/lib/horas/queries'
import { getCachedBancoHoras } from '@/lib/graph/client'
import RegistroForm from '@/components/horas/RegistroForm'
import type { LineInput } from '@/app/(horas)/registrar/actions'

export default async function RegistrarPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { areas, etapas, departamentos } = await getCatalogos()
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user!.id).single()
  const myAreas = await getMyAreas(user!.id)
  const internal = areas.find((a) => a.is_internal)
  if (!internal) throw new Error('No hay un área interna configurada (is_internal) para el proyecto "Departamento".')
  // Áreas seleccionables para proyectos de cliente (sin la interna):
  // operativo y manager solo ven sus áreas asignadas (su alcance); el admin ve todas.
  const realAreas = areas.filter((a) => !a.is_internal)
  const selectableAreas = me?.role === 'admin' ? realAreas : myAreas.filter((a) => !a.is_internal)

  // Etapas seleccionables en proyecto cliente: las de la posición del usuario.
  // Admin ve todas (igual que con las áreas). Operativo/manager sin etapas de
  // posición → lista vacía (no puede registrar en cliente; PDF: estricto).
  const positionEtapaIds = await getMyPositionEtapaIds(user!.id)
  const clientEtapas = me?.role === 'admin' ? etapas : etapas.filter((e) => positionEtapaIds.includes(e.id))

  let projects: string[] = []
  try { projects = (await getCachedBancoHoras()).map((b) => b.project) } catch { /* Excel caído: solo Departamento */ }
  projects = Array.from(new Set([...projects, 'Departamento']))

  // Modo edición: precargar el registro propio (RLS limita el acceso) si no está anulado.
  // Las líneas no tienen fecha propia: heredan la del log que se edita.
  let initial: { id: string; lines: LineInput[] } | undefined
  if (edit) {
    const { data: log } = await supabase
      .from('time_logs')
      .select('id, entry_date, status, time_log_lines(project, area_id, department, etapa_id, hours, description)')
      .eq('id', edit).single()
    if (log && log.status !== 'anulado') {
      initial = {
        id: log.id,
        lines: (log.time_log_lines as Omit<LineInput, 'entry_date'>[]).map((l) => ({
          entry_date: log.entry_date, project: l.project, area_id: l.area_id, department: l.department,
          etapa_id: l.etapa_id, hours: Number(l.hours), description: l.description,
        })),
      }
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl">{initial ? 'Editar registro' : 'Registrar horas'}</h1>
      <RegistroForm projects={projects} areas={selectableAreas} etapas={etapas} clientEtapas={clientEtapas} departamentos={departamentos} internalAreaId={internal.id} canBackdate={me?.role === 'admin'} initial={initial} />
    </div>
  )
}
