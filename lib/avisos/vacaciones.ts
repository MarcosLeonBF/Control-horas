// Ausencias (vacaciones, festivos, ausencias) que manda el flujo de Julián a
// POST /api/avisos/v1/vacaciones: una lista de personas (o una sola), cada una con su
// slack_id y una acción, y opcionalmente las fechas de la ausencia.
//
// Es un INTERRUPTOR por persona (Roberto, 29/09): `activar` lo enciende el día que llega
// (el día que empieza la ausencia) y `desactivar` lo apaga el día que llega (el último
// día, que todavía es de vacaciones). Encendido, otro activar no hace nada; apagado, otro
// desactivar tampoco. Las fechas no deciden cuándo se enciende ni se apaga: son la RED por
// si el desactivar no llega a tiempo, y la red AVISA, no apaga (Roberto, 29/09). Si pasa la
// Fecha fin y sigue encendido, sigue de vacaciones y sale en el panel («No llegó el
// desactivar a tiempo», con botón para desactivarlo a mano en su Fecha fin); si el
// desactivar llega tarde, o llega el activar de otra ausencia, se corrige a esa fecha.
//
// Cada encendido es una fila de `vacaciones` (0054): desde el día del activar hasta el del
// desactivar (`hasta` null = encendido). La persona se busca al leer, por slack_id, para
// que cuente sola el día que se le dé de alta. Puro, sin IO: la ruta autentica, lee perfiles
// y ausencias, y ejecuta lo que esto decide.
import { normalizarSlackId } from '@/lib/slack-id'
import { addDiasISO, diaMadrid } from '@/lib/horas/auditoria-types'
import { describirCampos, tipoDe } from '@/lib/avisos/entrantes'

export const MAX_PERSONAS = 500
const MAX_EVENTOS = 50

export type Accion = 'activar' | 'desactivar'
// De cada evento solo se guarda esto, en texto: lo demás que traiga se descarta (y con ello
// cualquier cosa que Postgres no admita en un jsonb, que tumbaría el envío entero).
export interface EventoRef { inicio?: string; fin?: string; tipo?: string }
export interface PulsoPersona { slack_id: string; accion: Accion; eventos: EventoRef[] }
export interface PerfilIdentificable { id: string; nombre: string; slack_id: string | null }
// Las ausencias guardadas de las personas del envío.
export interface AusenciaActual { id: number; slack_id: string; desde: string; hasta: string | null; eventos: unknown }

// Lo que hay que hacer en la base: cambiar una fila que ya existe o dar de alta una nueva.
export type Operacion =
  | { op: 'cambio'; id: number; hasta?: string | null; eventos?: EventoRef[] }
  | { op: 'alta'; slack_id: string; desde: string; hasta: string | null; eventos: EventoRef[] }

// Lo que pasó con cada persona, para quien manda:
// iniciada / ya_iniciada (ya estaba guardada) / terminada / ya_terminada (ya había
// terminado antes de hoy: un desactivar tardío repetido) / sin_ausencia (un desactivar de
// una ausencia que aún no ha empezado).
export type Resultado = 'iniciada' | 'ya_iniciada' | 'terminada' | 'ya_terminada' | 'sin_ausencia'
export interface ResultadoPersona {
  slack_id: string; accion: Accion; persona: { id: string; nombre: string } | null; resultado: Resultado
}
export type EnvioAceptado = { ok: true; personas: ResultadoPersona[] }
export type EnvioRechazado = { ok: false; error: string }

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Una fecha YYYY-MM-DD que existe: 2026-02-30 no pasa (Date la movería al 2 de marzo).
function esFecha(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDiasISO(v, 0) === v
}

// Una fecha con hora vale por su día: si trae zona ("…T22:00:00.000Z", como serializa n8n
// la medianoche de Madrid), por su día en Madrid; sin zona, por el día que pone.
function aDia(t: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(t)) return t
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    const ms = t.replace(/(\.\d{3})\d+/, '$1') // Date solo entiende milisegundos
    if (!Number.isNaN(Date.parse(ms))) return diaMadrid(ms)
  }
  return t.slice(0, 10)
}

