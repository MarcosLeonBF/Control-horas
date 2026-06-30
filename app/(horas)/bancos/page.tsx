import { redirect } from 'next/navigation'
import { getBancosHoras, type BancosScope } from '@/lib/horas/bancos'
import { getViewerScope } from '@/lib/horas/scope'
import BancosHorasClient from '@/components/horas/BancosHorasClient'

export default async function BancosPage() {
  const viewer = await getViewerScope()
  if (!viewer) redirect('/login')
  if (viewer.role !== 'manager' && viewer.role !== 'admin') redirect('/registrar')

  const scope: BancosScope =
    viewer.role === 'admin' ? { role: 'admin' } : { role: 'manager', areaIds: viewer.areaIds }
  const rows = await getBancosHoras(scope)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl">Bancos de horas</h1>
        <p className="text-sm text-muted-foreground">Horas asignadas (Excel) frente a las registradas, por proyecto.</p>
      </div>
      <BancosHorasClient rows={rows} />
    </div>
  )
}
