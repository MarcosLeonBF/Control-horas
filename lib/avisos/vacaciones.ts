// Ausencias (vacaciones, festivos, ausencias) que manda el flujo de Julián a
// POST /api/avisos/v1/vacaciones: una lista de personas, cada una con su slack_id y una
// acción. `activar` llega el día que empieza la ausencia y `desactivar` el día que termina.
// Lo que manda es la persona y la acción; las fechas de `eventos` son un extra que se
// guarda de referencia y solo se usa si se perdió el `activar`, para saber desde cuándo
// estaba fuera.
//
// Una ausencia va del día del `activar` al del `desactivar`, los dos incluidos: el
// `desactivar` llega el último día, que todavía es de ausencia. Abierta (sin `desactivar`)
// quiere decir que sigue fuera. Se guardan en `vacaciones` (0054) y la persona se busca al
// leer, por slack_id, para que cuente sola el día que se le dé de alta.
//
// Puro, sin IO: la ruta autentica, lee perfiles y ausencias, y ejecuta lo que esto decide.
import { normalizarSlackId } from '@/lib/slack-id'
import { addDiasISO } from '@/lib/horas/auditoria-types'
import { describirCampos, tipoDe } from '@/lib/avisos/entrantes'

export const MAX_PERSONAS = 500
const MAX_EVENTOS = 50
// Si se perdió el `activar`, el inicio sale de `eventos`, pero no más atrás que esto: una
// errata tipo 2025 no puede dejar a alguien sin recordatorios meses hacia atrás.
export const MAX_DIAS_ATRAS = 90

export type Accion = 'activar' | 'desactivar'
// De cada evento solo se guarda esto, en texto: lo demás que traiga se descarta (y con ello
// cualquier cosa que Postgres no admita en un jsonb, que tumbaría el envío entero).
export interface EventoRef { inicio?: string; fin?: string; tipo?: string }
export interface PulsoPersona { slack_id: string; accion: Accion; eventos: EventoRef[] }
export interface PerfilIdentificable { id: string; nombre: string; slack_id: string | null }
// Las ausencias guardadas que importan para un envío: las abiertas y las cerradas hoy.
export interface AusenciaActual { id: number; slack_id: string; desde: string; hasta: string | null; eventos: unknown }

export type Operacion =
  | { op: 'abrir'; slack_id: string; desde: string; eventos: EventoRef[] }
  | { op: 'cerrar'; id: number; hasta: string }
  | { op: 'cerrada'; slack_id: string; desde: string; hasta: string; eventos: EventoRef[] }

// Lo que pasó con cada persona, para quien manda:
// iniciada / ya_iniciada (ya estaba de ausencia) / terminada / ya_terminada (ya se había
// cerrado hoy) / sin_ausencia (un desactivar sin ausencia que cerrar ni fechas para crearla).
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

function limpiarEvento(e: unknown): EventoRef | null {
  if (!esObjeto(e)) return null
  const limpio: EventoRef = {}
  for (const k of ['inicio', 'fin', 'tipo'] as const) {
    const v = e[k]
    if (typeof v === 'string') limpio[k] = v.replace(/\u0000/g, '').trim().slice(0, k === 'tipo' ? 50 : 30)
  }
  return Object.keys(limpio).length ? limpio : null
}

// Los nombres de campo se aceptan tal como vienen de Airtable ("Slack ID", "Acción"): se
// comparan sin mayúsculas, tildes, espacios, guiones ni guiones bajos. Si un campo viene
// dos veces con nombres distintos, vale el primero.
const CAMPOS: Record<string, 'slack_id' | 'accion' | 'eventos'> = { slackid: 'slack_id', accion: 'accion', eventos: 'eventos' }

