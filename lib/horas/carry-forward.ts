import type { BancoMensual } from '@/lib/horas/bancos-status'

// Carry forward del banco (spec 2026-07-14): al cerrar un mes, el 25% de su sobrante se
// conserva como horas libres y el 75% se inutiliza; los excesos de meses cerrados
// descuentan del carry acumulado. El mes en curso no sufre el corte. Aplica a TODO mes
// cerrado sin distinción de origen (real, provisional o setup): recalculable siempre.
export const CARRY_FORWARD_PCT = 0.25

export interface CarryMes {
  month: string
  libres: number
  inutilizables: number
  exceso: number
}

export interface CarryTotales {
  inutilizables: number
  carryBruto: number // Σ libres de meses cerrados (sin netear excesos)
  carryNeto: number // max(carryBruto − Σ excesos, 0): lo realmente arrastrable
}

export function carrySplit(
  monthly: Pick<BancoMensual, 'month' | 'assigned' | 'consumed'>[],
  mesActual: string,
): { porMes: CarryMes[]; totales: CarryTotales } {
  const porMes: CarryMes[] = []
  let inutilizables = 0
  let carryBruto = 0
  let excesos = 0
  for (const m of monthly) {
    if (m.month >= mesActual) continue // mes en curso (o futuro): sin corte
    const sobrante = Math.max(m.assigned - m.consumed, 0)
    const exceso = Math.max(m.consumed - m.assigned, 0)
    const libres = CARRY_FORWARD_PCT * sobrante
    const inutil = sobrante - libres // complemento exacto (evita drift de flotantes)
    porMes.push({ month: m.month, libres, inutilizables: inutil, exceso })
    inutilizables += inutil
    carryBruto += libres
    excesos += exceso
  }
  return { porMes, totales: { inutilizables, carryBruto, carryNeto: Math.max(carryBruto - excesos, 0) } }
}
