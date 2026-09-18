// Niveles del banco de horas por posición y por proyecto, y ranking de capacidad.
// Puro, sin IO: parte de las filas de getBancosHoras y de las ampliaciones activas.
import { computeHorasStatus, type BancoHorasRow } from '@/lib/horas/bancos-status'
import { centesimas, comoNivel, type Nivel } from '@/lib/avisos/reglas'
import type { ActorAviso, DatosBancoAmpliacion, ManagerAviso } from '@/lib/avisos/contrato'

export interface HorasBanco {
  asignadas: number
  ampliadas: number
  consumidas: number
  inutilizables: number
  disponibles: number
}

export interface NivelBanco {
  clave: string // clave en avisos_estado
  proyecto: string
  alcance: 'posicion' | 'proyecto'
  posicion: string | null
  nivel: Nivel
  horas: HorasBanco
  porcentajeConsumido: number | null
  estadoProyecto: string | undefined
  managerExcel: string | undefined
}

// Sobre la base efectiva (asignadas − inutilizables), con un decimal. Sin base, null.
export function porcentajeConsumido(base: number, consumidas: number): number | null {
  if (base <= 0) return null
  return Math.round((consumidas / base) * 1000) / 10
}

export function esProyectoActivo(estado: string | undefined): boolean {
  return (estado ?? '').trim().toLowerCase() === 'activo'
}

// rows = getBancosHoras({ role: 'admin' }); ampliadas = Σ ampliaciones activas por proyecto.
// El total del proyecto suma las ampliaciones, como el detalle de /bancos: tras vender
// horas, un proyecto no debe seguir "al tope". Por posición no hay ampliaciones.
export function nivelesDeBancos(rows: BancoHorasRow[], ampliadas: Map<string, number>): NivelBanco[] {
  const porProyecto = new Map<string, BancoHorasRow[]>()
  for (const r of rows) {
    if (!esProyectoActivo(r.projectEstado)) continue
    porProyecto.set(r.project, [...(porProyecto.get(r.project) ?? []), r])
  }

  const out: NivelBanco[] = []
  for (const [proyecto, filas] of porProyecto) {
    for (const r of filas) {
      if (r.assigned <= 0) continue // sin banco asignado: no avisa (el total ya lo recoge)
      const nivel = comoNivel(r.status)
      if (!nivel) continue
      out.push({
        clave: `banco:${proyecto}:${r.position}`, proyecto, alcance: 'posicion', posicion: r.position, nivel,
        horas: {
          asignadas: centesimas(r.assigned), ampliadas: 0, consumidas: centesimas(r.consumed),
          inutilizables: centesimas(r.inutilizables), disponibles: centesimas(r.remaining),
        },
        porcentajeConsumido: porcentajeConsumido(r.assigned - r.inutilizables, r.consumed),
        estadoProyecto: r.projectEstado, managerExcel: r.manager,
      })
    }

    const amp = ampliadas.get(proyecto) ?? 0
    const asignadas = centesimas(filas.reduce((s, r) => s + r.assigned, 0) + amp)
    const consumidas = centesimas(filas.reduce((s, r) => s + r.consumed, 0))
    const inutilizables = centesimas(filas.reduce((s, r) => s + r.inutilizables, 0))
    const nivel = comoNivel(computeHorasStatus(centesimas(asignadas - inutilizables), consumidas))
    if (!nivel) continue
    out.push({
      clave: `banco:${proyecto}:*`, proyecto, alcance: 'proyecto', posicion: null, nivel,
      horas: {
        asignadas, ampliadas: centesimas(amp), consumidas, inutilizables,
        disponibles: centesimas(asignadas - consumidas - inutilizables),
      },
      porcentajeConsumido: porcentajeConsumido(asignadas - inutilizables, consumidas),
      estadoProyecto: filas[0].projectEstado, managerExcel: filas[0].manager,
    })
  }
  return out
}

// Una ampliación de horas tal como quedó guardada (horas_ampliaciones, migración 0014).
export interface AmpliacionHoras { project: string; hours: number; reason: string; entry_date: string }

// Datos de banco.ampliacion. `total` es el banco del proyecto tras ampliar (nivelesDeBancos,
// alcance 'proyecto'); llega undefined si el Excel no respondió, y entonces horas, nivel y
// porcentaje van a null en vez de perder el aviso. Lo que viene de la base sale siempre.
export function datosAmpliacionHoras(
  amp: AmpliacionHoras, actor: ActorAviso, total: NivelBanco | undefined,
  manager: ManagerAviso | null, enlace: string,
): DatosBancoAmpliacion {
  return {
    proyecto: amp.project, horas_ampliacion: centesimas(Number(amp.hours)), motivo: amp.reason, dia: amp.entry_date, actor,
    horas: total?.horas ?? null, nivel: total?.nivel ?? null, porcentaje_consumido: total?.porcentajeConsumido ?? null,
    manager_proyecto: manager, enlace,
  }
}

// Lo que queda hasta 100 del porcentaje consumido, con un decimal (negativo si se excedió).
export function porcentajeDisponible(consumido: number | null): number | null {
  return consumido === null ? null : Math.round((100 - consumido) * 10) / 10
}

// Los mismos proyectos en cuatro órdenes: por lo disponible (de más a menos y al revés) y
// por porcentaje disponible. Sin tope: cada lista los trae TODOS (pedido de Roberto,
// 2026-09-18). Las listas por porcentaje dejan fuera los que no tienen base (null).
//
// Qué es "lo disponible" lo decide quien llama: horas en el banco de horas, euros en la
// HUCHA. Por eso las claves son neutras (conMas, no conMasHoras) y cada consulta las
// traduce a sus nombres del contrato. Así las cuatro listas y sus criterios viven en un
// solo sitio, y los dos resúmenes no pueden desalinearse.
export function rankingCapacidad<T extends { porcentajeConsumido: number | null }>(
  items: T[], disponible: (i: T) => number,
): { conMas: T[]; masLibres: T[]; conMenos: T[]; menosLibres: T[] } {
  const conPorcentaje = items.filter((i) => i.porcentajeConsumido !== null)
  const pct = (i: T) => i.porcentajeConsumido as number
  return {
    conMas: [...items].sort((a, b) => disponible(b) - disponible(a)),
    masLibres: [...conPorcentaje].sort((a, b) => pct(a) - pct(b)),
    conMenos: [...items].sort((a, b) => disponible(a) - disponible(b)),
    menosLibres: [...conPorcentaje].sort((a, b) => pct(b) - pct(a)),
  }
}

// HUCHAs listas para el ranking. Las que no tienen nivel (sin_presupuesto: ni asignado ni
// consumido) no entran, igual que nivelesDeBancos deja fuera los bancos sin nivel: no hay
// nada que rankear. El porcentaje es sobre el asignado a secas: en HUCHA el asignado YA
// incluye las ampliaciones (las suma el ledger al registrarlas) y no hay corte 75/25 de
// cierre de mes, así que no existen ni `ampliadas` aparte ni `inutilizables`.
export function huchasParaRanking<T extends { nivel: Nivel | null; saldo: { asignado: number; consumido: number } }>(
  huchas: T[],
): (T & { nivel: Nivel; porcentajeConsumido: number | null })[] {
  return huchas
    .filter((h): h is T & { nivel: Nivel } => h.nivel !== null)
    .map((h) => ({ ...h, porcentajeConsumido: porcentajeConsumido(h.saldo.asignado, h.saldo.consumido) }))
}
