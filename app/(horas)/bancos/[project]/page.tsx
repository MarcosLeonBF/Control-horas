import { redirect } from 'next/navigation'
import { getBancoHorasDetalle, type BancosScope } from '@/lib/horas/bancos'
import { getCachedProyectosEstado } from '@/lib/graph/client'
import { getViewerScope } from '@/lib/horas/scope'
import BancoDetalleView, { type MetaProyecto } from '@/components/horas/BancoDetalleView'

export default async function BancoDetallePage({ params }: { params: Promise<{ project: string }> }) {
  const { project: raw } = await params
  const project = decodeURIComponent(raw)

  const viewer = await getViewerScope()
  if (!viewer) redirect('/login')
  if (viewer.role !== 'manager' && viewer.role !== 'admin') redirect('/registrar')
  const isAdmin = viewer.role === 'admin'

  const scope: BancosScope =
    viewer.role === 'admin' ? { role: 'admin' } : { role: 'manager', areaIds: viewer.areaIds }
  const d = await getBancoHorasDetalle(project, scope)
  // El manager solo accede a proyectos con posiciones de sus áreas.
  if (!d.inScope) redirect('/bancos')

  // Metadatos del proyecto (Excel Clientes_Proyectos): estado, manager, auditoría.
  let meta: MetaProyecto | undefined
  try {
    meta = (await getCachedProyectosEstado()).find((e) => e.project.trim() === project)
  } catch { /* Excel no disponible: sin metadatos */ }

  // La cabecera la pinta la vista: comparte fila con el periodo y con "Ampliar horas".
  return <BancoDetalleView d={d} isAdmin={isAdmin} meta={meta} />
}
