import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getBancoHorasDetalle, type BancosScope } from '@/lib/horas/bancos'
import { getCachedProyectosEstado } from '@/lib/graph/client'
import { getViewerScope } from '@/lib/horas/scope'
import { formatFechaISO } from '@/lib/horas/format'
import { estadoProyectoBadgeClass } from '@/lib/horas/bancos-status'
import { cn } from '@/lib/utils'
import HorasStatusBadge from '@/components/horas/HorasStatusBadge'
import AmpliarHorasForm from '@/components/horas/AmpliarHorasForm'
import BancoDetalleView from '@/components/horas/BancoDetalleView'

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
  let meta: { estado: string; manager: string; fechaAuditoria: string } | undefined
  try {
    meta = (await getCachedProyectosEstado()).find((e) => e.project.trim() === project)
  } catch { /* Excel no disponible: sin metadatos */ }

  return (
    <div>
      <Link href="/bancos" className="text-xs text-foreground/55 hover:text-foreground">← Bancos de horas</Link>

      <header className="mt-3 mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{project}</h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
            {meta?.estado && (
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', estadoProyectoBadgeClass(meta.estado))}>{meta.estado}</span>
            )}
            <span className="text-muted-foreground">
              Manager <span className="font-medium text-foreground/85">{meta?.manager || '—'}</span>
            </span>
            {meta?.fechaAuditoria && (
              <span className="text-muted-foreground">
                Auditoría <span className="font-medium text-foreground/85">{formatFechaISO(meta.fechaAuditoria)}</span>
              </span>
            )}
          </div>
        </div>
        <HorasStatusBadge status={d.status} />
      </header>

      {isAdmin && <div className="mb-10"><AmpliarHorasForm project={project} /></div>}

      <BancoDetalleView d={d} isAdmin={isAdmin} />
    </div>
  )
}
