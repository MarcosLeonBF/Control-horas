import { createAdminClient } from '@/lib/supabase/admin'
import { getCachedBancoHoras, getCachedProyectosEstado } from '@/lib/graph/client'
import { computeHorasStatus, HORAS_SEVERITY, type BancoHorasRow, type BancoHorasDetalle, type AmpliacionHoras, type MovimientoBanco, type BancoMensual, type BancoDetalleMensual } from '@/lib/horas/bancos-status'
import type { BancoHorasProyecto } from '@/lib/types'

// Banco de horas POR POSICIÓN (PDF + lógica nueva):
//   - Asignado: cada columna del Excel (CRM, SEO, Growth Strategists…) por proyecto.
//   - Consumido: horas registradas por usuarios cuya posición = esa posición.
//   - Alcance: admin ve todas las posiciones; el manager ve solo las posiciones
//     ligadas a sus áreas asignadas (positions ↔ areas).
export type BancosScope = { role: 'admin' } | { role: 'manager'; areaIds: string[] }

const key = (project: string, position: string) => `${project}\0${position}`

// Catálogo de posiciones + qué posiciones quedan dentro del alcance.
async function loadPositionContext(scope: BancosScope) {
  const db = createAdminClient()
  const [{ data: positions }, { data: posAreas }, { data: profiles }] = await Promise.all([
    db.from('positions').select('id, name'),
    db.from('position_areas').select('position_id, area_id'),
    db.from('profiles').select('id, position_id'),
  ])

  const posNameById = new Map<string, string>()
  for (const p of (positions ?? []) as { id: string; name: string }[]) posNameById.set(p.id, p.name)

  // Posiciones visibles: admin → todas; manager → las de sus áreas.
  let allowed: Set<string> | null = null
  if (scope.role === 'manager') {
    const areaSet = new Set(scope.areaIds)
    allowed = new Set<string>()
    for (const pa of (posAreas ?? []) as { position_id: string; area_id: string }[]) {
      if (areaSet.has(pa.area_id)) {
        const name = posNameById.get(pa.position_id)
        if (name) allowed.add(name)
      }
    }
  }

  // usuario → nombre de su posición (para atribuir el consumo).
  const userPosition = new Map<string, string>()
  for (const pr of (profiles ?? []) as { id: string; position_id: string | null }[]) {
    const name = pr.position_id ? posNameById.get(pr.position_id) : undefined
    if (name) userPosition.set(pr.id, name)
  }

  return { allowed, userPosition }
}

const visible = (allowed: Set<string> | null, position: string) => allowed === null || allowed.has(position)

export async function getBancosHoras(scope: BancosScope): Promise<BancoHorasRow[]> {
  let excel: BancoHorasProyecto[] = []
  try {
    excel = await getCachedBancoHoras()
  } catch {
    excel = [] // Excel caído: devolvemos vacío en vez de romper la página.
  }

  const db = createAdminClient()
  const { data: lines } = await db
    .from('time_log_lines')
    .select('project, hours, time_logs!inner(status, user_id, entry_date)')
    .neq('time_logs.status', 'anulado')

  const { allowed, userPosition } = await loadPositionContext(scope)

  // Metadatos del proyecto (hoja Clientes_Proyectos del Excel): estado, manager y
  // fecha de auditoría. Se muestran/filtran en Bancos.
  const metaByProject = new Map<string, { estado: string; manager: string; fechaAuditoria: string }>()
  try {
    for (const e of await getCachedProyectosEstado()) {
      metaByProject.set(e.project.trim(), { estado: e.estado, manager: e.manager, fechaAuditoria: e.fechaAuditoria })
    }
  } catch { /* sin metadatos: no se muestran */ }

  // Consumido por (proyecto, posición) según la posición del usuario que registró.
  const consumed = new Map<string, number>()
  const consumedMes = new Map<string, Map<string, number>>() // key(project, position) → mes → horas
  for (const l of (lines ?? []) as unknown as { project: string; hours: number; time_logs: { user_id: string; entry_date: string } }[]) {
    if (l.project.trim() === 'Departamento') continue // horas internas: no consumen banco
    const position = userPosition.get(l.time_logs.user_id)
    if (!position) continue // usuario sin posición: no se atribuye a ningún banco
    const k = key(l.project.trim(), position)
    consumed.set(k, (consumed.get(k) ?? 0) + Number(l.hours))
    const month = l.time_logs.entry_date.slice(0, 7)
    let porMes = consumedMes.get(k)
    if (!porMes) { porMes = new Map(); consumedMes.set(k, porMes) }
    porMes.set(month, (porMes.get(month) ?? 0) + Number(l.hours))
  }

  const rows: BancoHorasRow[] = []
  for (const proj of excel) {
    const project = proj.project.trim()
    if (project === 'Departamento') continue // proyecto interno: sin banco
    for (const { position, hours } of proj.positions) {
      if (!visible(allowed, position)) continue
      const assigned = Number(hours)
      const k = key(project, position)
      const cons = consumed.get(k) ?? 0
      if (assigned === 0 && cons === 0) continue // banco vacío: no lo listamos
      const meta = metaByProject.get(project)

      // Desglose mensual: Excel del mes ∪ consumo del mes (spec §4.2).
      const byMonth = new Map<string, BancoMensual>()
      for (const m of proj.months) {
        const h = m.positions.find((p) => p.position === position)?.hours ?? 0
        if (h !== 0) byMonth.set(m.month, { month: m.month, assigned: h, consumed: 0 })
      }
      for (const [month, h] of consumedMes.get(k) ?? []) {
        const acc = byMonth.get(month) ?? { month, assigned: 0, consumed: 0 }
        acc.consumed += h
        byMonth.set(month, acc)
      }
      const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))

      rows.push({
        project, position, assigned, consumed: cons,
        remaining: assigned - cons,
        status: computeHorasStatus(assigned, cons),
        monthly,
        projectEstado: meta?.estado,
        manager: meta?.manager,
        fechaAuditoria: meta?.fechaAuditoria,
      })
    }
  }

  return rows.sort((a, b) => a.project.localeCompare(b.project) || a.position.localeCompare(b.position))
}

