import { createClient } from '@/lib/supabase/server'
import { getCatalogos, getMyPositionAreas, getMyPositionEtapaIds, getMyPositionDepartamentoIds } from '@/lib/horas/queries'
import { getCachedProyectosEstado } from '@/lib/graph/client'
import { getBancosHoras } from '@/lib/horas/bancos'
import RegistroForm from '@/components/horas/RegistroForm'
import type { LineInput } from '@/app/(horas)/registrar/actions'

export default async function RegistrarPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('profiles').select('role, position_id').eq('id', user!.id).single()

  // Modo edición: cargar el log ANTES que los catálogos, porque el catálogo (áreas/etapas/
  // departamentos) sale de la POSICIÓN DEL DUEÑO del registro, no de la del que edita. Solo
  // se precarga si el registro es propio o si soy admin (un manager que abra un ?edit= ajeno
  // por URL ve el formulario en blanco; el motor igual rechazaría el guardado).
  let initial: { id: string; lines: LineInput[] } | undefined
  let ownerName: string | undefined
  let catalogUserId = user!.id
  if (edit) {
    const { data: log } = await supabase
      .from('time_logs')
      .select('id, user_id, entry_date, status, profiles!time_logs_user_id_fkey(full_name), time_log_lines(project, area_id, department, etapa_id, hours, description)')
      .eq('id', edit).single()
    const puedeEditar = !!log && (log.user_id === user!.id || me?.role === 'admin')
    if (log && puedeEditar && log.status !== 'anulado') {
      initial = {
        id: log.id,
        lines: (log.time_log_lines as Omit<LineInput, 'entry_date'>[]).map((l) => ({
          entry_date: log.entry_date, project: l.project, area_id: l.area_id, department: l.department,
          etapa_id: l.etapa_id, hours: Number(l.hours), description: l.description,
        })),
      }
      catalogUserId = log.user_id
      // El cliente tipa el embed como array, pero al ser FK to-one el runtime es un objeto
      // (mismo patrón que equipo/page.tsx): casteamos por unknown para leer full_name.
      if (log.user_id !== user!.id) ownerName = (log.profiles as unknown as { full_name: string } | null)?.full_name ?? undefined
    }
  }

  const { areas, etapas, descripciones, departamentos } = await getCatalogos()
  // El catálogo sale de la posición del DUEÑO (en alta o edición propia, es el propio usuario).
  const myPositionAreas = await getMyPositionAreas(catalogUserId)
  const internal = areas.find((a) => a.is_internal)
  if (!internal) throw new Error('No hay un área interna configurada (is_internal) para el proyecto "Departamento".')

  const selectableAreas = myPositionAreas.filter((a) => !a.is_internal)
  const positionEtapaIds = await getMyPositionEtapaIds(catalogUserId)
  const departmentEtapaIds = new Set(departamentos.flatMap((d) => d.etapaIds))
  const clientEtapas = etapas.filter((e) => positionEtapaIds.includes(e.id) && !departmentEtapaIds.has(e.id))
  const positionDepartamentoIds = await getMyPositionDepartamentoIds(catalogUserId)
  const allowedDepartamentos = departamentos.filter((d) => positionDepartamentoIds.includes(d.id))

  // La lista de proyectos y estados sale de Clientes_Proyectos (registro maestro con TODOS
  // los proyectos). Excel caído → solo "Departamento", sin avisos.
  let projects: string[] = ['Departamento']
  let finishedProjects: string[] = []
  let pausedProjects: string[] = []
  try {
    const estados = await getCachedProyectosEstado()
    projects = Array.from(new Set([...estados.map((e) => e.project), 'Departamento']))
    finishedProjects = estados.filter((e) => e.estado.toLowerCase() === 'finalizado').map((e) => e.project)
    pausedProjects = estados.filter((e) => e.estado.toLowerCase().includes('paus')).map((e) => e.project)
  } catch { /* Excel no disponible: solo Departamento, sin avisos */ }

  const finishedSet = new Set(finishedProjects)
  projects.sort((a, b) => (finishedSet.has(a) ? 1 : 0) - (finishedSet.has(b) ? 1 : 0) || a.localeCompare(b))

  // Banco POR POSICIÓN: aviso de "excedido" según la posición del que registra (admin usa la suya).
  let exceededProjects: string[] = []
  if (me?.position_id) {
    try {
      const { data: pos } = await supabase.from('positions').select('name').eq('id', me.position_id).single()
      const positionName = pos?.name
      if (positionName) {
        exceededProjects = (await getBancosHoras({ role: 'admin' }))
          .filter((b) => b.position === positionName && b.status === 'excedido')
          .map((b) => b.project)
      }
    } catch { /* bancos/Excel no disponibles: sin aviso de excedido */ }
  }

  const returnTo = ownerName ? '/equipo' : '/mis-registros'
  const heading = initial ? (ownerName ? `Editar registro de ${ownerName}` : 'Editar registro') : 'Registrar horas'

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl">{heading}</h1>
      <RegistroForm projects={projects} finishedProjects={finishedProjects} pausedProjects={pausedProjects} exceededProjects={exceededProjects} areas={selectableAreas} etapas={etapas} clientEtapas={clientEtapas} descripciones={descripciones} departamentos={allowedDepartamentos} internalAreaId={internal.id} canBackdate={me?.role === 'admin'} initial={initial} returnTo={returnTo} />
    </div>
  )
}
