// Consultas que los flujos de Julián piden por calendario: el resumen de capacidad
// (quincenal) y los días sin registrar (la escalera de recordatorios la aplica su flujo).
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { addDiasISO } from '@/lib/horas/auditoria-types'
import { nivelesActuales } from '@/lib/avisos/detector-bancos'
import { rankingCapacidad, porcentajeDisponible, type NivelBanco } from '@/lib/avisos/capacidad'
import { perfilesPorId, managerDe, managerPorNombre, type Perfil } from '@/lib/avisos/personas'
import {
  diasSinRegistrar, diasPendientes, laborablesDesde, diaMes, ultimoAntesDe, dentroDePlazo, TOPE_DIAS,
} from '@/lib/avisos/calendario'
import { enlaceBanco, esPersonaDePrueba } from '@/lib/avisos/entorno'
import type { ManagerAviso, PersonaAviso } from '@/lib/avisos/contrato'

export async function resumenCapacidad(top: number) {
  const db = createAdminClient()
  const [niveles, perfiles] = await Promise.all([nivelesActuales(db), perfilesPorId(db)])
  const r = rankingCapacidad(niveles.filter((n) => n.alcance === 'proyecto'), top)
  const item = (n: NivelBanco) => ({
    proyecto: n.proyecto, horas: n.horas, porcentaje_consumido: n.porcentajeConsumido,
    porcentaje_disponible: porcentajeDisponible(n.porcentajeConsumido),
    manager_proyecto: managerPorNombre(n.managerExcel, perfiles), enlace: enlaceBanco(n.proyecto),
  })
  return {
    generado: new Date().toISOString(), top,
    con_mas_horas: r.conMasHoras.map(item), mas_libres: r.masLibres.map(item),
    con_menos_horas: r.conMenosHoras.map(item), menos_libres: r.menosLibres.map(item),
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
      dentro_de_plazo: desde ? dentroDePlazo(desde, fecha, p.diasAtras ?? 7) : null,
      pendientes,
      pendientes_dd_mm: pendientes.map(diaMes),
      dias_desde_mas_antiguo: laborablesDesde(pendientes[0], fecha, festivos),
    })
  }
  personas.sort((a, b) =>
    b.dias - a.dias || b.pendientes.length - a.pendientes.length || a.persona.nombre.localeCompare(b.persona.nombre))
  return { fecha, personas }
}
