// Tipos y lógica de estado del banco de horas. SIN imports de servidor:
// lo consume tanto la página (servidor) como el componente cliente.
export type HorasStatus = 'sin_asignacion' | 'disponible' | 'bajo' | 'consumido' | 'excedido'

// Cifras de un mes para una fila del banco (asignado Excel vs consumido del mes).
export interface BancoMensual {
  month: string // 'YYYY-MM'
  assigned: number
  consumed: number
  provisional?: boolean // true si `assigned` es un estimado provisional (no confirmado)
  libres?: number // carry forward: 25% del sobrante (solo meses cerrados)
  inutilizables?: number // 75% del sobrante que se pierde al cerrar el mes
}

export interface BancoHorasRow {
  project: string
  position: string // posición = columna del Excel (CRM, SEO, Growth Strategists…)
  assigned: number // horas del Excel para esa posición
  consumed: number // horas registradas por usuarios de esa posición en el proyecto
  remaining: number // disponible real: assigned − consumed − inutilizables
  inutilizables: number // Σ 75% de sobrantes de meses cerrados (carry forward)
  carryNeto: number // Σ libres − Σ excesos de meses cerrados, con piso en 0
  status: HorasStatus
  monthly: BancoMensual[] // desglose mensual (ascendente); [] si no hay datos por mes
  projectEstado?: string // estado del proyecto (Excel Clientes_Proyectos): Activo/Finalizado/…
  manager?: string // "Manager del proyecto" (Excel): para filtrar en Bancos
  fechaAuditoria?: string // "Fecha Auditoría" (Excel) en ISO YYYY-MM-DD: para filtrar en Bancos
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

// Cifras mensuales del proyecto en el detalle: asignado Excel del mes + ampliaciones
// del mes (a nivel proyecto, spec §4.3) frente al consumido del mes.
export interface BancoDetalleMensual {
  month: string // 'YYYY-MM'
  excelAssigned: number
  ampliado: number // Σ ampliaciones ACTIVAS con entry_date en ese mes
  consumed: number
  provisional: number // Σ horas provisionales del mes (0 si el mes es real)
  inutilizables: number // Σ inutilizables del mes (posiciones visibles; 0 si el mes no cerró)
  libres: number // Σ libres (carry) del mes (posiciones visibles; 0 si el mes no cerró)
}

export interface BancoHorasDetalle {
  project: string
  posiciones: BancoHorasRow[] // desglose por posición (acotado al alcance del que mira)
  excelBase: number // Σ horas del Excel real de las posiciones visibles
  provisional: number // Σ horas provisionales (estimadas, transitorias) sumadas al total
  ampliaciones: AmpliacionHoras[]
  movimientos: MovimientoBanco[] // historial consumo + ampliación (más reciente primero)
  assigned: number // excelBase + provisional + Σ ampliaciones activas
  consumed: number
  remaining: number // disponible real del proyecto (assigned − consumed − inutilizables)
  inutilizables: number // Σ de las posiciones visibles
  carryNeto: number // Σ de las posiciones visibles
  status: HorasStatus
  monthly: BancoDetalleMensual[] // cifras del proyecto por mes (ascendente)
}

export const HORAS_STATUS_LABELS: Record<HorasStatus, string> = {
  sin_asignacion: 'Sin asignación',
  disponible: 'Disponible',
  bajo: 'Bajo',
  consumido: 'Consumido',
  excedido: 'Excedido',
}

// Orden de severidad para ordenar bancos/posiciones: excedido primero, sin_asignacion
// al fondo. Compartido por la lista de bancos y el detalle "Por posición".
export const HORAS_SEVERITY: Record<HorasStatus, number> = {
  excedido: 0, bajo: 1, disponible: 2, consumido: 3, sin_asignacion: 4,
}

// Color de la barra de progreso según el estado del banco.
export const HORAS_BAR_COLOR: Record<HorasStatus, string> = {
  excedido: 'bg-(--status-excedido)',
  bajo: 'bg-(--status-bajo)',
  disponible: 'bg-(--status-disponible)',
  consumido: 'bg-(--status-consumido)',
  sin_asignacion: 'bg-(--status-sin)',
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

// Un proyecto con su banco TOTAL (suma de sus posiciones) y el desglose por posición.
export interface BancoHorasProyecto {
  project: string
  projectEstado?: string // estado del proyecto (Excel): mismo para todas sus posiciones
  manager?: string // "Manager del proyecto" (Excel): mismo para todas sus posiciones
  fechaAuditoria?: string // "Fecha Auditoría" (Excel) ISO: mismo para todas sus posiciones
  positions: BancoHorasRow[] // desglose por posición
  assigned: number
  consumed: number
  remaining: number
  inutilizables: number
  carryNeto: number
  status: HorasStatus // estado del banco a nivel proyecto (calculado sobre los totales)
  monthly: BancoMensual[]
}

// Clase de la insignia según el estado del proyecto (Excel Clientes_Proyectos):
// finalizado (gris), activo (verde), pausado (azul), otros (muted). Compartida por la
// lista de bancos y la vista de detalle.
export function estadoProyectoBadgeClass(estado: string): string {
  const e = estado.toLowerCase()
  if (e === 'finalizado') return 'bg-foreground/[0.07] text-muted-foreground'
  if (e === 'activo') return 'bg-(--status-disponible)/12 text-(--status-disponible)'
  if (e.includes('paus')) return 'bg-(--status-pausado)/12 text-(--status-pausado)'
  return 'bg-(--muted-surface) text-muted-foreground'
}

// Agrupa las filas (proyecto+posición) por proyecto, sumando el banco total y
// calculando el estado a nivel proyecto. Las posiciones quedan ordenadas por nombre.
export function groupBancosByProject(rows: BancoHorasRow[]): BancoHorasProyecto[] {
  const map = new Map<string, BancoHorasProyecto>()
  for (const r of rows) {
    let g = map.get(r.project)
    if (!g) {
      g = { project: r.project, projectEstado: r.projectEstado, manager: r.manager, fechaAuditoria: r.fechaAuditoria, positions: [], assigned: 0, consumed: 0, remaining: 0, inutilizables: 0, carryNeto: 0, status: 'sin_asignacion', monthly: [] }
      map.set(r.project, g)
    }
    g.positions.push(r)
    g.assigned += r.assigned
    g.consumed += r.consumed
    g.inutilizables += r.inutilizables
    g.carryNeto += r.carryNeto
  }
  for (const g of map.values()) {
    // Cifras efectivas: el disponible real descuenta los inutilizables del carry forward.
    g.remaining = g.assigned - g.consumed - g.inutilizables
    g.status = computeHorasStatus(g.assigned - g.inutilizables, g.consumed)
    g.positions.sort((a, b) => a.position.localeCompare(b.position))
    // Mensual del proyecto = suma de lo mensual de sus posiciones.
    const byMonth = new Map<string, BancoMensual>()
    for (const p of g.positions) {
      for (const m of p.monthly) {
        const acc = byMonth.get(m.month) ?? { month: m.month, assigned: 0, consumed: 0 }
        acc.assigned += m.assigned
        acc.consumed += m.consumed
        if (m.provisional) acc.provisional = true
        if (m.libres) acc.libres = (acc.libres ?? 0) + m.libres
        if (m.inutilizables) acc.inutilizables = (acc.inutilizables ?? 0) + m.inutilizables
        byMonth.set(m.month, acc)
      }
    }
    g.monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
  }
  return [...map.values()]
}
