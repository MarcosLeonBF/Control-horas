import { createClient } from '@/lib/supabase/server'
import type { ReporteLine } from '@/lib/horas/reportes-types'
import { finDeMes } from '@/lib/horas/format'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

interface RawHistorica {
  month: string
  project: string
  department: string
  etapa: string
  hours: number
  user_id: string
  profiles: { full_name: string; positions: { name: string } | null } | null
}

// Traduce los cierres mensuales de horas_historicas a ReporteLine, fechados al último
// día de su mes (spec 2026-07-21-horas-historicas-reportes). Con rango, recorta al día
// exacto; sin rango, devuelve todo el histórico.
//
// La usan /reportes (con rango) y /historico (sin rango): vive aquí para que las dos
// pantallas no puedan desincronizarse en el mapeo ni en la normalización de etapa.
export async function getHistoricoLines(from?: string, to?: string): Promise<ReporteLine[]> {
  const supabase = await createClient()

  // Paginado: son ~2.000 filas y PostgREST corta en 1.000 por petición.
  const [data, { data: etapas }] = await Promise.all([
    fetchAllRows<RawHistorica>((desde, hasta) => {
      let q = supabase
        .from('horas_historicas')
        .select('month, project, department, etapa, hours, user_id, profiles(full_name, positions(name))')
      // Se acota por mes; el recorte fino al día lo hace finDeMes más abajo.
      if (from) q = q.gte('month', from.slice(0, 7))
      if (to) q = q.lte('month', to.slice(0, 7))
      return q.range(desde, hasta)
    }),
    supabase.from('etapas').select('name'),
  ])

  // El histórico guarda la etapa como texto tal cual vino de la hoja. Se casa con el
  // catálogo ignorando mayúsculas para que "Servicios mensuales" (1.331 filas) no salga
  // como una etapa distinta de "Servicios Mensuales" al agrupar.
  const canonica = new Map<string, string>()
  for (const e of (etapas ?? []) as { name: string }[]) canonica.set(e.name.toLocaleLowerCase('es'), e.name)

  const lines: ReporteLine[] = []
  for (const h of data) {
    const date = finDeMes(h.month)
    if ((from && date < from) || (to && date > to)) continue // el cierre cae fuera del rango
    lines.push({
      date,
      project: h.project,
      area: '—', // el histórico no trae área
      etapa: canonica.get(h.etapa.toLocaleLowerCase('es')) ?? h.etapa,
      department: h.department,
      userId: h.user_id,
      user: h.profiles?.full_name ?? '—',
      position: h.profiles?.positions?.name ?? '—',
      hours: Number(h.hours),
      description: '', // el histórico no trae descripción
      isInternal: h.project === 'Departamento',
      historico: true,
    })
  }
  return lines
}