// De un evento se queda lo que se entiende: las fechas válidas y el tipo. Una fecha mal
// escrita se descarta, no hace fallar el pulso: el interruptor no depende de ella.
function limpiarEvento(e: unknown): EventoRef | null {
  if (!esObjeto(e)) return null
  const limpio: EventoRef = {}
  for (const k of ['inicio', 'fin', 'tipo'] as const) {
    const v = e[k]
    if (typeof v !== 'string') continue
    const t = v.replace(/\u0000/g, '').trim()
    if (!t) continue
    if (k === 'tipo') limpio.tipo = t.slice(0, 50)
    else {
      const dia = aDia(t)
      if (esFecha(dia)) limpio[k] = dia
    }
  }
  return Object.keys(limpio).length ? limpio : null
}

// Los nombres de campo se aceptan tal como vienen de Airtable ("Slack ID", "Acción", "Fecha
// inicio"): se comparan sin mayúsculas, tildes, espacios, guiones ni guiones bajos. Si un
// campo viene dos veces con nombres distintos, vale el primero. Las fechas sueltas (inicio,
// fin, tipo) son el evento de ese pulso, que es como las manda el flujo de Julián.
type Campo = 'slack_id' | 'accion' | 'eventos' | 'inicio' | 'fin' | 'tipo'
const CAMPOS: Record<string, Campo> = {
  slackid: 'slack_id', accion: 'accion', eventos: 'eventos',
  fechainicio: 'inicio', inicio: 'inicio', fechafin: 'fin', fin: 'fin', tipo: 'tipo',
}

function camposConocidos(p: Record<string, unknown>): Partial<Record<Campo, unknown>> {
  const campos: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(p)) {
    const c = CAMPOS[k.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s_-]/g, '')]
    if (c && !(c in campos)) campos[c] = v
  }
  return campos
}

function validarPersona(bruto: unknown): { ok: true; valor: PulsoPersona } | { ok: false; error: string } {
  if (!esObjeto(bruto)) return { ok: false, error: `tiene que ser un objeto con slack_id y accion (llegó: ${tipoDe(bruto)}).` }
  const p = camposConocidos(bruto)
  if (p.slack_id !== undefined && p.slack_id !== null && typeof p.slack_id !== 'string') {
    return { ok: false, error: 'el slack_id tiene que ser texto.' }
  }
  const n = typeof p.slack_id === 'string' ? normalizarSlackId(p.slack_id) : null
  if (!n || (n.ok && !n.valor)) return { ok: false, error: 'falta el slack_id.' }
  if (!n.ok || !n.valor) return { ok: false, error: 'el slack_id no es un ID de miembro de Slack (empieza por U, p. ej. U01ABCD2EFG).' }
  // Estricto a propósito: un "Activar" mal escrito tiene que fallar, no tomarse por otra cosa.
  if (p.accion !== 'activar' && p.accion !== 'desactivar') {
    return { ok: false, error: 'accion tiene que ser "activar" o "desactivar", en minúsculas.' }
  }
  const suelto = limpiarEvento({ inicio: p.inicio, fin: p.fin, tipo: p.tipo })
  let eventos: EventoRef[] = suelto && (suelto.inicio || suelto.fin) ? [suelto] : []
  if (p.eventos !== undefined && p.eventos !== null) {
    if (!Array.isArray(p.eventos)) return { ok: false, error: 'eventos, si viene, tiene que ser una lista.' }
    eventos = [...eventos, ...p.eventos.map(limpiarEvento).filter((e): e is EventoRef => e !== null)].slice(0, MAX_EVENTOS)
  }
  return { ok: true, valor: { slack_id: n.valor, accion: p.accion, eventos } }
}

