import { CircleCheck, TrendingDown, CircleMinus, AlertTriangle, CircleDashed, type LucideIcon } from 'lucide-react'
import type { HorasStatus } from '@/lib/horas/bancos-status'
import { HORAS_STATUS_LABELS } from '@/lib/horas/bancos-status'
import { TONO } from '@/components/ui/tono'

const STYLES: Record<HorasStatus, string> = {
  disponible: TONO.disponible,
  bajo: TONO.bajo,
  consumido: TONO.consumido,
  excedido: TONO.excedido,
  sin_asignacion: TONO.sin,
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

export default function HorasStatusBadge({ status, label, title }: { status: HorasStatus; label?: string; title?: string }) {
  const Icon = ICONS[status]
  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{label ?? HORAS_STATUS_LABELS[status]}</span>
    </span>
  )
}
