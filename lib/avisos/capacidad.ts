// Niveles del banco de horas por posición y por proyecto, y ranking de capacidad.
// Puro, sin IO: parte de las filas de getBancosHoras y de las ampliaciones activas.
import { computeHorasStatus, type BancoHorasRow } from '@/lib/horas/bancos-status'
import { centesimas, comoNivel, type Nivel } from '@/lib/avisos/reglas'

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

export function rankingCapacidad<T extends { horas: HorasBanco; porcentajeConsumido: number | null }>(
  items: T[], top: number,
): { conMasHoras: T[]; masLibres: T[] } {
  const conMasHoras = [...items].sort((a, b) => b.horas.disponibles - a.horas.disponibles).slice(0, top)
  const masLibres = items
    .filter((i) => i.porcentajeConsumido !== null)
    .sort((a, b) => (a.porcentajeConsumido as number) - (b.porcentajeConsumido as number))
    .slice(0, top)
  return { conMasHoras, masLibres }
}