// Todo o nada: si una persona no es válida se rechaza el envío entero, diciendo cuál
// (posición y, si se puede, su slack_id) y qué campos traía.
export function validarEnvio(body: unknown): { ok: true; valor: PulsoPersona[] } | EnvioRechazado {
  const lista = Array.isArray(body) ? body : esObjeto(body) ? [body] : null
  if (!lista) return { ok: false, error: `El cuerpo tiene que ser una lista de personas (o una persona) en JSON (llegó: ${tipoDe(body)}).` }
  if (!lista.length) return { ok: false, error: 'El envío no trae ninguna persona.' }
  if (lista.length > MAX_PERSONAS) {
    return { ok: false, error: `Como mucho ${MAX_PERSONAS} personas por envío; llegaron ${lista.length}.` }
  }
  const valor: PulsoPersona[] = []
  for (const [i, p] of lista.entries()) {
    const r = validarPersona(p)
    if (!r.ok) {
      const slackId = esObjeto(p) ? camposConocidos(p).slack_id : undefined
      const slack = typeof slackId === 'string' ? normalizarSlackId(slackId) : null
      const quien = slack?.ok && slack.valor ? ` (${slack.valor})` : ''
      const campos = esObjeto(p) ? ` Campos recibidos: ${describirCampos(p)}.` : ''
      return { ok: false, error: `Persona ${i + 1}${quien}: ${r.error}${campos}` }
    }
    valor.push(r.valor)
  }
  return { ok: true, valor }
}

// --- planificar: el interruptor --------------------------------------------------------

// Una fila tal como la va dejando el envío: las guardadas (con id) y las que da de alta.
interface FilaPlan {
  id: number | null
  slack_id: string
  desde: string
  hasta: string | null
  eventos: EventoRef[]
  orig: { hasta: string | null; eventos: string } | null // null = alta de este envío
}

const claveEvento = (e: EventoRef) => `${e.inicio ?? ''}|${e.fin ?? ''}|${e.tipo ?? ''}`

function conEventos(f: FilaPlan, nuevos: EventoRef[]): void {
  const vistos = new Set(f.eventos.map(claveEvento))
  const añadir = nuevos.filter((e) => !vistos.has(claveEvento(e)))
  if (añadir.length) f.eventos = [...f.eventos, ...añadir].slice(0, MAX_EVENTOS)
}

// La Fecha fin que dicen sus eventos (la más tardía que no sea anterior a cuando se
// encendió), o null si no trajo fechas. Es la red: si pasa y sigue encendido, el
// desactivar no llegó a tiempo.
function finPrevisto(f: { desde: string; eventos: unknown }): string | null {
  if (!Array.isArray(f.eventos)) return null
  let fin: string | null = null
  for (const e of f.eventos) {
    if (!esObjeto(e) || !esFecha(e.fin) || e.fin < f.desde) continue
    if (fin === null || e.fin > fin) fin = e.fin
  }
  return fin
}

// El periodo del pulso, si sus fechas son coherentes (las dos, fin no anterior a inicio). Una
// errata (fin antes del inicio, año equivocado) se ignora: no puede bloquear el interruptor.
function periodoDelPulso(eventos: EventoRef[]): { inicio: string; fin: string } | null {
  for (const e of eventos) if (esFecha(e.inicio) && esFecha(e.fin) && e.inicio <= e.fin) return { inicio: e.inicio, fin: e.fin }
  return null
}

