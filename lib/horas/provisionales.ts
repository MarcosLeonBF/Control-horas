import type { BancoMensual } from '@/lib/horas/bancos-status'
import { addMonths } from '@/lib/horas/format'

// Mayor mes 'YYYY-MM' con filas reales en cualquier proyecto (último registro global).
// '' si no hay meses. La carga del Excel es en lote, así que el máximo global es un
// piso seguro para la ventana.
export function ultimoRegistroGlobal(excel: { months: { month: string }[] }[]): string {
  let max = ''
  for (const p of excel) for (const m of p.months) if (m.month > max) max = m.month
  return max
}

// Meses (YYYY-MM) de la ventana (ultimoGlobal, mesActual]. Vacío si ultimoGlobal es ''
// o ya alcanzó mesActual.
export function mesesVentana(ultimoGlobal: string, mesActual: string): string[] {
  if (!ultimoGlobal || ultimoGlobal >= mesActual) return []
  const out: string[] = []
  let m = addMonths(ultimoGlobal, 1)
  while (m <= mesActual) { out.push(m); m = addMonths(m, 1) }
  return out
}

export interface ProyectoProvisionalMeta {
  tipoContrato: string
  estado: string
  inicioContable: string // ISO 'YYYY-MM-DD' o ''
  finContable: string    // ISO 'YYYY-MM-DD' o ''
}

// Entradas mensuales provisionales por posición para un proyecto: para cada mes de la
// ventana que NO sea real y cumpla los criterios, la tarifa por posición. Vacío si el
// proyecto no es elegible o no hay tarifa (el caller loguea el caso sin tarifa).
// Para un proyecto sin registros reales (mesesReales vacío), el mes de inicioContable usa
// `tarifaSetup` (tarifa de arranque) cuando se provee; el resto de meses usa `tarifa`.
export function provisionalPorPosicion(
  meta: ProyectoProvisionalMeta,
  mesesReales: Set<string>,
  ventana: string[],
  tarifa: Map<string, number> | undefined,
  tarifaSetup?: Map<string, number>,
): Map<string, BancoMensual[]> {
  const out = new Map<string, BancoMensual[]>()
  if (!tarifa) return out                                    // sin tarifa
  if (meta.estado.toLowerCase().includes('paus')) return out // Estado Pausa fuera
  if (meta.inicioContable === '') return out                 // sin inicio: no ubicable
  const inicioMes = meta.inicioContable.slice(0, 7)
  const finMes = meta.finContable ? meta.finContable.slice(0, 7) : ''
  // Proyecto nuevo = sin ningún registro real en BancoHoras. Su mes de arranque
  // (inicioMes), si cae en la ventana, usa la tarifa de setup; el resto, la normal.
  const esNuevo = mesesReales.size === 0
  for (const M of ventana) {
    if (mesesReales.has(M)) continue   // ya hay fila real ese mes
    if (inicioMes > M) continue        // aún no arrancó
    if (finMes && finMes < M) continue // ya finalizó
    const tabla = (esNuevo && M === inicioMes && tarifaSetup) ? tarifaSetup : tarifa
    for (const [position, hours] of tabla) {
      if (hours <= 0) continue
      const arr = out.get(position) ?? []
      arr.push({ month: M, assigned: hours, consumed: 0, provisional: true })
      out.set(position, arr)
    }
  }
  return out
}
