// Ausencias (vacaciones, festivos, ausencias) que manda el flujo de Julián a
// POST /api/avisos/v1/vacaciones: una lista de personas (o una sola), cada una con su
// slack_id, una acción y las fechas de la ausencia. `activar` llega el día que empieza y
// `desactivar` el día que termina (el último día, que todavía es de ausencia).
//
// Mandan las FECHAS. Con "Fecha inicio" y "Fecha fin", cada pulso apunta a un periodo
// concreto: la fila de esa persona con ese día de inicio (índice único en la 0055). El
// activar y el desactivar de una misma ausencia son la misma fila, lleguen en el orden que
// lleguen, repetidos o a la vez; y termina en su fin aunque el desactivar no llegue. El
// desactivar la termina ese día (si la persona vuelve antes) o en su fin (si llega tarde).
//
// Sin fechas (respaldo): activar abre una ausencia desde hoy sin fin conocido y desactivar
// la cierra hoy. Ahí el orden sí importa y una ausencia abierta dura hasta su desactivar;
// por eso el contrato pide mandar siempre las fechas.
//
// Se guardan en `vacaciones` (0054) y la persona se busca al leer, por slack_id, para que
// cuente sola el día que se le dé de alta. Puro, sin IO: la ruta autentica, lee perfiles y
// ausencias, y ejecuta lo que esto decide.
import { normalizarSlackId } from '@/lib/slack-id'
import { addDiasISO, diaMadrid } from '@/lib/horas/auditoria-types'
import { describirCampos, tipoDe } from '@/lib/avisos/entrantes'

export const MAX_PERSONAS = 500
const MAX_EVENTOS = 50
// Una ausencia de más de un año es una errata (tipo 2062) que dejaría a alguien sin
// recordatorios durante décadas sin que nadie lo notara.
const MAX_DIAS_PERIODO = 366

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
// iniciada / ya_iniciada (ya estaba guardada) / terminada / ya_terminada (ya estaba
// terminada: un pulso repetido) / sin_ausencia (un desactivar de una ausencia que aún no
// ha empezado).
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
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(t) && !Number.isNaN(Date.parse(t))) return diaMadrid(t)
  return t.slice(0, 10)
}

function limpiarEvento(e: unknown): EventoRef | null {
  if (!esObjeto(e)) return null
  const limpio: EventoRef = {}
  for (const k of ['inicio', 'fin', 'tipo'] as const) {
    const v = e[k]
    if (typeof v !== 'string') continue
    const t = v.replace(/\u0000/g, '').trim().slice(0, k === 'tipo' ? 50 : 30)
    if (t) limpio[k] = k === 'tipo' ? t : aDia(t)
  }
  return Object.keys(limpio).length ? limpio : null
}

