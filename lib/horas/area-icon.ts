import type { LucideIcon } from 'lucide-react'
import { Headset, Compass, TrendingUp, Search, Users, Building2 } from 'lucide-react'

// Icono (lucide) por área para la estructura de Equipo — mismo criterio que
// departamento-icon.ts: iconos del design system, monocromos, no emojis. Solo
// presentación (no se guarda ni valida); matcheo por keyword normalizada para
// tolerar variantes del nombre del área.

const FALLBACK = Building2

const ICONO_POR_KEYWORD: ReadonlyArray<readonly [string, LucideIcon]> = [
  ['crm', Headset],
  ['direccion', Compass],
  ['growth', TrendingUp],
  ['seo', Search],
  ['rrhh', Users],
]

// Minúsculas, sin acentos/diacríticos, sin espacios en los bordes.
function normalizar(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function areaIcon(name: string): LucideIcon {
  const n = normalizar(name)
  for (const [keyword, icon] of ICONO_POR_KEYWORD) {
    if (n.includes(keyword)) return icon
  }
  return FALLBACK
}