// Detalle de un proyecto: desglose por posición (acotado), totales y movimientos.
export async function getBancoHorasDetalle(
  project: string,
  scope: BancosScope,
): Promise<BancoHorasDetalle & { inScope: boolean }> {
  const name = project.trim()

  let posicionesExcel: { position: string; hours: number }[] = []
  let mesesExcel: BancoHorasProyecto['months'] = []
  try {
    const excel = await getCachedBancoHoras()
    const proj = excel.find((e) => e.project.trim() === name)
    posicionesExcel = proj?.positions ?? []
    mesesExcel = proj?.months ?? []
  } catch {
    posicionesExcel = []
  }

  const db = createAdminClient()
  const [{ data: lines }, { data: amps }] = await Promise.all([
    db
      .from('time_log_lines')
      .select('hours, description, time_logs!inner(status, user_id, entry_date, profiles!time_logs_user_id_fkey(full_name))')
      .eq('project', name)
      .neq('time_logs.status', 'anulado'),
    db
      .from('horas_ampliaciones')
      .select('id, project, hours, reason, entry_date, actor_name, active')
      .eq('project', name)
      .order('entry_date', { ascending: false }),
  ])

  const { allowed, userPosition } = await loadPositionContext(scope)

  type RawLine = {
    hours: number; description: string | null
    time_logs: { user_id: string; entry_date: string; profiles: { full_name: string } | null }
  }
  const rawLines = (lines ?? []) as unknown as RawLine[]

  // Consumido por posición (solo las visibles).
  const consumedByPos = new Map<string, number>()
  const consumedByPosMes = new Map<string, Map<string, number>>() // posición → mes → horas
  for (const l of rawLines) {
    const position = userPosition.get(l.time_logs.user_id)
    if (!position || !visible(allowed, position)) continue
    consumedByPos.set(position, (consumedByPos.get(position) ?? 0) + Number(l.hours))
    const month = l.time_logs.entry_date.slice(0, 7)
    let porMes = consumedByPosMes.get(position)
    if (!porMes) { porMes = new Map(); consumedByPosMes.set(position, porMes) }
    porMes.set(month, (porMes.get(month) ?? 0) + Number(l.hours))
  }

  // Desglose por posición: une columnas del Excel visibles + consumos.
  const posNames = new Set<string>()
  for (const p of posicionesExcel) if (visible(allowed, p.position)) posNames.add(p.position)
  for (const p of consumedByPos.keys()) posNames.add(p)

  const excelByPos = new Map(posicionesExcel.map((p) => [p.position, Number(p.hours)]))
  // Con asignación/actividad primero, "Sin asignación" al fondo (por severidad), luego nombre.
  const posiciones: BancoHorasRow[] = [...posNames]
    .map((position) => {
      const assigned = excelByPos.get(position) ?? 0
      const consumed = consumedByPos.get(position) ?? 0
      const byMonth = new Map<string, BancoMensual>()
      for (const m of mesesExcel) {
        const h = m.positions.find((p) => p.position === position)?.hours ?? 0
        if (h !== 0) byMonth.set(m.month, { month: m.month, assigned: h, consumed: 0 })
      }
      for (const [month, h] of consumedByPosMes.get(position) ?? []) {
        const acc = byMonth.get(month) ?? { month, assigned: 0, consumed: 0 }
        acc.consumed += h
        byMonth.set(month, acc)
      }
      const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
      return { project: name, position, assigned, consumed, remaining: assigned - consumed, status: computeHorasStatus(assigned, consumed), monthly }
    })
    .sort((a, b) => HORAS_SEVERITY[a.status] - HORAS_SEVERITY[b.status] || a.position.localeCompare(b.position))

  const inScope = scope.role === 'admin' || posiciones.length > 0

  const excelBase = posiciones.reduce((s, p) => s + p.assigned, 0)
  const consumed = posiciones.reduce((s, p) => s + p.consumed, 0)
  const ampliaciones = (amps ?? []) as AmpliacionHoras[]
  const ampActiveSum = ampliaciones.filter((a) => a.active).reduce((s, a) => s + Number(a.hours), 0)
  const assigned = excelBase + ampActiveSum

  // Cifras del proyecto por mes: Excel visible + ampliaciones del mes (spec §4.3).
  const detalleByMonth = new Map<string, BancoDetalleMensual>()
  const monthEntry = (month: string) => {
    let e = detalleByMonth.get(month)
    if (!e) { e = { month, excelAssigned: 0, ampliado: 0, consumed: 0, provisional: 0 }; detalleByMonth.set(month, e) }
    return e
  }
  for (const p of posiciones) {
    for (const m of p.monthly) {
      const e = monthEntry(m.month)
      e.excelAssigned += m.assigned
      e.consumed += m.consumed
    }
  }
  for (const a of ampliaciones) {
    if (!a.active) continue
    monthEntry(a.entry_date.slice(0, 7)).ampliado += Number(a.hours)
  }
  const monthly = [...detalleByMonth.values()].sort((a, b) => a.month.localeCompare(b.month))

  // Movimientos del proyecto: consumos visibles + ampliaciones activas, con saldo.
  const consumosVisibles = rawLines.filter((l) => {
    const position = userPosition.get(l.time_logs.user_id)
    return position && visible(allowed, position)
  })

  return {
    project: name,
    posiciones,
    excelBase,
    ampliaciones,
    movimientos: buildMovimientos(excelBase, consumosVisibles, ampliaciones),
    assigned,
    consumed,
    remaining: assigned - consumed,
    status: computeHorasStatus(assigned, consumed),
    monthly,
    inScope,
  }
}

