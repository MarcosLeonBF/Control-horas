import type { HuchaMovementRow } from '@/lib/hucha/types'
import { formatEUR } from '@/lib/hucha/format'
import { formatFechaISO } from '@/lib/horas/format'
import { cn } from '@/lib/utils'
import AnularButton from '@/components/hucha/AnularButton'

const TYPE_LABELS: Record<HuchaMovementRow['type'], string> = {
  consumo: 'Consumo', ampliacion: 'Ampliación', correccion: 'Corrección', anulacion: 'Anulación',
}
const ANULADO: Record<HuchaMovementRow['type'], string> = {
  consumo: 'anulado', ampliacion: 'anulada', correccion: 'anulada', anulacion: 'anulada',
}

// Signo tipográfico: + entra en la hucha, − sale.
const importe = (n: number) => `${n < 0 ? '−' : '+'}${formatEUR(Math.abs(n))}`

export default function MovementsTable({ movements, isAdmin = false, projectId = '', anulledIds }: {
  movements: HuchaMovementRow[]; isAdmin?: boolean; projectId?: string; anulledIds?: Set<string>
}) {
  if (movements.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
        Sin movimientos todavía.
      </div>
    )
  }
  const porId = new Map(movements.map((m) => [m.id, m]))
  return (
    <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
      <table className="w-full min-w-176 text-sm">
        <thead>
          <tr className="bg-(--muted-surface) text-left text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Fecha</th>
            <th className="px-4 py-2.5 font-medium">Movimiento</th>
            <th className="px-4 py-2.5 font-medium">Detalle</th>
            <th className="px-4 py-2.5 font-medium text-right">Importe</th>
            <th className="px-4 py-2.5 font-medium text-right">Saldo</th>
            <th className="px-4 py-2.5 font-medium">Por</th>
            {isAdmin && <th className="px-4 py-2.5"><span className="sr-only">Acción</span></th>}
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => {
            const anulado = anulledIds?.has(m.id) ?? false
            // La anulación no lleva texto propio: se describe por el movimiento que revierte.
            const original = m.type === 'anulacion' && m.corrects_movement_id ? porId.get(m.corrects_movement_id) : undefined
            const textoOriginal = original?.description ?? original?.reason
            const detalle = original
              ? `${TYPE_LABELS[original.type]} del ${formatFechaISO(original.entry_date)}${textoOriginal ? `: ${textoOriginal}` : ''}`
              : m.description ?? m.reason
            return (
              <tr key={m.id} className={cn('border-t border-border', anulado && 'text-muted-foreground')}>
                <td className="tabular-money px-4 py-2.5 whitespace-nowrap">{formatFechaISO(m.entry_date)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span className={cn(m.type === 'ampliacion' && !anulado && 'text-(--brand)', m.type === 'anulacion' && 'text-muted-foreground')}>
                    {TYPE_LABELS[m.type]}
                  </span>
                  {anulado && (
                    <span className="ml-2 rounded-full bg-(--muted-surface) px-1.5 py-px text-[0.65rem] font-medium">{ANULADO[m.type]}</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className={cn(anulado && 'line-through')}>{detalle ?? <span className="text-muted-foreground/40">—</span>}</div>
                  {m.reference && <div className="mt-0.5 text-xs text-muted-foreground">Ref. {m.reference}</div>}
                </td>
                <td className={cn('tabular-money px-4 py-2.5 text-right whitespace-nowrap', anulado ? 'line-through' : m.type === 'ampliacion' && 'text-(--brand)')}>
                  {importe(Number(m.amount))}
                </td>
                <td className={cn('tabular-money px-4 py-2.5 text-right whitespace-nowrap', m.balance_after < 0 ? 'text-(--status-excedido)' : 'text-foreground/70')}>
                  {formatEUR(m.balance_after)}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-foreground/70">{m.actor_name || <span className="text-muted-foreground/40">—</span>}</td>
                {isAdmin && (
                  <td className="px-4 py-2.5 text-right">
                    <AnularButton projectId={projectId} movementId={m.id} disabled={m.type === 'anulacion' || anulado} />
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
