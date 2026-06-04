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

export interface ProjectSummary extends BancoHorasItem {
  consumedHours: number
  remainingHours: number
  isExceeded: boolean
  isDepartamento: boolean   // "Departamento" no tiene banco
}
