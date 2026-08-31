import { createClient } from '@/lib/supabase/server'
import { getCatalogos, getCatalogoDePosicion } from '@/lib/horas/queries'
import { getCachedProyectosEstado } from '@/lib/graph/client'
import { getBancosHoras } from '@/lib/horas/bancos'
import RegistroForm from '@/components/horas/RegistroForm'
import type { LineInput } from '@/app/(horas)/registrar/actions'

export default async function RegistrarPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // El nombre de la posición viaja incrustado: lo necesita el aviso de banco excedido y
  // antes costaba una consulta aparte. El embed to-one llega tipado como array pero en
  // runtime es un objeto (mismo cast que en el resto del repo).
  const { data: meRaw } = await supabase
    .from('profiles')
    .select('role, position_id, registro_dias_atras, positions(name)')
    .eq('id', user!.id)
    .single()
  const me = meRaw as unknown as
    | { role: string; position_id: string | null; registro_dias_atras: number | null; positions: { name: string } | null }
    | null

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

  // Las cuatro fuentes son independientes entre sí, así que van a la vez. Antes se
  // esperaban en fila y cada una sumaba su latencia a la anterior: con ~200 ms por viaje
  // eran segundos de espera pura en la pantalla por la que entra todo el mundo.
  //
  // El catálogo de la posición es el del DUEÑO (en alta o edición propia, uno mismo).
  // Los dos de Excel se capturan aquí con .catch: son opcionales y ya venían con su plan
  // B, pero dentro de un Promise.all un fallo suelto tumbaría también a los demás.
  const [catalogos, posicion, estados, bancos] = await Promise.all([
    getCatalogos(),
    getCatalogoDePosicion(catalogUserId),
    getCachedProyectosEstado().catch(() => null), // Excel caído → solo "Departamento", sin avisos
    // Solo si quien registra tiene posición: sin ella no hay banco que mirar, igual que antes.
    me?.position_id ? getBancosHoras({ role: 'admin' }).catch(() => null) : Promise.resolve(null),
  ])

  const { areas, etapas, descripciones, departamentos } = catalogos
  const internal = areas.find((a) => a.is_internal)
  if (!internal) throw new Error('No hay un área interna configurada (is_internal) para el proyecto "Departamento".')

  const selectableAreas = posicion.areas.filter((a) => !a.is_internal)
  const departmentEtapaIds = new Set(departamentos.flatMap((d) => d.etapaIds))
  const clientEtapas = etapas.filter((e) => posicion.etapaIds.includes(e.id) && !departmentEtapaIds.has(e.id))
  const allowedDepartamentos = departamentos.filter((d) => posicion.departamentoIds.includes(d.id))

  // La lista de proyectos y estados sale de Clientes_Proyectos (registro maestro con TODOS
  // los proyectos).
  const projects = Array.from(new Set([...(estados ?? []).map((e) => e.project), 'Departamento']))
  const finishedProjects = (estados ?? []).filter((e) => e.estado.toLowerCase() === 'finalizado').map((e) => e.project)
  const pausedProjects = (estados ?? []).filter((e) => e.estado.toLowerCase().includes('paus')).map((e) => e.project)

  const finishedSet = new Set(finishedProjects)
  projects.sort((a, b) => (finishedSet.has(a) ? 1 : 0) - (finishedSet.has(b) ? 1 : 0) || a.localeCompare(b))

  // Banco POR POSICIÓN: aviso de "excedido" según la posición del QUE REGISTRA, no la del
  // dueño (un admin editando ajeno usa la suya). El nombre viene del perfil de arriba, sin
  // consulta aparte.
  const miPosicion = me?.positions?.name
  const exceededProjects = miPosicion
    ? (bancos ?? []).filter((b) => b.position === miPosicion && b.status === 'excedido').map((b) => b.project)
    : []

  const returnTo = ownerName ? '/equipo' : '/mis-registros'
  const heading = initial ? (ownerName ? `Editar registro de ${ownerName}` : 'Editar registro') : 'Registrar horas'

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl">{heading}</h1>
      <RegistroForm projects={projects} finishedProjects={finishedProjects} pausedProjects={pausedProjects} exceededProjects={exceededProjects} areas={selectableAreas} etapas={etapas} clientEtapas={clientEtapas} descripciones={descripciones} descripcionesPosicion={posicion.descripciones} descripcionLibre={posicion.descripcionLibre} departamentos={allowedDepartamentos} internalAreaId={internal.id} canBackdate={me?.role === 'admin'} diasAtras={me?.registro_dias_atras ?? 7} initial={initial} returnTo={returnTo} />
    </div>
  )
}
