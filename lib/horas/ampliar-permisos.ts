// Quién amplía y quién anula horas del banco (spec 2026-10-15-ampliaciones-por-posicion).
// Puro, sin IO: lo usan la página del detalle (qué botones se ven) y la acción de ampliar
// (qué se deja hacer). Ampliar lo decide la acción —el manager del proyecto solo está en
// el Excel, que la base no conoce—; anular lo decide la base (anular_ampliacion_horas,
// 0062) con la misma regla que puedeAnular, que aquí solo pinta el botón.
import { casarPorNombre } from '@/lib/casar-nombre'

export type RolApp = 'admin' | 'manager' | 'operativo'

// Quien puede figurar como «Manager del proyecto»: managers y admins activos.
export interface CandidatoManager { id: string; full_name: string | null }

// ¿El «Manager del proyecto» del Excel es esta persona? El Excel trae el nombre de pila
// ("Antonio"), así que se casa como en el filtro Manager de /bancos y en los avisos; si
// casan dos, no es nadie.
export function esManagerDelProyecto(managerExcel: string | undefined, userId: string, candidatos: CandidatoManager[]): boolean {
  const nombre = (managerExcel ?? '').trim()
  if (!nombre) return false
  return casarPorNombre(nombre, candidatos, (c) => c.full_name ?? '')?.id === userId
}

// Por qué no puede ampliar, o null si puede. `esManagerDelProyecto` null = no se pudo leer
// el Excel: el manager no amplía a ciegas; al admin no le hace falta.
export function errorAlAmpliar(i: {
  role: RolApp
  esManagerDelProyecto: boolean | null
  position: string
  posicionesAlcance: string[]
}): string | null {
  if (i.role !== 'admin' && i.role !== 'manager') return 'No autorizado: solo un admin o el manager del proyecto amplían horas.'
  if (!i.position.trim()) return 'Elige la posición a la que se suman las horas.'
  if (i.role === 'manager') {
    if (i.esManagerDelProyecto === null) return 'No se pudo comprobar el manager del proyecto (Excel no disponible). Inténtalo en un rato.'
    if (!i.esManagerDelProyecto) return 'Solo el manager del proyecto (según el Excel) puede ampliar sus horas.'
  }
  if (!i.posicionesAlcance.includes(i.position)) return 'Esa posición no está entre las que puedes ampliar.'
  return null
}

// Anular: el admin, cualquiera; el manager, las que creó él.
export function puedeAnular(role: RolApp, userId: string, createdBy: string | null): boolean {
  if (role === 'admin') return true
  return role === 'manager' && createdBy !== null && createdBy === userId
}
