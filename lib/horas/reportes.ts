import { createClient } from '@/lib/supabase/server'
import { getCachedBancoHoras } from '@/lib/graph/client'
import type { ViewerScope } from '@/lib/horas/scope'
import type { ReporteLine, ReporteFilterOptions } from '@/lib/horas/reportes-types'

interface RawLine {
  project: string
  hours: number
  department: string
  description: string | null
  areas: { name: string } | null
  etapas: { name: string } | null
  time_logs: { entry_date: string; profiles: { full_name: string } | null } | null
}

// Líneas de registro (no anuladas) dentro de un rango de fechas, con nombres resueltos.
export async function getReporteLines(from: string, to: string): Promise<ReporteLine[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('time_log_lines')
    .select(
      'project, hours, department, description, areas(name), etapas(name), time_logs!inner(entry_date, status, user_id, profiles!time_logs_user_id_fkey(full_name))',
    )
    .neq('time_logs.status', 'anulado')
    .gte('time_logs.entry_date', from)
    .lte('time_logs.entry_date', to)
    .order('entry_date', { ascending: false, referencedTable: 'time_logs' })

  return ((data ?? []) as unknown as RawLine[]).map((l) => ({
    date: l.time_logs?.entry_date ?? '',
    project: l.project,
    area: l.areas?.name ?? '—',
    etapa: l.etapas?.name ?? '—',
    department: l.department,
    user: l.time_logs?.profiles?.full_name ?? '—',
    hours: Number(l.hours),
    description: l.description ?? '',
    isInternal: l.project === 'Departamento',
  }))
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

  const { data: profiles } = await supabase.from('profiles').select('full_name').not('full_name', 'is', null).order('full_name')

  let projects: string[] = []
  try {
    projects = (await getCachedBancoHoras()).map((b) => b.project)
  } catch {
    projects = []
  }
  projects = [...projects, 'Departamento'].sort((a, b) => a.localeCompare(b))

  return {
    projects,
    users: (profiles ?? []).map((p) => p.full_name as string).filter(Boolean),
    areas: areaNames,
    departments: ['Clientes', 'Ventas', 'Marketing', 'Todos'],
  }
}
