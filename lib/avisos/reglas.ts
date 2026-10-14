// Núcleo puro de los avisos (sin IO): resumen de un día, registro llamativo, niveles de
// banco y HUCHA, reintentos y textos listos para un mensaje. Lo prueba node-avisos.
import { formatFechaISO } from '@/lib/horas/format'

export const LIMITE_DIA_HORAS = 10
export const LIMITE_PROYECTO_HORAS = 5

export function centesimas(n: number): number {
  return Math.round(n * 100) / 100
}

// --- Registro llamativo ------------------------------------------------------

export type ReglaLlamativo = 'dia_largo' | 'proyecto_largo'

export interface MotivoLlamativo {
  regla: ReglaLlamativo
  valor: number
  limite: number
  proyecto: string | null // solo en proyecto_largo
}

export interface DiaResumido {
  total: number
  porProyecto: Map<string, number>
}

// Suma las líneas por día y por proyecto. Redondea a centésimas, que es lo que guarda la
// base (numeric(5,2)): sin eso 0,1 + 0,2 daría 0,30000000000000004.
export function resumirPorDia(lineas: { dia: string; proyecto: string; horas: number }[]): Map<string, DiaResumido> {
  const out = new Map<string, DiaResumido>()
  for (const l of lineas) {
    const d = out.get(l.dia) ?? { total: 0, porProyecto: new Map<string, number>() }
    d.total = centesimas(d.total + Number(l.horas))
    d.porProyecto.set(l.proyecto, centesimas((d.porProyecto.get(l.proyecto) ?? 0) + Number(l.horas)))
    out.set(l.dia, d)
  }
  return out
}

export function motivosLlamativo(dia: DiaResumido): MotivoLlamativo[] {
  const out: MotivoLlamativo[] = []
  if (dia.total > LIMITE_DIA_HORAS) {
    out.push({ regla: 'dia_largo', valor: dia.total, limite: LIMITE_DIA_HORAS, proyecto: null })
  }
  for (const [proyecto, horas] of dia.porProyecto) {
    if (proyecto === 'Departamento') continue // horas internas: no son "un proyecto"
    if (horas >= LIMITE_PROYECTO_HORAS) {
      out.push({ regla: 'proyecto_largo', valor: horas, limite: LIMITE_PROYECTO_HORAS, proyecto })
    }
  }
  return out
}

// Clave de deduplicación: un aviso por persona, día y regla (y proyecto).
export function claveLlamativo(duenoId: string, dia: string, m: MotivoLlamativo): string {
  return `llamativo:${duenoId}:${dia}:${m.regla}${m.proyecto ? `:${m.proyecto}` : ''}`
}

// --- Niveles de banco y HUCHA ------------------------------------------------

export type Nivel = 'disponible' | 'bajo' | 'consumido' | 'excedido'

const ORDEN: Record<Nivel, number> = { disponible: 0, bajo: 1, consumido: 2, excedido: 3 }

// Los estados que no son un nivel (sin_asignacion, sin_presupuesto) no avisan. hasOwnProperty
// y no `in`: `'toString' in ORDEN` es true por herencia.
export function comoNivel(estado: string): Nivel | null {
  return Object.prototype.hasOwnProperty.call(ORDEN, estado) ? (estado as Nivel) : null
}

export interface Transicion {
  guardar: boolean // hay que anotar el nivel nuevo en avisos_estado
  avisar: boolean // empeoró: sale un aviso de nivel
  alTope: boolean // además cruzó a consumido o más desde abajo
}

export function transicion(anterior: Nivel | null, actual: Nivel): Transicion {
  // Primera vez que se ve este banco: se anota sin avisar (sin avalancha al encender).
  if (anterior === null) return { guardar: true, avisar: false, alTope: false }
  if (ORDEN[actual] > ORDEN[anterior]) {
    const alTope = ORDEN[actual] >= ORDEN.consumido && ORDEN[anterior] < ORDEN.consumido
    return { guardar: true, avisar: true, alTope }
  }
  // Mejoró (p. ej. una ampliación): se rearma en silencio para avisar si vuelve a caer.
  if (ORDEN[actual] < ORDEN[anterior]) return { guardar: true, avisar: false, alTope: false }
  return { guardar: false, avisar: false, alTope: false }
}