// Un periodo que se puede usar: las dos fechas, en orden y de como mucho un año.
function periodoDe(e: EventoRef): { inicio: string; fin: string } | null {
  if (!esFecha(e.inicio) || !esFecha(e.fin) || e.fin < e.inicio) return null
  if (e.fin > addDiasISO(e.inicio, MAX_DIAS_PERIODO - 1)) return null
  return { inicio: e.inicio, fin: e.fin }
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

function vacio(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
}

// Las fechas sueltas mandan, así que se validan: una fecha mal escrita tiene que fallar, no
// ignorarse (la ausencia quedaría sin fin, o no contaría).
function fechasSueltas(p: Partial<Record<Campo, unknown>>): { ok: true; evento: EventoRef | null } | { ok: false; error: string } {
  if (vacio(p.inicio) && vacio(p.fin)) return { ok: true, evento: null }
  if (vacio(p.inicio) || vacio(p.fin)) return { ok: false, error: 'si manda fechas, tienen que venir las dos (Fecha inicio y Fecha fin).' }
  const e = limpiarEvento({ inicio: p.inicio, fin: p.fin, tipo: p.tipo })
  if (!e || !esFecha(e.inicio)) return { ok: false, error: 'Fecha inicio tiene que ser una fecha YYYY-MM-DD.' }
  if (!esFecha(e.fin)) return { ok: false, error: 'Fecha fin tiene que ser una fecha YYYY-MM-DD.' }
  if (e.fin < e.inicio) return { ok: false, error: 'Fecha fin no puede ser anterior a Fecha inicio.' }
  if (!periodoDe(e)) return { ok: false, error: 'una ausencia no puede durar más de un año.' }
  return { ok: true, evento: e }
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
  const sueltas = fechasSueltas(p)
  if (!sueltas.ok) return sueltas
  let eventos: EventoRef[] = sueltas.evento ? [sueltas.evento] : []
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

// --- planificar: qué hacer con cada pulso --------------------------------------------

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

const cubre = (f: FilaPlan, dia: string) => f.desde <= dia && (f.hasta === null || f.hasta >= dia)

export function planificar(
  pulsos: PulsoPersona[],
  perfiles: PerfilIdentificable[],
  actuales: AusenciaActual[],
  hoy: string,
): { operaciones: Operacion[]; respuesta: EnvioAceptado; resumen: string } {
  const porSlack = new Map(perfiles.filter((p) => p.slack_id).map((p) => [p.slack_id as string, p]))
  const ayer = addDiasISO(hoy, -1)
  const filas: FilaPlan[] = actuales.map((a) => {
    const eventos = Array.isArray(a.eventos) ? (a.eventos as EventoRef[]) : []
    return { id: a.id, slack_id: a.slack_id, desde: a.desde, hasta: a.hasta, eventos, orig: { hasta: a.hasta, eventos: JSON.stringify(eventos) } }
  })
  const deLaPersona = (s: string) => filas.filter((f) => f.slack_id === s)
  const alta = (slack_id: string, desde: string, hasta: string | null, eventos: EventoRef[]) => {
    filas.push({ id: null, slack_id, desde, hasta, eventos: [...eventos], orig: null })
  }

  const personas: ResultadoPersona[] = []
  for (const { slack_id, accion, eventos } of pulsos) {
    const mias = () => deLaPersona(slack_id)
    const periodos = eventos.map(periodoDe).filter((x): x is { inicio: string; fin: string } => x !== null)
    const resultados: Resultado[] = []

    if (periodos.length) {
      // Con fechas: cada periodo es la fila de esa persona con ese día de inicio.
      for (const { inicio, fin } of periodos) {
        const f = mias().find((x) => x.desde === inicio)
        if (accion === 'activar') {
          if (f) {
            if (f.hasta === null) f.hasta = fin // estaba abierta sin fechas: ahora se sabe su fin
            conEventos(f, eventos)
            resultados.push('ya_iniciada')
          } else {
            // Una abierta sin fechas que empezó dentro de este periodo es esta misma ausencia
            // (su primer pulso llegó sin fechas): se termina en su fin.
            for (const o of mias()) if (o.hasta === null && o.desde >= inicio && o.desde <= fin) o.hasta = fin
            alta(slack_id, inicio, fin, eventos)
            resultados.push('iniciada')
          }
        } else if (hoy < inicio) {
          resultados.push('sin_ausencia') // todavía no ha empezado: no se guarda nada
        } else {
          // Termina hoy, o en su fin si el desactivar llega tarde.
          const termina = fin < hoy ? fin : hoy
          if (f) {
            conEventos(f, eventos)
            if (f.hasta === null || f.hasta > termina) {
              f.hasta = termina
              resultados.push('terminada')
            } else {
              resultados.push('ya_terminada')
            }
          } else {
            for (const o of mias()) if (o.hasta === null && o.desde >= inicio && o.desde <= termina) o.hasta = termina
            alta(slack_id, inicio, termina, eventos) // sin su activar: se perdió o llegó antes
            resultados.push('terminada')
          }
        }
      }
    } else if (accion === 'activar') {
      // Sin fechas: abre desde hoy, salvo que ya esté de ausencia. Un activar el día después
      // de terminar otra se toma por repetido (reintento pasada la medianoche): sin fechas
      // no se distingue de una ausencia nueva, y es preferible a dejar a alguien fuera sin fin.
      if (mias().some((x) => cubre(x, hoy))) resultados.push('ya_iniciada')
      else if (mias().some((x) => x.hasta === ayer)) resultados.push('ya_terminada')
      else {
        alta(slack_id, hoy, null, eventos)
        resultados.push('iniciada')
      }
    } else {
      // Sin fechas: termina hoy la ausencia en curso (la abierta si la hay). Sin ninguna, es
      // un desactivar sin su activar: al menos hoy es ausencia (llega el último día).
      const actual = mias().find((x) => x.hasta === null && x.desde <= hoy) ?? mias().find((x) => cubre(x, hoy))
      if (actual) {
        if (actual.hasta === hoy) resultados.push('ya_terminada')
        else {
          actual.hasta = hoy
          resultados.push('terminada')
        }
      } else {
        alta(slack_id, hoy, hoy, eventos)
        resultados.push('terminada')
      }
    }

    const orden: Resultado[] = accion === 'activar'
      ? ['iniciada', 'ya_iniciada', 'ya_terminada']
      : ['terminada', 'ya_terminada', 'sin_ausencia']
    const resultado = orden.find((r) => resultados.includes(r)) ?? resultados[0]
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

// Por slack_id: si la persona está fuera `hoy` y sus días de ausencia desde `ventana` hasta
// hoy (para "días sin registrar"). Una ausencia va de `desde` a `hasta`, los dos incluidos;
// sin `hasta` (llegó sin fechas y todavía no hay desactivar), sigue hasta hoy. Las que
// empiezan después de hoy no cuentan todavía.
export function ausenciasPorPersona(
  filas: FilaAusencia[],
  hoy: string,
  ventana: string,
): Map<string, { ausenteHoy: boolean; dias: Set<string> }> {
  const porSlack = new Map<string, { ausenteHoy: boolean; dias: Set<string> }>()
  for (const f of filas) {
    if (f.desde > hoy) continue
    const fin = f.hasta ?? hoy
    const a = porSlack.get(f.slack_id) ?? { ausenteHoy: false, dias: new Set<string>() }
    if (hoy <= fin) a.ausenteHoy = true
    const hasta = fin < hoy ? fin : hoy
    for (let d = f.desde > ventana ? f.desde : ventana; d <= hasta; d = addDiasISO(d, 1)) a.dias.add(d)
    porSlack.set(f.slack_id, a)
  }
  return porSlack
}

// Quién está de ausencia `hoy`, por slack_id, desde cuándo y hasta cuándo si se sabe (`fin`
// null = llegó sin fechas y todavía no hay desactivar). Lo usan los avisos (de quien está
// fuera no se manda nada) y la etiqueta del panel. Con dos ausencias a la vez se juntan: la
// vuelta es la más tardía, y desconocida si alguna no la dice.
export interface AusenciaHoy { desde: string; fin: string | null }

export function ausenciasHoy(filas: FilaAusencia[], hoy: string): Map<string, AusenciaHoy> {
  const porSlack = new Map<string, AusenciaHoy>()
  for (const f of filas) {
    if (f.desde > hoy || (f.hasta !== null && f.hasta < hoy)) continue
    const previa = porSlack.get(f.slack_id)
    const fin = f.hasta
    porSlack.set(f.slack_id, {
      desde: previa && previa.desde < f.desde ? previa.desde : f.desde,
      fin: !previa ? fin : previa.fin === null || fin === null ? null : previa.fin > fin ? previa.fin : fin,
    })
  }
  return porSlack
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