function camposConocidos(p: Record<string, unknown>): { slack_id?: unknown; accion?: unknown; eventos?: unknown } {
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
  let eventos: EventoRef[] = []
  if (p.eventos !== undefined && p.eventos !== null) {
    if (!Array.isArray(p.eventos)) return { ok: false, error: 'eventos, si viene, tiene que ser una lista.' }
    eventos = p.eventos.slice(0, MAX_EVENTOS).map(limpiarEvento).filter((e): e is EventoRef => e !== null)
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

// Los eventos con fechas válidas, sea cual sea su origen (lo recibido o lo guardado).
function fechasDe(eventos: unknown): { inicio: string; fin: string }[] {
  if (!Array.isArray(eventos)) return []
  return eventos.flatMap((e) => (esObjeto(e) && esFecha(e.inicio) && esFecha(e.fin) && e.inicio <= e.fin
    ? [{ inicio: e.inicio, fin: e.fin }] : []))
}

// El inicio de los eventos que siguen en curso hoy (inicio ≤ hoy ≤ fin), el más antiguo, sin
// ir más de MAX_DIAS_ATRAS atrás. Solo los que siguen en curso: un evento viejo de otra
// ausencia no puede convertir en ausencia todo lo que hay en medio, ni uno futuro inventar
// una que no ha empezado.
function inicioEnCurso(eventos: unknown, hoy: string): string | null {
  const inicios = fechasDe(eventos).filter((e) => e.inicio <= hoy && hoy <= e.fin).map((e) => e.inicio).sort()
  if (!inicios.length) return null
  const tope = addDiasISO(hoy, -MAX_DIAS_ATRAS)
  return inicios[0] < tope ? tope : inicios[0]
}

// ¿Algún evento sigue después de hoy? Distingue una ausencia nueva de un pulso repetido.
function sigueDespues(eventos: unknown, hoy: string): boolean {
  return fechasDe(eventos).some((e) => e.fin > hoy)
}

// El último día según los eventos guardados de una ausencia abierta, si lo dicen.
function finSegunEventos(eventos: unknown): string | null {
  const fines = fechasDe(eventos).map((e) => e.fin).sort()
  return fines.length ? fines[fines.length - 1] : null
}

type Abierta = { id: number; eventos: unknown } | { nueva: Extract<Operacion, { op: 'abrir' }> }

export function planificar(
  pulsos: PulsoPersona[],
  perfiles: PerfilIdentificable[],
  actuales: AusenciaActual[],
  hoy: string,
): { operaciones: Operacion[]; respuesta: EnvioAceptado; resumen: string } {
  const porSlack = new Map(perfiles.filter((p) => p.slack_id).map((p) => [p.slack_id as string, p]))
  const abiertas = new Map<string, Abierta>()
  const cerradasHoy = new Set<string>()
  // Un desactivar de este envío que no encontró nada que cerrar: si detrás viene el
  // activar de la misma persona (los dos pulsos de un festivo, al revés), es una ausencia
  // de un día.
  const desactivadasSinAusencia = new Set<string>()
  for (const a of actuales) {
    if (a.hasta === null) abiertas.set(a.slack_id, { id: a.id, eventos: a.eventos })
    else if (a.hasta === hoy) cerradasHoy.add(a.slack_id)
  }

  const operaciones: Operacion[] = []
  const personas: ResultadoPersona[] = []
  for (const { slack_id, accion, eventos } of pulsos) {
    let abierta = abiertas.get(slack_id)
    let resultado: Resultado

    // Se perdió el desactivar de una ausencia vieja: si sus eventos dicen que ya terminó,
    // se cierra en su fin y este activar abre otra. Sin esto seguiría abierta sin límite.
    if (accion === 'activar' && abierta && 'id' in abierta) {
      const fin = finSegunEventos(abierta.eventos)
      if (fin && fin < hoy) {
        operaciones.push({ op: 'cerrar', id: abierta.id, hasta: fin })
        abiertas.delete(slack_id)
        abierta = undefined
      }
    }

    if (accion === 'activar') {
      if (abierta) {
        resultado = 'ya_iniciada'
      } else if (desactivadasSinAusencia.has(slack_id)) {
        operaciones.push({ op: 'cerrada', slack_id, desde: hoy, hasta: hoy, eventos })
        desactivadasSinAusencia.delete(slack_id)
        cerradasHoy.add(slack_id)
        resultado = 'iniciada'
      } else if (cerradasHoy.has(slack_id) && !sigueDespues(eventos, hoy)) {
        // Ya se cerró hoy: es el activar de esa misma ausencia, repetido o fuera de orden.
        // Reabrirla la dejaría abierta hasta el próximo desactivar. Solo abre otra si sus
        // eventos siguen después de hoy (una ausencia nueva que empieza el día que acaba otra).
        resultado = 'ya_terminada'
      } else {
        // Normalmente llega el primer día; si llega tarde, empieza en el inicio de su evento
        // en curso.
        const nueva = { op: 'abrir' as const, slack_id, desde: inicioEnCurso(eventos, hoy) ?? hoy, eventos }
        operaciones.push(nueva)
        abiertas.set(slack_id, { nueva })
        resultado = 'iniciada'
      }
    } else if (abierta) {
      if ('id' in abierta) {
        operaciones.push({ op: 'cerrar', id: abierta.id, hasta: hoy })
      } else {
        // Abierta en este mismo envío: se guarda ya cerrada, en vez de abrir y cerrar.
        const i = operaciones.indexOf(abierta.nueva)
        operaciones[i] = { op: 'cerrada', slack_id, desde: abierta.nueva.desde, hasta: hoy, eventos: abierta.nueva.eventos }
      }
      abiertas.delete(slack_id)
      cerradasHoy.add(slack_id)
      resultado = 'terminada'
    } else if (cerradasHoy.has(slack_id)) {
      resultado = 'ya_terminada'
    } else {
      // Se perdió el activar: si un evento en curso dice desde cuándo, se guarda entera.
      const desde = inicioEnCurso(eventos, hoy)
      if (desde) {
        operaciones.push({ op: 'cerrada', slack_id, desde, hasta: hoy, eventos })
        cerradasHoy.add(slack_id)
        resultado = 'terminada'
      } else {
        desactivadasSinAusencia.add(slack_id)
        resultado = 'sin_ausencia'
      }
    }
    const perfil = porSlack.get(slack_id)
    personas.push({ slack_id, accion, persona: perfil ? { id: perfil.id, nombre: perfil.nombre } : null, resultado })
  }

  const resumen = personas
    .map((p) => `${p.persona ? p.persona.nombre || p.slack_id : `${p.slack_id} (sin usuario)`}: ${p.resultado}`)
    .join(' · ')
  return { operaciones, respuesta: { ok: true, personas }, resumen }
}

// --- Lectura: quién está fuera y qué días (para "días sin registrar") -------------

export interface FilaAusencia { slack_id: string; desde: string; hasta: string | null; eventos: unknown }

// Por slack_id: si la persona está fuera `hoy` y los días de ausencia desde `ventana` hasta
// hoy. Una ausencia va de `desde` a `hasta` (el día del desactivar, que todavía cuenta);
// abierta, sigue hasta hoy, salvo que sus eventos digan que terminó antes: entonces se
// perdió el desactivar y se da por cerrada en ese fin (sin esto, la persona se quedaría sin
// recordatorios para siempre). Mismo criterio que planificar al recibir el siguiente activar.
export function ausenciasPorPersona(
  filas: FilaAusencia[],
  hoy: string,
  ventana: string,
): Map<string, { ausenteHoy: boolean; dias: Set<string> }> {
  const porSlack = new Map<string, { ausenteHoy: boolean; dias: Set<string> }>()
  for (const f of filas) {
    if (f.desde > hoy) continue
    const segunEventos = f.hasta === null ? finSegunEventos(f.eventos) : null
    const fin = f.hasta ?? (segunEventos && segunEventos < hoy ? segunEventos : hoy)
    const a = porSlack.get(f.slack_id) ?? { ausenteHoy: false, dias: new Set<string>() }
    if (f.desde <= hoy && hoy <= fin) a.ausenteHoy = true
    const hasta = fin < hoy ? fin : hoy
    for (let d = f.desde > ventana ? f.desde : ventana; d <= hasta; d = addDiasISO(d, 1)) a.dias.add(d)
    porSlack.set(f.slack_id, a)
  }
  return porSlack
}
