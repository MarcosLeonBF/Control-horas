import { createAdminClient } from '@/lib/supabase/admin'
import { getCachedBancoHoras } from '@/lib/graph/client'
import { computeHorasStatus, type BancoHorasRow, type BancoHorasDetalle, type AmpliacionHoras } from '@/lib/horas/bancos-status'

// Alcance de quién mira los bancos (PDF §15: "ver bancos de su equipo o área").
//   admin   → todos los proyectos
//   manager → solo los proyectos donde su equipo ha registrado horas
// El banco es compartido por proyecto, así que el consumido/asignado mostrados son
// SIEMPRE los totales reales del banco (no la porción del equipo). Por eso leemos
// con el cliente admin y aplicamos el alcance en código.
export type BancosScope = { role: 'admin' } | { role: 'manager'; teamUserIds: string[] }

const inTeam = (scope: BancosScope, userId: string) =>
  scope.role === 'admin' || scope.teamUserIds.includes(userId)

// Banco de horas POR PROYECTO: asignado del Excel (lectura en vivo) vs. consumido (DB).
export async function getBancosHoras(scope: BancosScope): Promise<BancoHorasRow[]> {
  let excel: { project: string; totalHours: number }[] = []
  try {
    excel = await getCachedBancoHoras()
  } catch {
    excel = [] // Excel caído: devolvemos vacío en vez de romper la página.
  }

  const db = createAdminClient()
  const [{ data: lines }, { data: amps }] = await Promise.all([
    db
      .from('time_log_lines')
      .select('project, hours, time_logs!inner(status, user_id)')
      .neq('time_logs.status', 'anulado'),
    db.from('horas_ampliaciones').select('project, hours').eq('active', true),
  ])

  // Consumido total por proyecto + qué proyectos toca el equipo del manager.
  const consumedByProject = new Map<string, number>()
  const projectsInScope = new Set<string>()
  for (const l of (lines ?? []) as unknown as { project: string; hours: number; time_logs: { user_id: string } }[]) {
    const key = l.project.trim()
    consumedByProject.set(key, (consumedByProject.get(key) ?? 0) + Number(l.hours))
    if (inTeam(scope, l.time_logs.user_id)) projectsInScope.add(key)
  }

  // Ampliaciones activas: suman al asignado (sobre la base del Excel).
  const ampByProject = new Map<string, number>()
  for (const a of (amps ?? []) as { project: string; hours: number }[]) {
    const key = a.project.trim()
    ampByProject.set(key, (ampByProject.get(key) ?? 0) + Number(a.hours))
  }

  return excel
    .filter((e) => scope.role === 'admin' || projectsInScope.has(e.project.trim()))
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
// `inScope` indica si el manager puede ver este proyecto (su equipo lo registra).
export async function getBancoHorasDetalle(
  project: string,
  scope: BancosScope,
): Promise<BancoHorasDetalle & { inScope: boolean }> {
  const name = project.trim()

  let excelBase = 0
  try {
    const excel = await getCachedBancoHoras()
    excelBase = Number(excel.find((e) => e.project.trim() === name)?.totalHours ?? 0)
  } catch {
    excelBase = 0
  }

  const db = createAdminClient()
  const [{ data: lines }, { data: amps }] = await Promise.all([
    db
      .from('time_log_lines')
      .select('hours, time_logs!inner(status, user_id)')
      .eq('project', name)
      .neq('time_logs.status', 'anulado'),
    db
      .from('horas_ampliaciones')
      .select('id, project, hours, reason, entry_date, actor_name, active')
      .eq('project', name)
      .order('entry_date', { ascending: false }),
  ])

  const rawLines = (lines ?? []) as unknown as { hours: number; time_logs: { user_id: string } }[]
  const consumed = rawLines.reduce((s, l) => s + Number(l.hours), 0)
  const inScope = scope.role === 'admin' || rawLines.some((l) => inTeam(scope, l.time_logs.user_id))

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
    inScope,
  }
}
