export type Department = string
export type LogStatus = 'guardado' | 'editado' | 'anulado'

export interface AreaRow { id: string; name: string; is_internal: boolean }
export interface EtapaRow { id: string; name: string }
export interface DepartamentoRow { id: string; name: string; etapaIds: string[] }

export interface TimeLogLine {
  id: string; project: string; area_id: string; department: Department
  etapa_id: string; hours: number; description: string
}
export interface TimeLogWithLines {
  id: string; user_id: string; entry_date: string; total_hours: number
  status: LogStatus; lines: TimeLogLine[]
}
