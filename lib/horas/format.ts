// Formato español: separador de miles con punto (1.000) y decimal con coma (1,5).
// useGrouping:'always' fuerza el punto de miles también en 4 cifras, porque el
// locale es-ES por defecto (minimumGroupingDigits:2) no agruparía "1000". Las
// horas conservan hasta 1 decimal (medias horas: 1,5h); los enteros van sin decimales.
const HORAS = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, useGrouping: 'always' })

export function formatHoras(n: number): string {
  return HORAS.format(Number(n)) + 'h'
}
