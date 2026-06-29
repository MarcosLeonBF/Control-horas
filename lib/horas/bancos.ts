import { createClient } from '@/lib/supabase/server'
import { getCachedBancoHoras } from '@/lib/graph/client'
import { computeHorasStatus, type BancoHorasRow } from '@/lib/horas/bancos-status'

// Banco de horas POR PROYECTO: asignado del Excel (lectura en vivo) vs. consumido (DB).
// El Excel manda el asignado; los consumos son las líneas de horas registradas.
export async function getBancosHoras(): Promise<BancoHorasRow[]> {
  let excel: { project: string; totalHours: number }[] = []
  try {
    excel = await getCachedBancoHoras()
  } catch {
    excel = [] // Excel caído: devolvemos vacío en vez de romper la página.
  }

  const supabase = await createClient()
  const { data: lines } = await supabase
    .from('time_log_lines')
    .select('project, hours, time_logs!inner(status)')
    .neq('time_logs.status', 'anulado')

  const consumedByProject = new Map<string, number>()
  for (const l of (lines ?? []) as unknown as { project: string; hours: number }[]) {
    const key = l.project.trim()
    consumedByProject.set(key, (consumedByProject.get(key) ?? 0) + Number(l.hours))
  }

  return excel
    .map((e) => {
      const assigned = Number(e.totalHours)
      const consumed = consumedByProject.get(e.project.trim()) ?? 0
      return {
        project: e.project,
        assigned,
        consumed,
        remaining: assigned - consumed,
        status: computeHorasStatus(assigned, consumed),
      }
    })
    .sort((a, b) => a.project.localeCompare(b.project))
}
