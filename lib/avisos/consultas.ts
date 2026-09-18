// Consultas que los flujos de Julián piden por calendario: el resumen de capacidad
// (quincenal) y los días sin registrar (la escalera de recordatorios la aplica su flujo).
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { addDiasISO } from '@/lib/horas/auditoria-types'
import { DIAS_REGISTRO_POR_DEFECTO } from '@/lib/horas/ventana-registro'
import { nivelesActuales } from '@/lib/avisos/detector-bancos'
import { leerHuchas } from '@/lib/avisos/detector-hucha'
import { rankingCapacidad, huchasParaRanking, porcentajeDisponible, type NivelBanco } from '@/lib/avisos/capacidad'
import { perfilesPorId, managerDe, managerPorNombre, type Perfil } from '@/lib/avisos/personas'
import {
  diasSinRegistrar, diasPendientes, laborablesDesde, diaMes, ultimoAntesDe, dentroDePlazo, TOPE_DIAS,
} from '@/lib/avisos/calendario'
import { enlaceBanco, enlaceHucha, esPersonaDePrueba } from '@/lib/avisos/entorno'
import type { ManagerAviso, PersonaAviso } from '@/lib/avisos/contrato'

// Todos los proyectos ACTIVOS (Estado «Activo» en el Excel) con su banco total, sin tope:
// cada lista los trae todos, solo cambia el orden (pedido de Roberto, 2026-09-18). El
// filtro de activos lo aplica nivelesDeBancos; también quedan fuera los activos sin ninguna
// hora asignada ni consumida (sin_asignacion), porque no hay nada que ordenar.
export async function resumenCapacidad() {
  const db = createAdminClient()
  const [niveles, perfiles] = await Promise.all([nivelesActuales(db), perfilesPorId(db)])
  const r = rankingCapacidad(niveles.filter((n) => n.alcance === 'proyecto'), (n) => n.horas.disponibles)
  const item = (n: NivelBanco) => ({
    proyecto: n.proyecto, horas: n.horas, porcentaje_consumido: n.porcentajeConsumido,
    porcentaje_disponible: porcentajeDisponible(n.porcentajeConsumido),
    manager_proyecto: managerPorNombre(n.managerExcel, perfiles), enlace: enlaceBanco(n.proyecto),
  })
  return {
    generado: new Date().toISOString(),
    con_mas_horas: r.conMas.map(item), mas_libres: r.masLibres.map(item),
    con_menos_horas: r.conMenos.map(item), menos_libres: r.menosLibres.map(item),
  }
}

// El mismo resumen sobre la HUCHA (presupuesto en euros) en vez del banco de horas.
// Mismas cuatro listas y mismos criterios (rankingCapacidad); lo que cambia es la fuente
// —leerHuchas, que ya filtra activos y proyectos E2E— y los nombres del contrato.
//
// Sin tope: cada lista trae TODOS los proyectos activos con HUCHA (pedido de Roberto,
// 2026-09-18). Son pocos —solo existen en HUCHA los que el Excel les da presupuesto— y el
// flujo quiere verlos todos. Los archivados NO entran: archivar no pone el banco a cero, y
// saldrían con un presupuesto que ya no tienen.
//
// A diferencia del de capacidad, este NO depende del Excel de SharePoint: todo sale de
// la base (hucha_banks), así que una caída de Graph no lo tumba.
export async function resumenHucha() {
  const db = createAdminClient()
  const huchas = huchasParaRanking(await leerHuchas(db))
  const r = rankingCapacidad(huchas, (h) => h.saldo.disponible)
  const item = (h: (typeof huchas)[number]) => ({
    proyecto: h.nombre, proyecto_id: h.id,
    presupuesto: h.saldo, moneda: h.moneda, nivel: h.nivel,
    porcentaje_consumido: h.porcentajeConsumido,
    porcentaje_disponible: porcentajeDisponible(h.porcentajeConsumido),
    managers: h.managers, enlace: enlaceHucha(h.id),
  })
  return {
    generado: new Date().toISOString(),
    con_mas_presupuesto: r.conMas.map(item), mas_libres: r.masLibres.map(item),
    con_menos_presupuesto: r.conMenos.map(item), menos_libres: r.menosLibres.map(item),
  }
}

