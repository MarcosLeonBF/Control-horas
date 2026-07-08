// Formato español: separador de miles con punto (1.000) y decimal con coma (1,5).
// useGrouping:'always' fuerza el punto de miles también en 4 cifras, porque el
// locale es-ES por defecto (minimumGroupingDigits:2) no agruparía "1000". Las
// horas conservan hasta 1 decimal (medias horas: 1,5h); los enteros van sin decimales.
const HORAS = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, useGrouping: 'always' })

export function formatHoras(n: number): string {
  return HORAS.format(Number(n)) + 'h'
}

// Horas redondeadas a entero, para totales/KPIs (sin decimales). Mismo separador de
// miles. Los valores individuales usan formatHoras (conservan la media hora: 0,5h).
const HORAS_ENTERAS = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: 'always' })

export function formatHorasTotal(n: number): string {
  return HORAS_ENTERAS.format(Number(n)) + 'h'
}

// ISO "YYYY-MM-DD" → "DD/MM/YYYY" (sin desfase de zona horaria). Si no es una fecha
// ISO válida, devuelve la entrada tal cual.
export function formatFechaISO(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}

// 'YYYY-MM' → "Julio 2026" (es-ES, inicial mayúscula). Si no es un mes válido,
// devuelve la entrada tal cual. timeZone UTC para no deslizarse de mes.
const MES = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export function formatMes(month: string): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  const label = MES.format(new Date(Date.UTC(y, m - 1, 1)))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// Mes actual como 'YYYY-MM'.
export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

// 'YYYY-MM' → "Jul 2026" (mes abreviado + año, inicial mayúscula, sin punto).
const MES_CORTO = new Intl.DateTimeFormat('es-ES', { month: 'short', year: 'numeric', timeZone: 'UTC' })

export function mesCorto(month: string): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  const s = MES_CORTO.format(new Date(Date.UTC(y, m - 1, 1))).replace('.', '')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Suma delta meses a un 'YYYY-MM' (delta puede ser negativo).
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7)
}
