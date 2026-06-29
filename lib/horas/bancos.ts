import { createClient } from '@/lib/supabase/server'
import { getCachedBancoHoras } from '@/lib/graph/client'
import { computeHorasStatus, type BancoHorasRow, type BancoHorasDetalle, type AmpliacionHoras } from '@/lib/horas/bancos-status'

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
  const [{ data: lines }, { data: amps }] = await Promise.all([
    supabase
      .from('time_log_lines')
      .select('project, hours, time_logs!inner(status)')
      .neq('time_logs.status', 'anulado'),
    supabase.from('horas_ampliaciones').select('project, hours').eq('active', true),
  ])

  const consumedByProject = new Map<string, number>()
  for (const l of (lines ?? []) as unknown as { project: string; hours: number }[]) {
    const key = l.project.trim()
    consumedByProject.set(key, (consumedByProject.get(key) ?? 0) + Number(l.hours))
  }

  // Ampliaciones activas: suman al asignado (sobre la base del Excel).
  const ampByProject = new Map<string, number>()
  for (const a of (amps ?? []) as { project: string; hours: number }[]) {
    const key = a.project.trim()
    ampByProject.set(key, (ampByProject.get(key) ?? 0) + Number(a.hours))
  }

  return excel
    .map((e) => {
      const assigned = Number(e.totalHours) + (ampByProject.get(e.project.trim()) ?? 0)
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

// Detalle de un proyecto: base del Excel, ampliaciones y totales calculados.
export async function getBancoHorasDetalle(project: string): Promise<BancoHorasDetalle> {
  const name = project.trim()

  let excelBase = 0
  try {
    const excel = await getCachedBancoHoras()
    excelBase = Number(excel.find((e) => e.project.trim() === name)?.totalHours ?? 0)
  } catch {
    excelBase = 0
  }

  const supabase = await createClient()
  const [{ data: lines }, { data: amps }] = await Promise.all([
    supabase
      .from('time_log_lines')
      .select('hours, time_logs!inner(status)')
      .eq('project', name)
      .neq('time_logs.status', 'anulado'),
    supabase
      .from('horas_ampliaciones')
      .select('id, project, hours, reason, entry_date, actor_name, active')
      .eq('project', name)
      .order('entry_date', { ascending: false }),
  ])

  const consumed = ((lines ?? []) as unknown as { hours: number }[]).reduce((s, l) => s + Number(l.hours), 0)
  const ampliaciones = (amps ?? []) as AmpliacionHoras[]
  const ampActiveSum = ampliaciones.filter((a) => a.active).reduce((s, a) => s + Number(a.hours), 0)
  const assigned = excelBase + ampActiveSum

  return {
    project: name,
    excelBase,
    ampliaciones,
    assigned,
    consumed,
    remaining: assigned - consumed,
    status: computeHorasStatus(assigned, consumed),
  }
}
