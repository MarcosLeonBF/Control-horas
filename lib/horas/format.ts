// Formato español: separador de miles con punto (1.000) y decimal con coma (1,50).
// useGrouping:'always' fuerza el punto de miles también en 4 cifras, porque el
// locale es-ES por defecto (minimumGroupingDigits:2) no agruparía "1000". Las horas
// se muestran con dos decimales fijos (8,00h; 1,50h; 1.234,50h).
const HORAS = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always',
})

export function formatHoras(n: number): string {
  return HORAS.format(Number(n)) + 'h'
}

// Alias semántico para totales/KPIs. Mismo formato de dos decimales que los valores
// individuales; se mantiene el nombre para no tocar las llamadas existentes.
export function formatHorasTotal(n: number): string {
  return HORAS.format(Number(n)) + 'h'
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

// 'YYYY-MM' → ISO del último día de ese mes ('2026-06' → '2026-06-30'). El histórico
// mensual se fecha así (cierre de mes) allí donde hace falta un día concreto.
export function finDeMes(month: string): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

// Suma delta meses a un 'YYYY-MM' (delta puede ser negativo).
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7)
}
