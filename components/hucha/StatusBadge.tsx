import type { HuchaStatus } from '@/lib/hucha/types'
import { STATUS_LABELS } from '@/lib/hucha/format'

const STYLES: Record<HuchaStatus, string> = {
  disponible: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  bajo: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  consumido: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  excedido: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  sin_presupuesto: 'bg-neutral-100 text-neutral-500 ring-neutral-400/20',
}

export default function StatusBadge({ status }: { status: HuchaStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}
