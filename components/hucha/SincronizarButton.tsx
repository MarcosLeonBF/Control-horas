'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { sincronizarHucha } from '@/app/(hucha)/presupuestos/sincronizar/actions'
import type { SyncReport } from '@/lib/hucha/sync'

export default function SincronizarButton() {
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<SyncReport | null>(null)

  async function onSync() {
    setLoading(true)
    const res = await sincronizarHucha()
    setLoading(false)
    if (!res.ok) { toast.error(res.error); return }
    setReport(res.report)
    toast.success('Sincronización completada')
  }

  return (
    <div className="space-y-4">
      <button onClick={onSync} disabled={loading} className="rounded bg-brand px-4 py-2 text-white">
        {loading ? 'Sincronizando…' : 'Sincronizar con Excel'}
      </button>

      {report && (
        <div className="rounded-lg border border-border p-4 text-sm">
          <p>Proyectos creados: <strong>{report.proyectosCreados}</strong></p>
          <p>Proyectos actualizados: <strong>{report.proyectosActualizados}</strong></p>
          <p>Managers asignados: <strong>{report.managersAsignados}</strong></p>
          <p>Saltados (sin HUCHA): <strong>{report.saltadosSinHucha}</strong></p>
          {report.managersNoEncontrados.length > 0 && (
            <div className="mt-2">
              <p className="text-(--excedido)">Managers no encontrados ({report.managersNoEncontrados.length}):</p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {report.managersNoEncontrados.map((m, i) => <li key={i}>{m.proyecto} — "{m.manager}"</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
