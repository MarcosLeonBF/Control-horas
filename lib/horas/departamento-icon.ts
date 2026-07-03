import type { LucideIcon } from 'lucide-react'
import {
  Handshake, FileText, Megaphone, Target, Users, Globe, HandCoins,
  Palette, Code, Search, TrendingUp, FolderKanban, LifeBuoy, Building2,
} from 'lucide-react'

// Icono (lucide) por departamento para diferenciarlos visualmente en el selector
// de registrar horas (proyecto interno "Departamento"). Iconos del design system
// —monocromos, coherentes con la UI shadcn/lucide—, no emojis genéricos. El icono
// es solo presentación: no se guarda ni se valida (el valor sigue siendo el nombre
// del departamento). Se matchea por palabra clave normalizada (sin acentos ni
// mayúsculas) para tolerar variantes como "Marketing Digital". Departamentos
// reales: ver docs/superpowers/specs/2026-07-03-emoji-departamento-selector-design.md

const FALLBACK = Building2

// El orden importa: se devuelve el icono del primer keyword contenido en el
// nombre. Los departamentos reales (activos en BD) van primero.
const ICONO_POR_KEYWORD: ReadonlyArray<readonly [string, LucideIcon]> = [
  ['clientes', Handshake],
  ['contenido', FileText],
  ['marketing', Megaphone],
  ['prospeccion', Target],
  ['rrhh', Users],
  ['todos', Globe],
  ['ventas', HandCoins],
  ['diseno', Palette],
  ['desarrollo', Code],
  ['dev', Code],
  ['seo', Search],
  ['paid', TrendingUp],
  ['ads', TrendingUp],
  ['administracion', FolderKanban],
  ['soporte', LifeBuoy],
]

// Minúsculas, sin acentos/diacríticos, sin espacios en los bordes.
function normalizar(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function departamentoIcon(name: string): LucideIcon {
  const n = normalizar(name)
  for (const [keyword, icon] of ICONO_POR_KEYWORD) {
    if (n.includes(keyword)) return icon
  }
  return FALLBACK
}
