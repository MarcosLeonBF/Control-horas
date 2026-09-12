// Núcleo puro de los avisos (sin IO): resumen de un día, registro llamativo, niveles de
// banco y HUCHA, reintentos y textos listos para un mensaje. Lo prueba node-avisos.
import { formatFechaISO } from '@/lib/horas/format'

export const LIMITE_DIA_HORAS = 10
export const LIMITE_PROYECTO_HORAS = 6

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
