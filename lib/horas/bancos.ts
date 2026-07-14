import { createAdminClient } from '@/lib/supabase/admin'
import { getCachedBancoHoras, getCachedProyectosEstado, getCachedHorasProvisionales, getCachedHorasProvisionalesSetup, type ProyectoEstado, type HorasProvisionales } from '@/lib/graph/client'
import { computeHorasStatus, HORAS_SEVERITY, type BancoHorasRow, type BancoHorasDetalle, type AmpliacionHoras, type MovimientoBanco, type BancoMensual, type BancoDetalleMensual } from '@/lib/horas/bancos-status'
import type { BancoHorasProyecto } from '@/lib/types'
import { currentMonth } from '@/lib/horas/format'
import { ultimoRegistroGlobal, mesesVentana, provisionalPorPosicion } from '@/lib/horas/provisionales'
import { carrySplit } from '@/lib/horas/carry-forward'

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
  try { excel = await getCachedBancoHoras() } catch { excel = [] }

  let horasProv: HorasProvisionales = new Map()
  try { horasProv = await getCachedHorasProvisionales() } catch { horasProv = new Map() }

  let horasProvSetup: HorasProvisionales = new Map()
  try { horasProvSetup = await getCachedHorasProvisionalesSetup() } catch { horasProvSetup = new Map() }

  const db = createAdminClient()
  const { data: lines } = await db
    .from('time_log_lines')
    .select('project, hours, time_logs!inner(status, user_id, entry_date)')
    .neq('time_logs.status', 'anulado')

  const { allowed, userPosition } = await loadPositionContext(scope)

  // Registro maestro de proyectos + metadatos (Clientes_Proyectos).
  const metaByProject = new Map<string, ProyectoEstado>()
  try {
    for (const e of await getCachedProyectosEstado()) metaByProject.set(e.project.trim(), e)
  } catch { /* sin metadatos: banco solo con lo real */ }

  // Consumo por (proyecto, posición): total, por mes, y posiciones con consumo por proyecto.
  const consumed = new Map<string, number>()
  const consumedMes = new Map<string, Map<string, number>>()
  const posConsumoPorProyecto = new Map<string, Set<string>>()
  for (const l of (lines ?? []) as unknown as { project: string; hours: number; time_logs: { user_id: string; entry_date: string } }[]) {
    const project = l.project.trim()
    if (project === 'Departamento') continue // horas internas: no consumen banco
    const position = userPosition.get(l.time_logs.user_id)
    if (!position) continue // usuario sin posición: no se atribuye
    const k = key(project, position)
    consumed.set(k, (consumed.get(k) ?? 0) + Number(l.hours))
    const month = l.time_logs.entry_date.slice(0, 7)
    let porMes = consumedMes.get(k)
    if (!porMes) { porMes = new Map(); consumedMes.set(k, porMes) }
    porMes.set(month, (porMes.get(month) ?? 0) + Number(l.hours))
    let ps = posConsumoPorProyecto.get(project)
    if (!ps) { ps = new Set(); posConsumoPorProyecto.set(project, ps) }
    ps.add(position)
  }

  const excelByProject = new Map<string, BancoHorasProyecto>()
  for (const p of excel) excelByProject.set(p.project.trim(), p)

  // Ventana provisional (global).
  const ventana = mesesVentana(ultimoRegistroGlobal(excel), currentMonth())

  // Conjunto de proyectos = registro maestro ∪ los que tengan Excel o consumo. Sin "Departamento".
  const projectNames = new Set<string>([...metaByProject.keys(), ...excelByProject.keys(), ...posConsumoPorProyecto.keys()])
  projectNames.delete('Departamento')

  const rows: BancoHorasRow[] = []
  for (const project of projectNames) {
    const proj = excelByProject.get(project)
    const meta = metaByProject.get(project)
    const mesesReales = new Set((proj?.months ?? []).map((m) => m.month))
    const tarifa = meta ? horasProv.get(meta.tipoContrato) : undefined
    const tarifaSetup = meta ? horasProvSetup.get(meta.tipoContrato) : undefined
    if (meta && meta.tipoContrato && horasProv.size > 0 && !tarifa) {
      console.warn(`[horas-provisionales] sin tarifa para tipo de contrato "${meta.tipoContrato}" (proyecto "${project}")`)
    }
    const provByPos = meta
      ? provisionalPorPosicion(
          { tipoContrato: meta.tipoContrato, estado: meta.estado, inicioContable: meta.inicioContable, finContable: meta.finContable },
          mesesReales, ventana, tarifa, tarifaSetup,
        )
      : new Map<string, BancoMensual[]>()

    // Posiciones del proyecto = Excel ∪ consumo ∪ provisional.
    const positions = new Set<string>([
      ...(proj?.positions ?? []).map((p) => p.position),
      ...(posConsumoPorProyecto.get(project) ?? []),
      ...provByPos.keys(),
    ])
    const excelByPos = new Map((proj?.positions ?? []).map((p) => [p.position, Number(p.hours)]))

    for (const position of positions) {
      if (!visible(allowed, position)) continue
      const k = key(project, position)
      const cons = consumed.get(k) ?? 0
      const prov = provByPos.get(position) ?? []
      const provTotal = prov.reduce((s, pm) => s + pm.assigned, 0)
      // El asignado incluye las horas provisionales (transitorio): así un proyecto con
      // estimado no se ve "excedido" solo porque su fila real aún no está cargada.
      const assigned = (excelByPos.get(position) ?? 0) + provTotal
      if (assigned === 0 && cons === 0) continue // nada que mostrar

      // monthly: Excel real + provisional (disjuntos por mes) + consumo (merge).
      const byMonth = new Map<string, BancoMensual>()
      for (const m of proj?.months ?? []) {
        const h = m.positions.find((p) => p.position === position)?.hours ?? 0
        if (h !== 0) byMonth.set(m.month, { month: m.month, assigned: h, consumed: 0 })
      }
      for (const pm of prov) byMonth.set(pm.month, { ...pm })
      for (const [month, h] of consumedMes.get(k) ?? []) {
        const acc = byMonth.get(month) ?? { month, assigned: 0, consumed: 0 }
        acc.consumed += h
        byMonth.set(month, acc)
      }
      const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))

      // Carry forward (spec 2026-07-14): corte 75/25 de meses cerrados; el disponible
      // real y el status descuentan los inutilizables. Anota el desglose en cada mes.
      const carry = carrySplit(monthly, currentMonth())
      for (const cm of carry.porMes) {
        const m = byMonth.get(cm.month)
        if (m && (cm.libres > 0 || cm.inutilizables > 0)) { m.libres = cm.libres; m.inutilizables = cm.inutilizables }
      }

      rows.push({
        project, position, assigned, consumed: cons,
        remaining: assigned - cons - carry.totales.inutilizables,
        inutilizables: carry.totales.inutilizables,
        carryNeto: carry.totales.carryNeto,
        status: computeHorasStatus(assigned - carry.totales.inutilizables, cons),
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
  let allExcel: BancoHorasProyecto[] = []
  try {
    allExcel = await getCachedBancoHoras()
    const proj = allExcel.find((e) => e.project.trim() === name)
    posicionesExcel = proj?.positions ?? []
    mesesExcel = proj?.months ?? []
  } catch {
    posicionesExcel = []
  }

  let meta: ProyectoEstado | undefined
  try { meta = (await getCachedProyectosEstado()).find((e) => e.project.trim() === name) } catch { /* sin meta */ }
  let horasProv: HorasProvisionales = new Map()
  try { horasProv = await getCachedHorasProvisionales() } catch { horasProv = new Map() }
  let horasProvSetup: HorasProvisionales = new Map()
  try { horasProvSetup = await getCachedHorasProvisionalesSetup() } catch { horasProvSetup = new Map() }

  const ventana = mesesVentana(ultimoRegistroGlobal(allExcel), currentMonth())
  const mesesRealesProj = new Set(mesesExcel.map((m) => m.month))
  const tarifa = meta ? horasProv.get(meta.tipoContrato) : undefined
  const tarifaSetup = meta ? horasProvSetup.get(meta.tipoContrato) : undefined
  const provByPos = meta
    ? provisionalPorPosicion(
        { tipoContrato: meta.tipoContrato, estado: meta.estado, inicioContable: meta.inicioContable, finContable: meta.finContable },
        mesesRealesProj, ventana, tarifa, tarifaSetup,
      )
    : new Map<string, BancoMensual[]>()

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
  for (const p of provByPos.keys()) if (visible(allowed, p)) posNames.add(p)

  const excelByPos = new Map(posicionesExcel.map((p) => [p.position, Number(p.hours)]))
  // Con asignación/actividad primero, "Sin asignación" al fondo (por severidad), luego nombre.
  const posiciones: BancoHorasRow[] = [...posNames]
    .map((position) => {
      // El asignado incluye las provisionales (transitorio), como en la lista.
      const provTotal = (provByPos.get(position) ?? []).reduce((s, pm) => s + pm.assigned, 0)
      const assigned = (excelByPos.get(position) ?? 0) + provTotal
      const consumed = consumedByPos.get(position) ?? 0
      const byMonth = new Map<string, BancoMensual>()
      for (const m of mesesExcel) {
        const h = m.positions.find((p) => p.position === position)?.hours ?? 0
        if (h !== 0) byMonth.set(m.month, { month: m.month, assigned: h, consumed: 0 })
      }
      for (const pm of provByPos.get(position) ?? []) byMonth.set(pm.month, { ...pm })
      for (const [month, h] of consumedByPosMes.get(position) ?? []) {
        const acc = byMonth.get(month) ?? { month, assigned: 0, consumed: 0 }
        acc.consumed += h
        byMonth.set(month, acc)
      }
      const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
      const carry = carrySplit(monthly, currentMonth())
      for (const cm of carry.porMes) {
        const m = byMonth.get(cm.month)
        if (m && (cm.libres > 0 || cm.inutilizables > 0)) { m.libres = cm.libres; m.inutilizables = cm.inutilizables }
      }
      return {
        project: name, position, assigned, consumed,
        remaining: assigned - consumed - carry.totales.inutilizables,
        inutilizables: carry.totales.inutilizables,
        carryNeto: carry.totales.carryNeto,
        status: computeHorasStatus(assigned - carry.totales.inutilizables, consumed),
        monthly,
      }
    })
    .sort((a, b) => HORAS_SEVERITY[a.status] - HORAS_SEVERITY[b.status] || a.position.localeCompare(b.position))

  const inScope = scope.role === 'admin' || posiciones.length > 0

  // excelBase = solo real (Excel); provBase = provisional (transitorio); ambos suman al total.
  const excelBase = posiciones.reduce((s, p) => s + (excelByPos.get(p.position) ?? 0), 0)
  const asignadoPosiciones = posiciones.reduce((s, p) => s + p.assigned, 0) // real + provisional
  const provBase = asignadoPosiciones - excelBase
  const consumed = posiciones.reduce((s, p) => s + p.consumed, 0)
  const inutilizables = posiciones.reduce((s, p) => s + p.inutilizables, 0)
  const carryNeto = posiciones.reduce((s, p) => s + p.carryNeto, 0)
  const ampliaciones = (amps ?? []) as AmpliacionHoras[]
  const ampActiveSum = ampliaciones.filter((a) => a.active).reduce((s, a) => s + Number(a.hours), 0)
  const assigned = asignadoPosiciones + ampActiveSum

  // Cifras del proyecto por mes: Excel visible + ampliaciones del mes (spec §4.3).
  const detalleByMonth = new Map<string, BancoDetalleMensual>()
  const monthEntry = (month: string) => {
    let e = detalleByMonth.get(month)
    if (!e) { e = { month, excelAssigned: 0, ampliado: 0, consumed: 0, provisional: 0, inutilizables: 0, libres: 0 }; detalleByMonth.set(month, e) }
    return e
  }
  for (const p of posiciones) {
    for (const m of p.monthly) {
      const e = monthEntry(m.month)
      e.consumed += m.consumed
      e.inutilizables += m.inutilizables ?? 0
      e.libres += m.libres ?? 0
      if (m.provisional) e.provisional += m.assigned
      else e.excelAssigned += m.assigned
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
    provisional: provBase,
    ampliaciones,
    movimientos: buildMovimientos(excelBase, consumosVisibles, ampliaciones),
    assigned,
    consumed,
    remaining: assigned - consumed - inutilizables,
    inutilizables,
    carryNeto,
    status: computeHorasStatus(assigned - inutilizables, consumed),
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