// Qué avisos salen de una transición de banco. El tope es solo para el total del proyecto:
// que se agote una posición no es «vender más horas al cliente».
export function avisosDeBanco(t: Transicion, alcance: 'posicion' | 'proyecto'): ('banco.nivel' | 'banco.al_tope')[] {
  if (!t.avisar) return []
  return t.alTope && alcance === 'proyecto' ? ['banco.nivel', 'banco.al_tope'] : ['banco.nivel']
}

// Qué registro enlazar en el aviso de banco de cada proyecto que tocó un guardado. Un
// guardado se parte en un registro por día (guardar_registro), y un proyecto puede estar en
// varios: se enlaza el del día más reciente. `logPorDia` son los registros de ESTE guardado;
// un día que no esté ahí no se inventa. Departamento no tiene banco, así que no entra.
export function registroPorProyecto(
  lineas: { entry_date: string; project: string }[], logPorDia: Map<string, string>,
): Map<string, { id: string; dia: string }> {
  const out = new Map<string, { id: string; dia: string }>()
  for (const l of lineas) {
    const proyecto = l.project.trim()
    const id = logPorDia.get(l.entry_date)
    if (proyecto === 'Departamento' || !id) continue
    const previo = out.get(proyecto)
    // Fechas ISO (AAAA-MM-DD): el orden de texto es el orden de fechas.
    if (!previo || l.entry_date > previo.dia) out.set(proyecto, { id, dia: l.entry_date })
  }
  return out
}

// --- Espera de los avisos de un registro (0061) -------------------------------
// Los avisos que dispara un guardado salen ESPERA_REGISTRO_MINUTOS después del último
// cambio y se arman con cómo quedaron los registros: si la persona corrige la fecha o las
// horas en ese rato, el aviso sale ya corregido.

export const ESPERA_REGISTRO_MINUTOS = 5
export const MAX_INTENTOS_REVISION = 3

export interface LineaGuardada {
  entry_date: string
  project: string
  hours: number
}

// Un registro de la espera tal como está al procesarla.
export interface RegistroActual {
  id: string
  entry_date: string
  status: string
  lineas: { project: string; hours: number }[]
}

// Las líneas del guardado según cómo quedaron sus registros (los anulados no cuentan) y qué
// registro enlazar en cada día. Si dos registros acaban en la misma fecha, el día enlaza el
// de más horas; a igualdad, el de id menor, para que no dependa del orden de la consulta.
export function armarGuardado(registros: RegistroActual[]): { lineas: LineaGuardada[]; logPorDia: Map<string, string> } {
  const vivos = registros.filter((r) => r.status !== 'anulado').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const lineas: LineaGuardada[] = []
  const mejor = new Map<string, { id: string; horas: number }>()
  for (const r of vivos) {
    let horas = 0
    for (const l of r.lineas) {
      lineas.push({ entry_date: r.entry_date, project: l.project, hours: Number(l.hours) })
      horas = centesimas(horas + Number(l.hours))
    }
    const previo = mejor.get(r.entry_date)
    if (!previo || horas > previo.horas) mejor.set(r.entry_date, { id: r.id, horas })
  }
  return { lineas, logPorDia: new Map([...mejor].map(([dia, m]) => [dia, m.id])) }
}

export interface PulsoPlan {
  dia: string
  horasRegistro: number
  horasDia: number
  proyectos: { proyecto: string; horas: number }[]
}

export interface LlamativoPlan {
  dia: string
  motivo: MotivoLlamativo
  horasDia: number
}

