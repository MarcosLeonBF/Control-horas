import { createClient } from '@/lib/supabase/server'
import { getCatalogos, getMyPositionAreas, getMyPositionEtapaIds, getMyPositionDepartamentoIds } from '@/lib/horas/queries'
import { getCachedBancoHoras, getCachedProyectosEstado } from '@/lib/graph/client'
import { getBancosHoras } from '@/lib/horas/bancos'
import RegistroForm from '@/components/horas/RegistroForm'
import type { LineInput } from '@/app/(horas)/registrar/actions'

export default async function RegistrarPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { areas, etapas, descripciones, departamentos } = await getCatalogos()
  const { data: me } = await supabase.from('profiles').select('role, position_id').eq('id', user!.id).single()
  const myPositionAreas = await getMyPositionAreas(user!.id)
  const internal = areas.find((a) => a.is_internal)
  if (!internal) throw new Error('No hay un área interna configurada (is_internal) para el proyecto "Departamento".')
  // Campos del registro restringidos por la POSICIÓN del usuario (decisión 2026-07-03): el
  // área, la etapa, el departamento (y la descripción por departamento) salen de la posición,
  // para todos los roles incluido el admin; el motor lo valida al guardar. user_areas ya no
  // se usa para registrar (es solo la visibilidad del manager). Sin nada asignado a la
  // posición → lista vacía (estricto); asignar áreas/etapas a la posición en Catálogos.

  // Áreas (proyecto cliente, sin la interna): las áreas de la POSICIÓN del usuario.
  const selectableAreas = myPositionAreas.filter((a) => !a.is_internal)

  // Etapas (proyecto cliente): las de la posición del usuario, excluyendo las exclusivas
  // de un departamento (esas solo aplican al proyecto "Departamento").
  const positionEtapaIds = await getMyPositionEtapaIds(user!.id)
  const departmentEtapaIds = new Set(departamentos.flatMap((d) => d.etapaIds))
  const clientEtapas = etapas.filter((e) => positionEtapaIds.includes(e.id) && !departmentEtapaIds.has(e.id))

  // Descripción al registrar: en proyecto "Departamento" es un desplegable con la lista
  // GENERAL de descripciones (compartida por todos los departamentos); en cualquier otro
  // proyecto es texto libre. Ya no depende de la posición ni del departamento.

  // Departamentos (proyecto interno "Departamento"): los de la posición del usuario.
  const positionDepartamentoIds = await getMyPositionDepartamentoIds(user!.id)
  const allowedDepartamentos = departamentos.filter((d) => positionDepartamentoIds.includes(d.id))

  let projects: string[] = []
  try { projects = (await getCachedBancoHoras()).map((b) => b.project) } catch { /* Excel caído: solo Departamento */ }
  projects = Array.from(new Set([...projects, 'Departamento']))

  // Estado de proyectos (tabla clientes_proyectos): avisamos al elegir uno finalizado o pausado.
  let finishedProjects: string[] = []
  let pausedProjects: string[] = []
  try {
    const estados = await getCachedProyectosEstado()
    finishedProjects = estados
      .filter((e) => e.estado.toLowerCase() === 'finalizado')
      .map((e) => e.project)
    pausedProjects = estados
      .filter((e) => e.estado.toLowerCase().includes('paus'))
      .map((e) => e.project)
  } catch { /* tabla no disponible: sin estados, sin aviso */ }

  // Orden en el selector: activos primero (alfabético), finalizados al fondo.
  const finishedSet = new Set(finishedProjects)
  projects.sort((a, b) => (finishedSet.has(a) ? 1 : 0) - (finishedSet.has(b) ? 1 : 0) || a.localeCompare(b))

  // El banco de horas es POR POSICIÓN: avisamos/marcamos "excedido" solo cuando el
  // banco de la posición del usuario para ese proyecto está excedido. Admin usa su
  // propia posición.
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
      <RegistroForm projects={projects} finishedProjects={finishedProjects} pausedProjects={pausedProjects} exceededProjects={exceededProjects} areas={selectableAreas} etapas={etapas} clientEtapas={clientEtapas} descripciones={descripciones} departamentos={allowedDepartamentos} internalAreaId={internal.id} canBackdate={me?.role === 'admin'} initial={initial} />
    </div>
  )
}
