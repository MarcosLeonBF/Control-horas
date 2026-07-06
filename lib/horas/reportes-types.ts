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
  userId: string // id del usuario: identidad estable (dos personas pueden llamarse igual)
  user: string   // nombre para mostrar
  position: string
  hours: number
  description: string
  isInternal: boolean // project === 'Departamento'
}

// Usuario para el filtro: id (valor/identidad) + label a mostrar (nombre, o
// nombre + email si hay homónimos).
export interface ReporteUserOption { id: string; name: string; label: string }

export interface ReporteFilterOptions {
  projects: string[]
  users: ReporteUserOption[]
  areas: string[]
  departments: string[]
  positions: string[]
}

// Cada dimensión define su clave de agrupación (identidad) y su etiqueta a mostrar.
// Para "usuario" la clave es el id (no el nombre), así dos homónimos no se mezclan.
const KEY: Record<GroupBy, (l: ReporteLine) => { key: string; label: string }> = {
  project: (l) => ({ key: l.project || '—', label: l.project || '—' }),
  user: (l) => ({ key: l.userId || '—', label: l.user || '—' }),
  area: (l) => ({ key: l.area || '—', label: l.area || '—' }),
  department: (l) => ({ key: l.department || '—', label: l.department || '—' }),
  etapa: (l) => ({ key: l.etapa || '—', label: l.etapa || '—' }),
  position: (l) => ({ key: l.position || '—', label: l.position || '—' }),
}

export interface AggRow {
  key: string   // identidad del grupo (para agrupar y como React key)
  label: string // etiqueta a mostrar
  hours: number
}

// Agrupa y suma horas por la dimensión elegida, orden desc.
export function aggregate(lines: ReporteLine[], groupBy: GroupBy): AggRow[] {
  const by = new Map<string, { label: string; hours: number }>()
  const keyOf = KEY[groupBy]
  for (const l of lines) {
    const { key, label } = keyOf(l)
    const cur = by.get(key) ?? { label, hours: 0 }
    cur.hours += l.hours
    by.set(key, cur)
  }
  return [...by.entries()]
    .map(([key, { label, hours }]) => ({ key, label, hours: Math.round(hours * 100) / 100 }))
    .sort((a, b) => b.hours - a.hours || a.label.localeCompare(b.label))
}
