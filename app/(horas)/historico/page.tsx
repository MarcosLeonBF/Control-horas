import { redirect } from 'next/navigation'
import { getHistoricoLines } from '@/lib/horas/historico'
import { getViewerScope } from '@/lib/horas/scope'
import HistoricoMatriz from '@/components/horas/HistoricoMatriz'

// Histórico mensual previo a la plataforma: cierres de mes, no registros diarios.
// Sin rango de fechas a propósito: la gracia es ver todos los meses de una vez.
export default async function HistoricoPage() {
  const viewer = await getViewerScope()
  if (!viewer) redirect('/login')
  if (viewer.role !== 'manager' && viewer.role !== 'admin') redirect('/registrar')

  const lines = await getHistoricoLines()

  return (
    <div className="space-y-7">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Histórico</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Horas anteriores a la plataforma, en cierres mensuales. Cada celda es el total de
          ese mes: no son registros diarios y no traen área ni descripción.
        </p>
      </header>

      <HistoricoMatriz lines={lines} />
    </div>
  )
}