export function planificar(
  pulsos: PulsoPersona[],
  perfiles: PerfilIdentificable[],
  actuales: AusenciaActual[],
  hoy: string,
): { operaciones: Operacion[]; respuesta: EnvioAceptado; resumen: string } {
  const porSlack = new Map(perfiles.filter((p) => p.slack_id).map((p) => [p.slack_id as string, p]))
  const filas: FilaPlan[] = actuales.map((a) => {
    const eventos = Array.isArray(a.eventos) ? (a.eventos as EventoRef[]) : []
    return { id: a.id, slack_id: a.slack_id, desde: a.desde, hasta: a.hasta, eventos, orig: { hasta: a.hasta, eventos: JSON.stringify(eventos) } }
  })

  const personas: ResultadoPersona[] = []
  for (const { slack_id, accion, eventos } of pulsos) {
    const mias = filas.filter((f) => f.slack_id === slack_id)
    let encendida = mias.find((f) => f.hasta === null)
    let resultado: Resultado

    const periodo = periodoDelPulso(eventos)
    if (accion === 'activar') {
      // Se perdió el desactivar de la anterior: se da por apagada en su Fecha fin.
      if (encendida) {
        const fin = finPrevisto(encendida)
        if (fin && fin < hoy) {
          encendida.hasta = fin
          encendida = undefined
        }
      }
      if (periodo && periodo.fin < hoy) {
        resultado = 'ya_terminada' // un activar muy tardío: esa ausencia ya terminó
      } else if (encendida) {
        conEventos(encendida, eventos)
        resultado = 'ya_iniciada'
      } else if (mias.some((f) => f.hasta === hoy)) {
        // Se apagó hoy: un activar después solo puede ser un reintento del de esta mañana.
        // Volver a encender dejaría a la persona de vacaciones sin fin.
        resultado = 'ya_terminada'
      } else {
        filas.push({ id: null, slack_id, desde: hoy, hasta: null, eventos: [...eventos], orig: null })
        resultado = 'iniciada'
      }
    } else if (encendida && periodo && periodo.fin < encendida.desde) {
      // El desactivar tardío de una ausencia anterior: no apaga la que está encendida ahora.
      resultado = 'ya_terminada'
    } else if (encendida) {
      // ¿Sigue en curso otra ausencia dentro de esta? (un festivo en medio de unas
      // vacaciones: su desactivar no apaga las vacaciones).
      const otra = periodo !== null && encendida.eventos.some((e) =>
        esFecha(e.inicio) && esFecha(e.fin) && e.inicio <= e.fin && e.inicio !== periodo.inicio && e.fin > hoy)
      conEventos(encendida, eventos)
      if (otra) {
        resultado = 'ya_iniciada'
      } else {
        // Apaga hoy. Si llega tarde, se corrige a la Fecha fin: la que trae el pulso (lo
        // último que dice Airtable, también si la alargó o la acortó) o, si no trae, la del
        // activar.
        const fin = periodo && periodo.fin >= encendida.desde ? periodo.fin : finPrevisto(encendida)
        encendida.hasta = fin && fin < hoy ? fin : hoy
        resultado = 'terminada'
      }
    } else {
      // Ya estaba apagado: repetido (hoy, o un tardío de la misma ausencia) o sin activar.
      const repetido = mias.some((f) => f.hasta === hoy || (periodo !== null && f.hasta === periodo.fin))
      resultado = repetido ? 'ya_terminada' : 'sin_ausencia'
    }

    const perfil = porSlack.get(slack_id)
    personas.push({ slack_id, accion, persona: perfil ? { id: perfil.id, nombre: perfil.nombre } : null, resultado })
  }

  // Lo que cambió respecto a la base: cambios de filas guardadas y altas nuevas.
  const operaciones: Operacion[] = []
  for (const f of filas) {
    if (f.orig === null || f.id === null) continue
    const cambio: Extract<Operacion, { op: 'cambio' }> = { op: 'cambio', id: f.id }
    if (f.hasta !== f.orig.hasta) cambio.hasta = f.hasta
    if (JSON.stringify(f.eventos) !== f.orig.eventos) cambio.eventos = f.eventos
    if (cambio.hasta !== undefined || cambio.eventos !== undefined) operaciones.push(cambio)
  }
  for (const f of filas) {
    if (f.orig === null) operaciones.push({ op: 'alta', slack_id: f.slack_id, desde: f.desde, hasta: f.hasta, eventos: f.eventos })
  }

  const resumen = personas
    .map((p) => `${p.persona ? p.persona.nombre || p.slack_id : `${p.slack_id} (sin usuario)`}: ${p.resultado}`)
    .join(' · ')
  return { operaciones, respuesta: { ok: true, personas }, resumen }
}

// --- Lectura: quién está fuera y qué días -------------------------------------------

export interface FilaAusencia { slack_id: string; desde: string; hasta: string | null; eventos: unknown }

// Hasta dónde llega una ausencia vista desde `hoy`: su desactivar si llegó; encendida, hasta
// hoy aunque su Fecha fin ya haya pasado (las fechas no apagan: solo avisan).
function finEfectivo(f: FilaAusencia, hoy: string): string {
  return f.hasta ?? hoy
}

// Desactivar a mano desde el panel (el desactivar no llegó): se apaga en su Fecha fin, que
// es cuando volvió según Airtable; sin fechas, hoy.
export function cierreManual(f: FilaAusencia, hoy: string): string {
  const fin = finPrevisto(f)
  return fin && fin < hoy ? fin : hoy
}

