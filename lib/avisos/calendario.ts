// Días sin registrar, para la escalera de recordatorios que monta el flujo de Julián.
// Puro, sin IO: el día a día (qué fechas registró cada uno) llega ya resuelto.
import { addDiasISO } from '@/lib/horas/auditoria-types'

export const TOPE_DIAS = 30

function esFinDeSemana(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay()
  return d === 0 || d === 6
}

export function esLaborable(iso: string, festivos: Set<string>): boolean {
  return !esFinDeSemana(iso) && !festivos.has(iso)
}

// Cuenta hacia atrás, desde el día anterior a `fecha`, los laborables seguidos sin
// registro. Se para en el primer laborable registrado, al llegar al día del alta de la
// persona o al tope. `desde` es el pendiente más antiguo.
export function diasSinRegistrar(args: {
  fecha: string
  registrados: Set<string>
  festivos: Set<string>
  alta: string
  tope?: number
}): { dias: number; desde: string | null } {
  const tope = args.tope ?? TOPE_DIAS
  let dias = 0
  let desde: string | null = null
  // Salvaguarda: como mucho 3 × tope días naturales (fines de semana y festivos incluidos).
  for (let d = addDiasISO(args.fecha, -1), vueltas = 0;
    d >= args.alta && dias < tope && vueltas < tope * 3;
    d = addDiasISO(d, -1), vueltas++) {
    if (!esLaborable(d, args.festivos)) continue
    if (args.registrados.has(d)) break
    dias++
    desde = d
  }
  return { dias, desde }
}

// Los laborables sin registro entre los últimos `tope` laborables antes de `fecha` (hoy no
// cuenta), sin días anteriores al alta, del más antiguo al más reciente. A diferencia de
// diasSinRegistrar no se para en el primer día registrado: un lunes sin registrar sigue
// pendiente aunque el martes sí se registrara.
export function diasPendientes(args: {
  fecha: string
  registrados: Set<string>
  festivos: Set<string>
  alta: string
  tope?: number
}): string[] {
  const tope = args.tope ?? TOPE_DIAS
  const pendientes: string[] = []
  let laborables = 0
  for (let d = addDiasISO(args.fecha, -1), vueltas = 0;
    d >= args.alta && laborables < tope && vueltas < tope * 3;
    d = addDiasISO(d, -1), vueltas++) {
    if (!esLaborable(d, args.festivos)) continue
    laborables++
    if (!args.registrados.has(d)) pendientes.push(d)
  }
  return pendientes.reverse()
}

export function ultimoAntesDe(fechas: Iterable<string>, fecha: string): string | null {
  let ultimo: string | null = null
  for (const f of fechas) if (f < fecha && (ultimo === null || f > ultimo)) ultimo = f
  return ultimo
}

// ¿Puede la persona registrar todavía `desde` por su cuenta? (7 días o su ventana ampliada)
export function dentroDePlazo(desde: string, hoy: string, diasAtras: number): boolean {
  return desde >= addDiasISO(hoy, -diasAtras)
}

// El parámetro `fecha` de la consulta. Sin fecha, hoy. Una fecha futura daría por perdidos
// días que todavía no han terminado (o ni han empezado), así que se rechaza.
export function fechaDeConsulta(pedida: string | null, hoy: string): { fecha: string } | { error: string } {
  if (pedida === null) return { fecha: hoy }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pedida)) return { error: 'El parámetro fecha tiene que ser YYYY-MM-DD.' }
  if (pedida > hoy) return { error: 'El parámetro fecha no puede ser posterior a hoy.' }
  return { fecha: pedida }
}
