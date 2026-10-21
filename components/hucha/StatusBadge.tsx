import type { HuchaStatus } from '@/lib/hucha/types'
import { STATUS_LABELS } from '@/lib/hucha/format'
import { TONO } from '@/components/ui/tono'

const STYLES: Record<HuchaStatus, string> = {
  disponible: TONO.disponible,
  bajo: TONO.bajo,
  consumido: TONO.consumido,
  excedido: TONO.excedido,
  sin_presupuesto: TONO.sin,
}

export default function StatusBadge({ status }: { status: HuchaStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}
