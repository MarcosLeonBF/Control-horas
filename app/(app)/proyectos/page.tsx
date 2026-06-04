import Link from 'next/link'
import { getCachedBancoHoras } from '@/lib/graph/client'
import { createAdminClient } from '@/lib/supabase/admin'
import ActualizarBancoButton from '@/components/ActualizarBancoButton'

function fmt(n: number) {
  return n % 1 === 0 ? String(n) : n.toFixed(1)
}

export default async function ProyectosPage() {
  const supabase = createAdminClient()

  // Horas del Excel
  let bancoHoras: { project: string; totalHours: number }[] = []
  try {
    bancoHoras = await getCachedBancoHoras()
  } catch {
    // Si Graph falla, mostramos igual con consumidos desde la DB
  }

  // Horas consumidas por proyecto (todos los usuarios)
  const { data: consumidos } = await supabase
    .from('time_entries')
    .select('project, hours')

  const consumidoMap: Record<string, number> = {}
  for (const row of consumidos ?? []) {
    consumidoMap[row.project] = (consumidoMap[row.project] ?? 0) + Number(row.hours)
  }

  // Armar lista completa: proyectos del Excel + "Departamento"
  const proyectosExcel = bancoHoras.map((item) => ({
    project:      item.project,
    totalHours:   item.totalHours,
    consumed:     consumidoMap[item.project] ?? 0,
    isDepartamento: false,
  }))

  const deptConsumed = consumidoMap['Departamento'] ?? 0
  const departamento = {
    project:        'Departamento',
    totalHours:     0,
    consumed:       deptConsumed,
    isDepartamento: true,
  }

  const allProjects = [...proyectosExcel, departamento]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Proyectos</h1>
          <p className="mt-1 text-sm text-gray-500">{proyectosExcel.length} proyectos en el banco</p>
        </div>
        <ActualizarBancoButton />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {allProjects.map((p) => {
          const remaining = p.totalHours - p.consumed
          const exceeded  = !p.isDepartamento && p.consumed > p.totalHours
          const pct       = p.isDepartamento
            ? 0
            : Math.min((p.consumed / p.totalHours) * 100, 100)

          return (
            <Link
              key={p.project}
              href={`/proyectos/${encodeURIComponent(p.project)}`}
              className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <span className="font-medium text-gray-900 text-sm leading-tight">{p.project}</span>
                {exceeded && (
                  <span className="shrink-0 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                    Excedido
                  </span>
                )}
                {p.isDepartamento && (
                  <span className="shrink-0 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    Ilimitado
                  </span>
                )}
              </div>

              {!p.isDepartamento && (
                <>
                  {/* Barra de progreso */}
                  <div className="h-1.5 w-full rounded-full bg-gray-100 mb-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${exceeded ? 'bg-red-500' : 'bg-blue-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Consumido: <strong className="text-gray-700">{fmt(p.consumed)}h</strong></span>
                    {exceeded ? (
                      <span className="text-red-600 font-medium">+{fmt(p.consumed - p.totalHours)}h excedido</span>
                    ) : (
                      <span>Restante: <strong className="text-gray-700">{fmt(remaining)}h</strong></span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    Total: {fmt(p.totalHours)}h
                  </div>
                </>
              )}

              {p.isDepartamento && (
                <div className="text-xs text-gray-500">
                  Consumido: <strong className="text-gray-700">{fmt(p.consumed)}h</strong>
                </div>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
