// Tipos compartidos en toda la aplicación

export type Stage = 'Setup' | 'CRM' | 'Servicios Mensuales'
export type Department = 'Clientes' | 'Ventas' | 'Marketing' | 'Todos'

export interface TimeEntry {
  id: string
  specialist_email: string
  specialist_name: string
  project: string
  stage: Stage
  department: Department
  entry_date: string        // formato ISO: 'YYYY-MM-DD'
  hours: number
  description: string | null
  created_at: string
}

export interface BancoHorasItem {
  project: string
  totalHours: number
}

// Banco de horas por POSICIÓN: cada columna del Excel (CRM, SEO, Growth Strategists…)
// es una posición con sus horas asignadas por proyecto.
export interface BancoPosicion {
  position: string
  hours: number
}
// Asignación de un mes concreto (fila del Excel con columna Fecha).
export interface BancoMes {
  month: string // 'YYYY-MM'
  positions: BancoPosicion[]
}
export interface BancoHorasProyecto {
  project: string
  positions: BancoPosicion[] // totales = Σ de todas las filas (incluye filas sin fecha)
  months: BancoMes[] // orden ascendente; las filas sin fecha NO aparecen en ningún mes
}

export interface ProjectSummary extends BancoHorasItem {
  consumedHours: number
  remainingHours: number
  isExceeded: boolean
  isDepartamento: boolean   // "Departamento" no tiene banco
}