export interface PersonaPendiente {
  persona: PersonaAviso
  manager_directo: ManagerAviso | null
  dias: number // laborables seguidos sin registrar hasta ayer (la escalera); 0 si ayer registró
  desde: string | null // el más antiguo de esos seguidos; null si dias es 0
  ultimo_registro: string | null // dentro de la ventana consultada (3 × tope días naturales)
  dentro_de_plazo: boolean | null // si todavía puede registrar `desde`; null si dias es 0
  pendientes: string[] // los laborables sin registro de los últimos TOPE_DIAS, del más antiguo al más reciente
  pendientes_dd_mm: string[] // los mismos días, en el mismo orden, como dd-mm
  dias_desde_mas_antiguo: number // laborables desde el pendiente más antiguo (pendientes[0]) hasta ayer
}

// Registran los operativos y managers activos (los admin no), sin los usuarios de los E2E.
function debeRegistrar(p: Perfil): boolean {
  return p.activo && (p.persona.rol === 'operativo' || p.persona.rol === 'manager') && !esPersonaDePrueba(p.persona.email)
}

export async function diasSinRegistrarDe(fecha: string): Promise<{ fecha: string; personas: PersonaPendiente[] }> {
  const db = createAdminClient()
  // 3 × tope en días naturales cubre los 30 laborables con fines de semana y festivos.
  const ventana = addDiasISO(fecha, -TOPE_DIAS * 3)
  const [perfiles, logs, fest] = await Promise.all([
    perfilesPorId(db),
    fetchAllRows<{ user_id: string; entry_date: string }>((desde, hasta) =>
      db.from('time_logs').select('user_id, entry_date').neq('status', 'anulado')
        .gte('entry_date', ventana).lt('entry_date', fecha).range(desde, hasta)),
    db.from('festivos').select('fecha'),
  ])
  if (fest.error) throw new Error(`festivos: ${fest.error.message}`)
  const festivos = new Set((fest.data ?? []).map((f) => String(f.fecha)))
  // Cualquier registro no anulado cuenta, Departamento incluido (así cuentan las vacaciones).
  const registradosPor = new Map<string, Set<string>>()
  for (const l of logs) {
    const s = registradosPor.get(l.user_id) ?? new Set<string>()
    s.add(l.entry_date)
    registradosPor.set(l.user_id, s)
  }

  const personas: PersonaPendiente[] = []
  for (const p of perfiles.values()) {
    if (!debeRegistrar(p)) continue
    const registrados = registradosPor.get(p.persona.id) ?? new Set<string>()
    // Sale quien tenga algún día pendiente, aunque ayer registrara (entonces dias es 0).
    const pendientes = diasPendientes({ fecha, registrados, festivos, alta: p.alta })
    if (pendientes.length === 0) continue
    const { dias, desde } = diasSinRegistrar({ fecha, registrados, festivos, alta: p.alta })
    personas.push({
      persona: p.persona, manager_directo: managerDe(p, perfiles), dias, desde,
      ultimo_registro: ultimoAntesDe(registrados, fecha),
      dentro_de_plazo: desde ? dentroDePlazo(desde, fecha, p.diasAtras ?? DIAS_REGISTRO_POR_DEFECTO) : null,
      pendientes,
      pendientes_dd_mm: pendientes.map(diaMes),
      dias_desde_mas_antiguo: laborablesDesde(pendientes[0], fecha, festivos),
    })
  }
  personas.sort((a, b) =>
    b.dias - a.dias || b.pendientes.length - a.pendientes.length || a.persona.nombre.localeCompare(b.persona.nombre))
  return { fecha, personas }
}
