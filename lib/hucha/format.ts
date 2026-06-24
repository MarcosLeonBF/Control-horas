import type { HuchaStatus } from '@/lib/hucha/types'

const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })

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
