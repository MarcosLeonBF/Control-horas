import type { HuchaStatus } from '@/lib/hucha/types'

// Dinero sin decimales, redondeado al euro (maximumFractionDigits:0). Separador de
// miles con punto forzado (useGrouping:'always'), porque es-ES no agruparía "1000 €".
const EUR = new Intl.NumberFormat('es-ES', {
  style: 'currency', currency: 'EUR',
  minimumFractionDigits: 0, maximumFractionDigits: 0, useGrouping: 'always',
})

export function formatEUR(n: number): string {
  return EUR.format(n)
}

export const STATUS_LABELS: Record<HuchaStatus, string> = {
  sin_presupuesto: 'Sin presupuesto',
  disponible: 'Disponible',
  bajo: 'Bajo',
  consumido: 'Consumido',
  excedido: 'Excedido',
}
