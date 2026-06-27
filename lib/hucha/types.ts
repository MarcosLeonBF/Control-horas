export type HuchaStatus = 'sin_presupuesto' | 'disponible' | 'bajo' | 'consumido' | 'excedido'

export interface HuchaBankRow {
  id: string
  project_id: string
  currency: string
  assigned_total: number
  consumed_total: number
  remaining: number
  status: HuchaStatus
}

export interface ProjectWithBank {
  id: string
  name: string
  client: string | null
  bank: HuchaBankRow
}

export interface HuchaMovementRow {
  id: string
  type: 'consumo' | 'ampliacion' | 'correccion' | 'anulacion'
  amount: number
  balance_before: number
  balance_after: number
  description: string | null
  reference: string | null
  reason: string | null
  actor_name: string
  entry_date: string
  created_at: string
  corrects_movement_id: string | null
}