// Qué avisos de registro salen de un guardado: el pulso (solo altas, uno por fecha) y los
// llamativos de cada fecha. `totales` es el día entero de la persona (todos sus registros
// no anulados), no solo este guardado.
export function planAvisosRegistro(args: {
  esAlta: boolean; lineas: LineaGuardada[]; totales: Map<string, DiaResumido>
}): { pulsos: PulsoPlan[]; llamativos: LlamativoPlan[] } {
  const deEste = resumirPorDia(args.lineas.map((l) => ({ dia: l.entry_date, proyecto: l.project.trim(), horas: Number(l.hours) })))
  const pulsos: PulsoPlan[] = []
  const llamativos: LlamativoPlan[] = []
  // Fechas ISO (AAAA-MM-DD): el orden de texto es el orden de fechas.
  for (const dia of [...deEste.keys()].sort()) {
    const total = args.totales.get(dia) ?? { total: 0, porProyecto: new Map<string, number>() }
    const este = deEste.get(dia)!
    if (args.esAlta) {
      pulsos.push({
        dia, horasRegistro: este.total, horasDia: total.total,
        proyectos: [...este.porProyecto].map(([proyecto, horas]) => ({ proyecto, horas })),
      })
    }
    for (const motivo of motivosLlamativo(total)) llamativos.push({ dia, motivo, horasDia: total.total })
  }
  return { pulsos, llamativos }
}

// Milisegundos que quedan hasta `fin` (0 si ya pasó): para repartir un único plazo entre
// varias tandas dentro de una misma función (maxDuration).
export function plazoRestante(fin: number, ahora = Date.now()): number {
  return Math.max(0, fin - ahora)
}

// Cuántas de estas esperas vencieron hace más de 15 minutos. El reloj de Supabase las toma
// al minuto de vencer, así que si aparecen es que se paró (clave mal copiada en Vault, URL
// cambiada...) y las está sacando la red: el guardado siguiente o el cron diario.
export const ATRASO_RELOJ_MINUTOS = 15
export function esperasAtrasadas(vencimientos: string[], ahora = Date.now()): number {
  const limite = ahora - ATRASO_RELOJ_MINUTOS * 60_000
  return vencimientos.filter((v) => Date.parse(v) < limite).length
}

// Tras un intento fallido de procesar una espera: vuelve a la cola (el reloj la toma al
// minuto siguiente) hasta MAX_INTENTOS_REVISION; después queda 'fallida'.
export function estadoTrasFallo(intentos: number): 'pendiente' | 'fallida' {
  return intentos >= MAX_INTENTOS_REVISION ? 'fallida' : 'pendiente'
}

// --- Reintentos --------------------------------------------------------------

export const MAX_INTENTOS = 5
const ESPERA_MINUTOS = [5, 30, 120, 720] // tras el 1.º, 2.º, 3.º y 4.º intento fallido

// Cuándo reintentar tras `intentos` fallidos (contando el que acaba de fallar). null = no
// se reintenta más y el aviso queda fallido.
export function siguienteIntento(intentos: number, ahora: Date): Date | null {
  if (intentos >= MAX_INTENTOS) return null
  const minutos = ESPERA_MINUTOS[Math.max(0, intentos - 1)]
  return new Date(ahora.getTime() + minutos * 60_000)
}

// --- Textos listos para un mensaje -------------------------------------------

const HORAS_CORTAS = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })

export function horasCortas(n: number): string {
  return `${HORAS_CORTAS.format(n)} h`
}

export function textoProyectos(p: { proyecto: string; horas: number }[]): string {
  return p.map((x) => `${x.proyecto} (${horasCortas(x.horas)})`).join(', ')
}

export function descripcionLlamativo(m: MotivoLlamativo, dia: string): string {
  const ddmm = formatFechaISO(dia).slice(0, 5)
  return m.regla === 'dia_largo'
    ? `${horasCortas(m.valor)} registradas el ${ddmm} (límite: ${horasCortas(m.limite)})`
    : `${horasCortas(m.valor)} a ${m.proyecto} el ${ddmm} (límite: ${horasCortas(m.limite)})`
}
