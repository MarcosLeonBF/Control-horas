import type { BancoMensual } from '@/lib/horas/bancos-status'

// Carry forward del banco (spec 2026-07-14): al cerrar un mes, una parte de su sobrante se
// conserva como horas libres y el resto se inutiliza; los excesos de meses cerrados
// descuentan del carry acumulado. El mes en curso no sufre el corte. Aplica a TODO mes
// cerrado sin distinción de origen (real, provisional o setup): recalculable siempre.
//
// Lo ampliado (spec 2026-10-15) va dentro de `assigned` pero queda FUERA del corte: no se
// recorta ni caduca. El sobrante y el exceso del mes se miden contra la base (assigned −
// ampliado), así que el consumo sale primero del Excel/provisional.
//
// Reparto por posición (Roberto, 2026-10-16): cada posición conserva su propio porcentaje
// y algunas no recortan el primer mes del proyecto (el de la Fecha Inicio Contable, el mes
// de setup): ese mes todo el sobrante pasa como libres.
export const CARRY_FORWARD_PCT = 0.25 // regla de siempre: 75% inutilizables / 25% libres

export interface ReglaCarry {
  libres: number // fracción del sobrante que pasa como libres
  primerMesSinCorte: boolean // el mes de inicio del proyecto no se recorta
}

const REGLA_DE_SIEMPRE: ReglaCarry = { libres: CARRY_FORWARD_PCT, primerMesSinCorte: false }

// Sin mayúsculas, tildes ni espacios de más: el nombre viene del Excel y del catálogo.
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')

const REGLAS = new Map<string, ReglaCarry>(
  (
    [
      ['CRM', 0.3, true],
      ['Project Manager', 0.3, true],
      ['Growth Strategist', 0.3, true],
      ['SEO Strategist', 0.3, true],
      ['SEO Content Strategist', 0.3, true],
      ['SEO Asistente', 0.3, true],
      ['Sales Coach', 0.3, true],
      ['Copywriter', 0.5, true],
      ['Hiring Manager', 0.25, true],
      ['Asistente RRHH', 0.25, true],
      ['Director de Operaciones', 0.25, false],
      ['BDR', 0.1, false],
    ] as const
  ).map(([posicion, libres, primerMesSinCorte]) => [normalizar(posicion), { libres, primerMesSinCorte }]),
)

// Regla de una posición; las que no están en la lista (Administración, posiciones nuevas)
// siguen con la de siempre.
export function reglaCarry(position: string): ReglaCarry {
  return REGLAS.get(normalizar(position)) ?? REGLA_DE_SIEMPRE
}

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
  monthly: Pick<BancoMensual, 'month' | 'assigned' | 'consumed' | 'ampliado'>[],
  mesActual: string,
  // `mesInicio`: 'YYYY-MM' de la Fecha Inicio Contable del proyecto ('' si no tiene).
  { regla = REGLA_DE_SIEMPRE, mesInicio = '' }: { regla?: ReglaCarry; mesInicio?: string } = {},
): { porMes: CarryMes[]; totales: CarryTotales } {
  const porMes: CarryMes[] = []
  let inutilizables = 0
  let carryBruto = 0
  let excesos = 0
  for (const m of monthly) {
    if (m.month >= mesActual) continue // mes en curso (o futuro): sin corte
    // (x + a) − a no siempre da x en coma flotante: sin redondear, un consumo igual a la
    // base dejaría un sobrante o un exceso de 1e-15 (y un estado que no es).
    const base = m.ampliado ? Math.round((m.assigned - m.ampliado) * 1e9) / 1e9 : m.assigned
    const sobrante = Math.max(base - m.consumed, 0)
    const exceso = Math.max(m.consumed - base, 0)
    const sinCorte = regla.primerMesSinCorte && mesInicio !== '' && m.month === mesInicio
    // 0,3 y 0,1 no son exactos en coma flotante (0,3 × 10 = 3,0000000000000004): sin
    // redondear, un disponible que es 0 quedaría en 1e-15 y el estado no sería el que es.
    const libres = sinCorte ? sobrante : Math.round(regla.libres * sobrante * 1e9) / 1e9
    const inutil = sobrante - libres // complemento exacto (evita drift de flotantes)
    porMes.push({ month: m.month, libres, inutilizables: inutil, exceso })
    inutilizables += inutil
    carryBruto += libres
    excesos += exceso
  }
  return { porMes, totales: { inutilizables, carryBruto, carryNeto: Math.max(carryBruto - excesos, 0) } }
}
