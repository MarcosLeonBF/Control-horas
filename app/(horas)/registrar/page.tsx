import { createClient } from '@/lib/supabase/server'
import { getCatalogos, getMyAreas, getMyPositionEtapaIds, getMyPositionDepartamentoIds } from '@/lib/horas/queries'
import { getCachedBancoHoras, getCachedProyectosEstado } from '@/lib/graph/client'
import { getBancosHoras } from '@/lib/horas/bancos'
import RegistroForm from '@/components/horas/RegistroForm'
import type { LineInput } from '@/app/(horas)/registrar/actions'

export default async function RegistrarPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { areas, etapas, departamentos } = await getCatalogos()
  const { data: me } = await supabase.from('profiles').select('role, position_id').eq('id', user!.id).single()
  const myAreas = await getMyAreas(user!.id)
  const internal = areas.find((a) => a.is_internal)
  if (!internal) throw new Error('No hay un área interna configurada (is_internal) para el proyecto "Departamento".')
  // Campos del registro restringidos por el alcance del usuario. Decisión 2026-07-02:
  // el admin YA NO está exento (antes veía todo). Ahora TODOS —incluido el admin— solo
  // ven/eligen lo de su alcance (áreas asignadas + posición), y el motor lo valida al
  // guardar (migración 0024_horas_registro_campos_por_posicion). Sin nada asignado →
  // lista vacía (estricto). NOTA: si el admin no tiene áreas asignadas, no podrá
  // registrar en proyectos cliente (solo "Departamento"); asignarle áreas en Usuarios.

  // Áreas (proyecto cliente, sin la interna): las áreas asignadas al usuario.
  const selectableAreas = myAreas.filter((a) => !a.is_internal)

  // Etapas (proyecto cliente): las de la posición del usuario, excluyendo las exclusivas
  // de un departamento (esas solo aplican al proyecto "Departamento").
  const positionEtapaIds = await getMyPositionEtapaIds(user!.id)
  const departmentEtapaIds = new Set(departamentos.flatMap((d) => d.etapaIds))
  const clientEtapas = etapas.filter((e) => positionEtapaIds.includes(e.id) && !departmentEtapaIds.has(e.id))

  // Descripción al registrar: en proyecto "Departamento" es un desplegable con las
  // descripciones del departamento elegido (vienen dentro de cada DepartamentoRow); en
  // cualquier otro proyecto es texto libre. Ya no depende de la posición.

  // Departamentos (proyecto interno "Departamento"): los de la posición del usuario,
  // con sus descripciones para el desplegable de descripción.
  const positionDepartamentoIds = await getMyPositionDepartamentoIds(user!.id)
  const allowedDepartamentos = departamentos.filter((d) => positionDepartamentoIds.includes(d.id))

  let projects: string[] = []
  try { projects = (await getCachedBancoHoras()).map((b) => b.project) } catch { /* Excel caído: solo Departamento */ }
  projects = Array.from(new Set([...projects, 'Departamento']))

  // Estado de proyectos (tabla clientes_proyectos): avisamos al elegir uno finalizado.
  let finishedProjects: string[] = []
  try {
    finishedProjects = (await getCachedProyectosEstado())
      .filter((e) => e.estado.toLowerCase() === 'finalizado')
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
      <RegistroForm projects={projects} finishedProjects={finishedProjects} exceededProjects={exceededProjects} areas={selectableAreas} etapas={etapas} clientEtapas={clientEtapas} departamentos={allowedDepartamentos} internalAreaId={internal.id} canBackdate={me?.role === 'admin'} initial={initial} />
    </div>
  )
}
