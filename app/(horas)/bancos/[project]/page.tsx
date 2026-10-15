import { redirect } from 'next/navigation'
import { getBancoHorasDetalle, type BancosScope } from '@/lib/horas/bancos'
import { getCachedProyectosEstado } from '@/lib/graph/client'
import { getViewerScope } from '@/lib/horas/scope'
import { esManagerDelProyecto } from '@/lib/horas/ampliar-permisos'
import { candidatosManager } from '@/lib/horas/candidatos-manager'
import BancoDetalleView, { type MetaProyecto } from '@/components/horas/BancoDetalleView'

export default async function BancoDetallePage({ params }: { params: Promise<{ project: string }> }) {
  const { project: raw } = await params
  const project = decodeURIComponent(raw)

  const viewer = await getViewerScope()
  if (!viewer) redirect('/login')
  if (viewer.role !== 'manager' && viewer.role !== 'admin') redirect('/registrar')

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

  // «Ampliar horas»: el admin, o el manager del proyecto según el Excel (spec 2026-10-15).
  // Solo decide si se ve el botón; la acción lo vuelve a comprobar.
  let puedeAmpliar = viewer.role === 'admin'
  if (viewer.role === 'manager' && meta) {
    try {
      puedeAmpliar = esManagerDelProyecto(meta.manager, viewer.userId, await candidatosManager())
    } catch { /* sin perfiles: sin botón */ }
  }

  // La cabecera la pinta la vista: comparte fila con el periodo y con "Ampliar horas".
  return <BancoDetalleView d={d} viewer={{ role: viewer.role, userId: viewer.userId, puedeAmpliar }} meta={meta} />
}
