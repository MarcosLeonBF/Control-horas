import { createClient } from '@/lib/supabase/server'
import { getCachedProyectosEstado } from '@/lib/graph/client'
import type { ViewerScope } from '@/lib/horas/scope'
import type { ReporteLine, ReporteFilterOptions } from '@/lib/horas/reportes-types'
import { finDeMes } from '@/lib/horas/format'

interface RawLine {
  project: string
  hours: number
  department: string
  description: string | null
  areas: { name: string } | null
  etapas: { name: string } | null
  time_logs: { entry_date: string; user_id: string; profiles: { full_name: string; positions: { name: string } | null } | null } | null
}

interface RawHistorica {
  month: string
  project: string
  department: string
  etapa: string
  hours: number
  user_id: string
  profiles: { full_name: string; positions: { name: string } | null } | null
}

// Líneas de registro (no anuladas) dentro de un rango de fechas, con nombres resueltos.
// Incluye el histórico mensual previo a la plataforma, fechado al cierre de su mes
// (spec 2026-07-21-horas-historicas-reportes). La UI decide si mostrarlo con el flag
// `historico` de cada línea.
export async function getReporteLines(from: string, to: string): Promise<ReporteLine[]> {
  const supabase = await createClient()
  const [{ data }, { data: hist }, { data: etapas }] = await Promise.all([
    supabase
      .from('time_log_lines')
      .select(
        'project, hours, department, description, areas(name), etapas(name), time_logs!inner(entry_date, status, user_id, profiles!time_logs_user_id_fkey(full_name, positions(name)))',
      )
      .neq('time_logs.status', 'anulado')
      .gte('time_logs.entry_date', from)
      .lte('time_logs.entry_date', to)
      .order('entry_date', { ascending: false, referencedTable: 'time_logs' }),
    // Meses que solapan el rango; el recorte fino al día se hace abajo con finDeMes.
    supabase
      .from('horas_historicas')
      .select('month, project, department, etapa, hours, user_id, profiles(full_name, positions(name))')
      .gte('month', from.slice(0, 7))
      .lte('month', to.slice(0, 7)),
    supabase.from('etapas').select('name'),
  ])

  const lines: ReporteLine[] = ((data ?? []) as unknown as RawLine[]).map((l) => ({
    date: l.time_logs?.entry_date ?? '',
    project: l.project,
    area: l.areas?.name ?? '—',
    etapa: l.etapas?.name ?? '—',
    department: l.department,
    userId: l.time_logs?.user_id ?? '',
    user: l.time_logs?.profiles?.full_name ?? '—',
    position: l.time_logs?.profiles?.positions?.name ?? '—',
    hours: Number(l.hours),
    description: l.description ?? '',
    isInternal: l.project === 'Departamento',
    historico: false,
  }))

  // El histórico guarda la etapa como texto tal cual vino de la hoja. Se casa con el
  // catálogo ignorando mayúsculas para que "Servicios mensuales" no salga como una
  // etapa distinta de "Servicios Mensuales" al agrupar.
  const etapaCanonica = new Map<string, string>()
  for (const e of (etapas ?? []) as { name: string }[]) etapaCanonica.set(e.name.toLocaleLowerCase('es'), e.name)

  for (const h of (hist ?? []) as unknown as RawHistorica[]) {
    const date = finDeMes(h.month)
    if (date < from || date > to) continue // el cierre de ese mes cae fuera del rango
    lines.push({
      date,
      project: h.project,
      area: '—', // el histórico no trae área
      etapa: etapaCanonica.get(h.etapa.toLocaleLowerCase('es')) ?? h.etapa,
      department: h.department,
      userId: h.user_id,
      user: h.profiles?.full_name ?? '—',
      position: h.profiles?.positions?.name ?? '—',
      hours: Number(h.hours),
      description: '', // el histórico no trae descripción
      isInternal: h.project === 'Departamento',
      historico: true,
    })
  }

  return lines
}

// Opciones para los filtros (derivadas del catálogo + Excel + perfiles).
// El alcance del manager es por sus áreas: solo ve sus áreas asignadas en el filtro.
// (Los usuarios ya quedan acotados por RLS al equipo del manager.)
export async function getReporteOptions(scope: ViewerScope): Promise<ReporteFilterOptions> {
  const supabase = await createClient()

  let areaNames: string[] = []
  if (scope.role === 'manager') {
    if (scope.areaIds.length) {
      const { data } = await supabase.from('areas').select('name').in('id', scope.areaIds).eq('active', true).order('name')
      areaNames = (data ?? []).map((a) => a.name as string)
    }
  } else {
    const { data } = await supabase.from('areas').select('name').eq('active', true).order('name')
    areaNames = (data ?? []).map((a) => a.name as string)
  }

  const { data: profiles } = await supabase.from('profiles').select('id, full_name, email').not('full_name', 'is', null).order('full_name')

  let projects: string[] = []
  try {
    // Proyectos desde Clientes_Proyectos (registro maestro; incluye los recién ingresados,
    // que en BancoHoras tardan por el delay de esa hoja).
    projects = (await getCachedProyectosEstado()).map((e) => e.project)
  } catch {
    projects = []
  }
  // Dedup + "Departamento": evita keys duplicadas.
  projects = Array.from(new Set([...projects, 'Departamento'])).sort((a, b) => a.localeCompare(b))

  // Posiciones acotadas al alcance del manager: solo las ligadas a sus áreas
  // (position_areas), igual que en Bancos. El admin ve todas.
  let positionNames: string[] = []
  if (scope.role === 'manager') {
    if (scope.areaIds.length) {
      const { data: pa } = await supabase.from('position_areas').select('position_id').in('area_id', scope.areaIds)
      const posIds = Array.from(new Set((pa ?? []).map((r) => r.position_id as string)))
      if (posIds.length) {
        const { data } = await supabase.from('positions').select('name').in('id', posIds).eq('active', true).order('name')
        positionNames = (data ?? []).map((p) => p.name as string)
      }
    }
  } else {
    const { data } = await supabase.from('positions').select('name').eq('active', true).order('name')
    positionNames = (data ?? []).map((p) => p.name as string)
  }

  // Usuarios para el filtro: id (identidad) + nombre. El nombre no es único (dos
  // personas pueden llamarse igual): a los homónimos se les agrega el email para
  // poder distinguirlos a la vista.
  const profs = (profiles ?? []).filter((p) => p.full_name)
  const nameCount = new Map<string, number>()
  for (const p of profs) nameCount.set(p.full_name as string, (nameCount.get(p.full_name as string) ?? 0) + 1)
  const users = profs.map((p) => {
    const name = p.full_name as string
    const email = (p.email as string | null) ?? ''
    const dup = (nameCount.get(name) ?? 0) > 1
    return { id: p.id as string, name, label: dup && email ? `${name} (${email})` : name }
  })

  return {
    projects,
    users,
    areas: areaNames,
    departments: ['Clientes', 'Ventas', 'Marketing', 'Todos'], // TODO: Cargar de DB si es necesario, pero actualmente es estático en reportes
    positions: positionNames,
  }
}
