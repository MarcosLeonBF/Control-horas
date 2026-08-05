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

// 'YYYY-MM' → "Julio de 2026" (es-ES, inicial mayúscula; el "de" lo pone Intl). Si no
// es un mes válido, devuelve la entrada tal cual. timeZone UTC para no deslizarse de mes.
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

// Los meses ('YYYY-MM') que toca un rango de fechas ISO, en orden y con los dos
// extremos incluidos ('2026-06-15' → '2026-08-03' da junio, julio y agosto). La vista
// por mes de /reportes lo usa para rellenar los meses del rango que no tienen ni una
// línea. Si `to` es anterior a `from`, no hay meses.
export function mesesEnRango(from: string, to: string): string[] {
  const fin = to.slice(0, 7)
  const meses: string[] = []
  // Comparación de cadenas: 'YYYY-MM' ordena lexicográficamente igual que
  // cronológicamente, así que no hace falta pasar por Date.
  for (let m = from.slice(0, 7); m <= fin; m = addMonths(m, 1)) meses.push(m)
  return meses
}

// Minutos → horas, redondeado a centésimas porque es lo que la BD guarda
// (`time_log_lines.hours` es numeric(5,2)). Solo los múltiplos de 3 minutos caben
// exactos: 10 min son 0,1666… y se guardan como 0,17. Decisión tomada a sabiendas
// (spec 2026-08-05-registro-minutos-design), no un descuido de precisión.
export function minutosAHoras(min: number): number {
  return Math.round((min / 60) * 100) / 100
}

// Horas → minutos enteros. Redondea porque el valor guardado ya viene redondeado a
// centésimas: 0,17 h son 10,2 minutos, y el campo debe volver a mostrar 10.
export function horasAMinutos(horas: number): number {
  return Math.round(horas * 60)
}
