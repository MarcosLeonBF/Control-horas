// Tipos y agregación del reporte de horas. SIN imports de servidor (lo usa el
// componente cliente y la página). format.ts es puro (solo Intl), sin servidor.
import { formatFechaISO, mesCorto } from '@/lib/horas/format'

export type GroupBy = 'project' | 'user' | 'area' | 'department' | 'etapa' | 'position' | 'month' | 'date'

export const GROUP_LABELS: Record<GroupBy, string> = {
  project: 'Proyecto',
  user: 'Usuario',
  area: 'Área',
  department: 'Departamento',
  etapa: 'Etapa',
  position: 'Posición',
  month: 'Mes',
  date: 'Fecha',
}

// 'month' va entre 'position' y 'date': de escala gruesa a fina.
export const GROUP_ORDER: GroupBy[] = ['project', 'user', 'area', 'department', 'etapa', 'position', 'month', 'date']

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
  // true = cierre mensual del histórico previo a la plataforma (fechado a fin de mes,
  // sin área ni descripción). El interruptor de /reportes lo usa para incluirlo o no.
  historico: boolean
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
  // Clave = 'YYYY-MM' (ordena cronológicamente sola, sin pasar por Date); etiqueta =
  // "Jul 2026", como rotula meses el resto de la app.
  month: (l) => ({ key: l.date ? l.date.slice(0, 7) : '—', label: l.date ? mesCorto(l.date.slice(0, 7)) : '—' }),
  // Clave = fecha ISO (orden estable y cronológico); etiqueta = DD/MM/AAAA.
  date: (l) => ({ key: l.date || '—', label: l.date ? formatFechaISO(l.date) : '—' }),
}

export interface AggRow {
  key: string   // identidad del grupo (para agrupar y como React key)
  label: string // etiqueta a mostrar
  hours: number
}

// Clave (identidad) y etiqueta del grupo al que pertenece una línea según la
// dimensión elegida. Misma lógica que aggregate: para "usuario" la clave es el id,
// no el nombre. La matriz de /historico la usa para agrupar y rotular a la vez.
export function groupOf(line: ReporteLine, groupBy: GroupBy): { key: string; label: string } {
  return KEY[groupBy](line)
}

// Solo la identidad: el drill-down la usa para filtrar las líneas de una fila.
export function groupKeyOf(line: ReporteLine, groupBy: GroupBy): string {
  return groupOf(line, groupBy).key
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
  const rows = [...by.entries()].map(([key, { label, hours }]) => ({ key, label, hours: Math.round(hours * 100) / 100 }))
  // Dimensiones de tiempo: orden cronológico descendente (la clave es ISO, así que lo
  // más reciente queda arriba). Resto de dimensiones: por horas descendente.
  return groupBy === 'date' || groupBy === 'month'
    ? rows.sort((a, b) => b.key.localeCompare(a.key))
    : rows.sort((a, b) => b.hours - a.hours || a.label.localeCompare(b.label))
}