// Por slack_id: si la persona está fuera `hoy` y sus días de ausencia desde `ventana` hasta
// hoy (para "días sin registrar"). El día del desactivar todavía cuenta.
export function ausenciasPorPersona(
  filas: FilaAusencia[],
  hoy: string,
  ventana: string,
): Map<string, { ausenteHoy: boolean; dias: Set<string> }> {
  const porSlack = new Map<string, { ausenteHoy: boolean; dias: Set<string> }>()
  for (const f of filas) {
    if (f.desde > hoy) continue
    const fin = finEfectivo(f, hoy)
    const a = porSlack.get(f.slack_id) ?? { ausenteHoy: false, dias: new Set<string>() }
    if (hoy <= fin) a.ausenteHoy = true
    const hasta = fin < hoy ? fin : hoy
    for (let d = f.desde > ventana ? f.desde : ventana; d <= hasta; d = addDiasISO(d, 1)) a.dias.add(d)
    porSlack.set(f.slack_id, a)
  }
  return porSlack
}

// Quién está de ausencia `hoy`, por slack_id, desde cuándo y, para mostrar, hasta cuándo si
// se sabe: el día del desactivar si ya llegó (hoy es su último día) o la Fecha fin que
// trajeron sus pulsos; null si no trajeron fechas. Lo usan los avisos (de quien está fuera no
// se manda nada) y la etiqueta del panel. Con dos a la vez se juntan.
export interface AusenciaHoy { desde: string; fin: string | null }

export function ausenciasHoy(filas: FilaAusencia[], hoy: string): Map<string, AusenciaHoy> {
  const porSlack = new Map<string, AusenciaHoy>()
  for (const f of filas) {
    if (f.desde > hoy || finEfectivo(f, hoy) < hoy) continue
    // Para mostrar: el día del desactivar, o la Fecha fin mientras no haya pasado.
    const previsto = finPrevisto(f)
    const fin = f.hasta ?? (previsto && previsto >= hoy ? previsto : null)
    const previa = porSlack.get(f.slack_id)
    porSlack.set(f.slack_id, {
      desde: previa && previa.desde < f.desde ? previa.desde : f.desde,
      fin: !previa ? fin : previa.fin === null || fin === null ? null : previa.fin > fin ? previa.fin : fin,
    })
  }
  return porSlack
}

// La red, a la vista: encendidas cuya Fecha fin ya pasó sin que llegara el desactivar. Siguen
// de vacaciones hasta que llegue o se desactiven a mano: hay que revisarlas (¿se alargó la
// ausencia? ¿falló el flujo?).
export function ausenciasSinDesactivar(filas: FilaAusencia[], hoy: string): { slack_id: string; desde: string; fin: string }[] {
  return filas.flatMap((f) => {
    if (f.hasta !== null) return []
    const fin = finPrevisto(f)
    return fin && fin < hoy ? [{ slack_id: f.slack_id, desde: f.desde, fin }] : []
  }).sort((a, b) => a.fin.localeCompare(b.fin) || a.slack_id.localeCompare(b.slack_id))
}

// Las ausencias de hoy cuyo slack_id no es de ningún usuario: gente de Slack sin usuario en
// la plataforma, o alguien que sí lo tiene pero sin su ID de Slack cargado (entonces su
// ausencia no cuenta hasta que se le cargue).
export function ausenciasSinUsuario(
  filas: FilaAusencia[],
  slacksConUsuario: Set<string>,
  hoy: string,
): ({ slack_id: string } & AusenciaHoy)[] {
  return [...ausenciasHoy(filas, hoy)]
    .filter(([slack]) => !slacksConUsuario.has(slack))
    .map(([slack_id, a]) => ({ slack_id, ...a }))
    .sort((a, b) => a.desde.localeCompare(b.desde) || a.slack_id.localeCompare(b.slack_id))
}

// El texto de la etiqueta del panel de usuarios: con la fecha de vuelta si se sabe.
export function etiquetaAusencia(a: AusenciaHoy, hoy: string): string {
  const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
  if (a.fin === null) return `Ausente desde el ${ddmm(a.desde)}`
  return a.fin === hoy ? 'Ausente hasta hoy' : `Ausente hasta el ${ddmm(a.fin)}`
}
