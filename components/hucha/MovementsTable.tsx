import type { HuchaMovementRow } from '@/lib/hucha/types'
import { formatEUR } from '@/lib/hucha/format'

const TYPE_LABELS: Record<HuchaMovementRow['type'], string> = {
  consumo: 'Consumo', ampliacion: 'Ampliación', correccion: 'Corrección', anulacion: 'Anulación',
}

export default function MovementsTable({ movements }: { movements: HuchaMovementRow[] }) {
  if (movements.length === 0) {
    return <p className="text-sm text-foreground/55">Sin movimientos todavía.</p>
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-(--muted-surface) text-left text-xs text-foreground/55">
          <tr>
            <th className="px-4 py-3 font-medium">Fecha</th>
            <th className="px-4 py-3 font-medium">Tipo</th>
            <th className="px-4 py-3 font-medium">Descripción</th>
            <th className="px-4 py-3 font-medium text-right">Importe</th>
            <th className="px-4 py-3 font-medium text-right">Saldo</th>
            <th className="px-4 py-3 font-medium">Por</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {movements.map((m) => (
            <tr key={m.id}>
              <td className="px-4 py-3 text-foreground/70">{m.entry_date}</td>
              <td className="px-4 py-3">{TYPE_LABELS[m.type]}</td>
              <td className="px-4 py-3 text-foreground/70">{m.description ?? m.reason ?? '—'}</td>
              <td className={`px-4 py-3 text-right tabular-money ${m.amount < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                {m.amount < 0 ? '' : '+'}{formatEUR(m.amount)}
              </td>
              <td className="px-4 py-3 text-right tabular-money text-foreground/70">{formatEUR(m.balance_after)}</td>
              <td className="px-4 py-3 text-foreground/55">{m.actor_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
