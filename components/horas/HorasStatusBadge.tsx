import { CircleCheck, TrendingDown, CircleMinus, AlertTriangle, CircleDashed, type LucideIcon } from 'lucide-react'
import type { HorasStatus } from '@/lib/horas/bancos-status'
import { HORAS_STATUS_LABELS } from '@/lib/horas/bancos-status'

const STYLES: Record<HorasStatus, string> = {
  disponible: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  bajo: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  consumido: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  excedido: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  sin_asignacion: 'bg-neutral-100 text-neutral-500 ring-neutral-400/20',
}

// Icono descriptivo por estado: el badge se escanea sin leer (y no depende
// solo del color). Mismos iconos que los KPIs de atención (excedido/bajo).
const ICONS: Record<HorasStatus, LucideIcon> = {
  disponible: CircleCheck,
  bajo: TrendingDown,
  consumido: CircleMinus,
  excedido: AlertTriangle,
  sin_asignacion: CircleDashed,
}

export default function HorasStatusBadge({ status }: { status: HorasStatus }) {
  const Icon = ICONS[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}>
      <Icon aria-hidden className="size-3 shrink-0" />
      {HORAS_STATUS_LABELS[status]}
    </span>
  )
}
