// Tipos y lógica de estado del banco de horas. SIN imports de servidor:
// lo consume tanto la página (servidor) como el componente cliente.
export type HorasStatus = 'sin_asignacion' | 'disponible' | 'bajo' | 'consumido' | 'excedido'

export interface BancoHorasRow {
  project: string
  position: string // posición = columna del Excel (CRM, SEO, Growth Strategists…)
  assigned: number // horas del Excel para esa posición
  consumed: number // horas registradas por usuarios de esa posición en el proyecto
  remaining: number
  status: HorasStatus
  projectEstado?: string // estado del proyecto (Excel Clientes_Proyectos): Activo/Finalizado/…
}

export interface AmpliacionHoras {
  id: string
  project: string
  hours: number
  reason: string
  entry_date: string
  actor_name: string
  active: boolean
}

// Movimiento del banco (PDF §12): consumo o ampliación, con saldo antes/después
// (horas disponibles). Calculado a partir de las líneas y las ampliaciones.
export interface MovimientoBanco {
  date: string
  kind: 'consumo' | 'ampliacion'
  hours: number // magnitud positiva
  saldoAntes: number // horas disponibles antes del movimiento
  saldoDespues: number // horas disponibles después
  actor: string // usuario que registró (consumo) / responsable (ampliación)
  detail: string // descripción (consumo) / motivo (ampliación)
}

export interface BancoHorasDetalle {
  project: string
  posiciones: BancoHorasRow[] // desglose por posición (acotado al alcance del que mira)
  excelBase: number // Σ horas del Excel de las posiciones visibles
  ampliaciones: AmpliacionHoras[]
  movimientos: MovimientoBanco[] // historial consumo + ampliación (más reciente primero)
  assigned: number // excelBase + Σ ampliaciones activas
  consumed: number
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
