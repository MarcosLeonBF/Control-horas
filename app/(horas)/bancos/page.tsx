import { redirect } from 'next/navigation'
import { getBancosHoras, type BancosScope } from '@/lib/horas/bancos'
import type { BancoHorasRow } from '@/lib/horas/bancos-status'
import { getViewerScope } from '@/lib/horas/scope'
import { createAdminClient } from '@/lib/supabase/admin'
import { casarPorNombre } from '@/lib/casar-nombre'
import BancosHorasClient from '@/components/horas/BancosHorasClient'

// El «Manager del proyecto» del Excel que es el manager en sesión, para dejarlo puesto en
// el filtro al entrar. El Excel trae el nombre de pila ("Jen"), así que se casa como en
// los avisos, pero solo contra quien puede abrir esta página (managers y admins activos):
// así "Estefania" no choca con una operativa del mismo nombre. Sin casado único, Todos.
async function managerDelViewer(userId: string, rows: BancoHorasRow[]): Promise<string | undefined> {
  const { data } = await createAdminClient()
    .from('profiles').select('id, full_name').in('role', ['manager', 'admin']).eq('status', 'activo')
  const perfiles = (data ?? []) as { id: string; full_name: string | null }[]
  const nombres = [...new Set(rows.map((r) => (r.manager ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  return nombres.find((n) => casarPorNombre(n, perfiles, (p) => p.full_name ?? '')?.id === userId)
}

export default async function BancosPage() {
  const viewer = await getViewerScope()
  if (!viewer) redirect('/login')
  if (viewer.role !== 'manager' && viewer.role !== 'admin') redirect('/registrar')

  const scope: BancosScope =
    viewer.role === 'admin' ? { role: 'admin' } : { role: 'manager', areaIds: viewer.areaIds }
  const rows = await getBancosHoras(scope)
  // Solo el manager entra filtrado en lo suyo; el admin, con la vista global.
  const managerInicial = viewer.role === 'manager' ? await managerDelViewer(viewer.userId, rows) : undefined

  // El título lo pinta el cliente: comparte fila con el selector de periodo.
  return <BancosHorasClient rows={rows} managerInicial={managerInicial} />

}
