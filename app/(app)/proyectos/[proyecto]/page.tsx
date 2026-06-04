import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCachedBancoHoras } from '@/lib/graph/client'
import type { TimeEntry } from '@/lib/types'

interface Props {
  params: Promise<{ proyecto: string }>
}

function fmt(n: number) {
  return n % 1 === 0 ? String(n) : n.toFixed(1)
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export default async function ProyectoDetallePage({ params }: Props) {
  const { proyecto } = await params
  const nombre = decodeURIComponent(proyecto)

  const supabase = createAdminClient()

  // Registros del proyecto
  const { data: entries, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('project', nombre)
    .order('entry_date', { ascending: false })

  if (error) notFound()

  const rows = (entries ?? []) as TimeEntry[]
  const totalConsumed = rows.reduce((sum, r) => sum + Number(r.hours), 0)

  // Banco de horas del Excel (solo si no es Departamento)
  const isDepartamento = nombre === 'Departamento'
  let totalHours = 0
  if (!isDepartamento) {
    try {
      const banco = await getCachedBancoHoras()
      const item = banco.find((b) => b.project === nombre)
      totalHours = item?.totalHours ?? 0
    } catch {
      // Si Graph falla, totalHours queda en 0
    }
  }

  const remaining = totalHours - totalConsumed
  const exceeded  = !isDepartamento && totalConsumed > totalHours && totalHours > 0

  return (
    <div>
      {/* Cabecera */}
      <div className="mb-6">
        <Link href="/proyectos" className="text-sm text-blue-600 hover:underline mb-2 inline-block">
          ← Volver a proyectos
        </Link>
        <h1 className="text-xl font-semibold text-gray-900">{nombre}</h1>
      </div>

      {/* Resumen del banco */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500 mb-1">Total banco</p>
          <p className="text-lg font-semibold text-gray-900">
            {isDepartamento ? '—' : `${fmt(totalHours)}h`}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500 mb-1">Consumido</p>
          <p className="text-lg font-semibold text-gray-900">{fmt(totalConsumed)}h</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500 mb-1">Restante</p>
          <p className={`text-lg font-semibold ${exceeded ? 'text-red-600' : 'text-gray-900'}`}>
            {isDepartamento ? 'Ilimitado' : exceeded ? `–${fmt(Math.abs(remaining))}h` : `${fmt(remaining)}h`}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500 mb-1">Registros</p>
          <p className="text-lg font-semibold text-gray-900">{rows.length}</p>
        </div>
      </div>

      {exceeded && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-6">
          Este proyecto excedió el banco por <strong>{fmt(Math.abs(remaining))} horas</strong>.
        </div>
      )}

      {/* Tabla de registros */}
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No hay registros para este proyecto.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">Especialista</th>
                <th className="px-4 py-3">Etapa</th>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3 text-right">Horas</th>
                <th className="px-4 py-3">Descripción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700">
                    {row.specialist_name || row.specialist_email}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{row.stage}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(row.entry_date)}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{fmt(Number(row.hours))}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-xs truncate">
                    {row.description ?? <span className="italic text-gray-300">sin descripción</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50">
                <td colSpan={3} className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Total</td>
                <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(totalConsumed)}h</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
