// Tipos y lógica de estado del banco de horas. SIN imports de servidor:
// lo consume tanto la página (servidor) como el componente cliente.
export type HorasStatus = 'sin_asignacion' | 'disponible' | 'bajo' | 'consumido' | 'excedido'

export interface BancoHorasRow {
  project: string
  assigned: number // horas del Excel (columna "Horas CRM")
  consumed: number // suma de horas registradas (logs no anulados)
  remaining: number
  status: HorasStatus
}

export const HORAS_STATUS_LABELS: Record<HorasStatus, string> = {
  sin_asignacion: 'Sin asignación',
  disponible: 'Disponible',
  bajo: 'Bajo',
  consumido: 'Consumido',
  excedido: 'Excedido',
}

// Mismos umbrales que compute_hucha_status (migración 0002), pero con horas.
export function computeHorasStatus(assigned: number, consumed: number): HorasStatus {
  if (assigned === 0 && consumed === 0) return 'sin_asignacion'
  const remaining = assigned - consumed
  if (remaining < 0) return 'excedido'
  if (remaining === 0) return 'consumido'
  if (assigned > 0 && remaining < 0.2 * assigned) return 'bajo'
  return 'disponible'
}
