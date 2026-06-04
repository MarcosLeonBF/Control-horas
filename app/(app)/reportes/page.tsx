import { Suspense } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import FiltrosReportes from '@/components/FiltrosReportes'
import DescargaButtons from '@/components/DescargaButtons'
import type { TimeEntry } from '@/lib/types'

interface SearchParams {
  proyecto?:     string
  especialista?: string
  desde?:        string
  hasta?:        string
}

interface Props {
  searchParams: Promise<SearchParams>
}

function fmt(n: number) {
  return n % 1 === 0 ? String(n) : n.toFixed(1)
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export default async function ReportesPage({ searchParams }: Props) {
  const filters  = await searchParams
  const supabase = createAdminClient()

  // Consulta base con filtros
  let query = supabase
    .from('time_entries')
    .select('*')
    .order('entry_date', { ascending: false })

  if (filters.proyecto)     query = query.eq('project', filters.proyecto)
  if (filters.especialista) query = query.eq('specialist_email', filters.especialista)
  if (filters.desde)        query = query.gte('entry_date', filters.desde)
  if (filters.hasta)        query = query.lte('entry_date', filters.hasta)

  const { data } = await query
  const entries = (data ?? []) as TimeEntry[]

  // Opciones para los filtros (todos los registros, sin filtro)
  const { data: todos } = await supabase
    .from('time_entries')
    .select('project, specialist_email, specialist_name')

  const proyectosUnicos = [...new Set((todos ?? []).map((r) => r.project))].sort()
  const especialistasMap: Record<string, string> = {}
  for (const r of todos ?? []) {
    especialistasMap[r.specialist_email] = r.specialist_name || r.specialist_email
  }
  const especialistas = Object.entries(especialistasMap).map(([email, name]) => ({ email, name }))

  // Totales por proyecto
  const porProyecto: Record<string, number> = {}
  for (const e of entries) {
    porProyecto[e.project] = (porProyecto[e.project] ?? 0) + Number(e.hours)
  }
  const proyectoRows = Object.entries(porProyecto)
    .sort((a, b) => b[1] - a[1])

  // Totales por especialista
  const porEspecialista: Record<string, { name: string; hours: number }> = {}
  for (const e of entries) {
    const k = e.specialist_email
    if (!porEspecialista[k]) {
      porEspecialista[k] = { name: e.specialist_name || e.specialist_email, hours: 0 }
    }
    porEspecialista[k].hours += Number(e.hours)
  }
  const especialistaRows = Object.values(porEspecialista).sort((a, b) => b.hours - a.hours)

  // Matriz proyecto × especialista
  const matrix: Record<string, Record<string, number>> = {}
  for (const e of entries) {
    if (!matrix[e.project]) matrix[e.project] = {}
    const esp = e.specialist_name || e.specialist_email
    matrix[e.project][esp] = (matrix[e.project][esp] ?? 0) + Number(e.hours)
  }
  const matrizEspecialistas = [...new Set(entries.map((e) => e.specialist_name || e.specialist_email))]
  const matrizProyectos     = Object.keys(matrix).sort()

  const totalGeneral = entries.reduce((s, e) => s + Number(e.hours), 0)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Reportes</h1>
        <p className="mt-1 text-sm text-gray-500">Totales y detalle de horas registradas</p>
      </div>

      {/* Filtros */}
      <Suspense>
        <FiltrosReportes proyectos={proyectosUnicos} especialistas={especialistas} />
      </Suspense>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No hay registros que coincidan con los filtros aplicados.
        </div>
      ) : (
        <>
          {/* Botones de descarga */}
          <DescargaButtons entries={entries} />

          {/* Resumen rápido */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500 mb-1">Total horas</p>
              <p className="text-2xl font-bold text-gray-900">{fmt(totalGeneral)}h</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500 mb-1">Proyectos</p>
              <p className="text-2xl font-bold text-gray-900">{proyectoRows.length}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500 mb-1">Registros</p>
              <p className="text-2xl font-bold text-gray-900">{entries.length}</p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-6 mb-8">
            {/* Horas por proyecto */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Horas por proyecto</h2>
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="px-4 py-2 text-left">Proyecto</th>
                      <th className="px-4 py-2 text-right">Horas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {proyectoRows.map(([p, h]) => (
                      <tr key={p} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-700">{p}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{fmt(h)}h</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">Total</td>
                      <td className="px-4 py-2 text-right font-bold text-gray-900">{fmt(totalGeneral)}h</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Horas por especialista */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Horas por especialista</h2>
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="px-4 py-2 text-left">Especialista</th>
                      <th className="px-4 py-2 text-right">Horas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {especialistaRows.map((r) => (
                      <tr key={r.name} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-700">{r.name}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{fmt(r.hours)}h</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">Total</td>
                      <td className="px-4 py-2 text-right font-bold text-gray-900">{fmt(totalGeneral)}h</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

          {/* Matriz proyecto × especialista (solo si hay más de 1 especialista) */}
          {matrizEspecialistas.length > 1 && matrizProyectos.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">
                Horas por proyecto y especialista
              </h2>
              <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="px-4 py-2 text-left">Proyecto</th>
                      {matrizEspecialistas.map((e) => (
                        <th key={e} className="px-4 py-2 text-right">{e}</th>
                      ))}
                      <th className="px-4 py-2 text-right font-bold">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {matrizProyectos.map((p) => {
                      const total = Object.values(matrix[p]).reduce((s, v) => s + v, 0)
                      return (
                        <tr key={p} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-gray-700">{p}</td>
                          {matrizEspecialistas.map((e) => (
                            <td key={e} className="px-4 py-2 text-right text-gray-600">
                              {matrix[p][e] ? `${fmt(matrix[p][e])}h` : '—'}
                            </td>
                          ))}
                          <td className="px-4 py-2 text-right font-bold text-gray-900">{fmt(total)}h</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Detalle completo */}
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Detalle de registros</h2>
            <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Especialista</th>
                    <th className="px-4 py-3 text-left">Proyecto</th>
                    <th className="px-4 py-3 text-left">Etapa</th>
                    <th className="px-4 py-3 text-left">Fecha</th>
                    <th className="px-4 py-3 text-right">Horas</th>
                    <th className="px-4 py-3 text-left">Descripción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {entries.map((e) => (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-700">{e.specialist_name || e.specialist_email}</td>
                      <td className="px-4 py-2 text-gray-700">{e.project}</td>
                      <td className="px-4 py-2 text-gray-600">{e.stage}</td>
                      <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{fmtDate(e.entry_date)}</td>
                      <td className="px-4 py-2 text-right font-medium text-gray-900">{fmt(Number(e.hours))}h</td>
                      <td className="px-4 py-2 text-gray-500 max-w-xs truncate">
                        {e.description ?? <span className="italic text-gray-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={4} className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Total</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(totalGeneral)}h</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