// Historial de movimientos: interleva consumos (líneas) y ampliaciones activas en
// orden cronológico y calcula el saldo de horas disponibles antes/después.
function buildMovimientos(
  excelBase: number,
  lines: { hours: number; description: string | null; time_logs: { entry_date: string; profiles: { full_name: string } | null } }[],
  ampliaciones: AmpliacionHoras[],
): MovimientoBanco[] {
  type Raw = { date: string; kind: 'consumo' | 'ampliacion'; hours: number; actor: string; detail: string }
  const raw: Raw[] = [
    ...lines.map((l) => ({
      date: l.time_logs.entry_date,
      kind: 'consumo' as const,
      hours: Number(l.hours),
      actor: l.time_logs.profiles?.full_name ?? '—',
      detail: l.description ?? '',
    })),
    ...ampliaciones.filter((a) => a.active).map((a) => ({
      date: a.entry_date,
      kind: 'ampliacion' as const,
      hours: Number(a.hours),
      actor: a.actor_name,
      detail: a.reason,
    })),
  ]

  raw.sort((x, y) => x.date.localeCompare(y.date) || (x.kind === y.kind ? 0 : x.kind === 'ampliacion' ? -1 : 1))

  let saldo = excelBase
  const asc = raw.map((m) => {
    const antes = saldo
    saldo += m.kind === 'ampliacion' ? m.hours : -m.hours
    return { ...m, saldoAntes: antes, saldoDespues: saldo }
  })
  return asc.reverse()
}
