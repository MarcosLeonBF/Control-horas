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
