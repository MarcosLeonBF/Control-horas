// Tipos y agregación del reporte de horas. SIN imports de servidor (lo usa el
// componente cliente y la página).
export type GroupBy = 'project' | 'user' | 'area' | 'department' | 'etapa' | 'position'

export const GROUP_LABELS: Record<GroupBy, string> = {
  project: 'Proyecto',
  user: 'Usuario',
  area: 'Área',
  department: 'Departamento',
  etapa: 'Etapa',
  position: 'Posición',
}

export const GROUP_ORDER: GroupBy[] = ['project', 'user', 'area', 'department', 'etapa', 'position']

// Una línea de registro aplanada (con nombres ya resueltos), lista para agrupar.
export interface ReporteLine {
  date: string
  project: string
  area: string
  etapa: string
  department: string
  user: string
  position: string
  hours: number
  description: string
  isInternal: boolean // project === 'Departamento'
}

export interface ReporteFilterOptions {
  projects: string[]
  users: string[]
  areas: string[]
  departments: string[]
  positions: string[]
}

const KEY: Record<GroupBy, (l: ReporteLine) => string> = {
  project: (l) => l.project || '—',
  user: (l) => l.user || '—',
  area: (l) => l.area || '—',
  department: (l) => l.department || '—',
  etapa: (l) => l.etapa || '—',
  position: (l) => l.position || '—',
}

export interface AggRow {
  label: string
  hours: number
}

// Agrupa y suma horas por la dimensión elegida, orden desc.
export function aggregate(lines: ReporteLine[], groupBy: GroupBy): AggRow[] {
  const by = new Map<string, number>()
  const keyOf = KEY[groupBy]
  for (const l of lines) {
    const k = keyOf(l)
    by.set(k, (by.get(k) ?? 0) + l.hours)
  }
  return [...by.entries()]
    .map(([label, hours]) => ({ label, hours: Math.round(hours * 100) / 100 }))
    .sort((a, b) => b.hours - a.hours || a.label.localeCompare(b.label))
}
