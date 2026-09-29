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
export interface PulsoPersona { slack_id: string; accion: Accion; eventos: unknown[] }
export interface PerfilIdentificable { id: string; nombre: string; slack_id: string | null }
// Las ausencias guardadas que importan para un envío: las abiertas y las cerradas hoy.
export interface AusenciaActual { id: number; slack_id: string; desde: string; hasta: string | null }

export type Operacion =
  | { op: 'abrir'; slack_id: string; desde: string; eventos: unknown[] }
  | { op: 'cerrar'; id: number; hasta: string }
  | { op: 'cerrada'; slack_id: string; desde: string; hasta: string; eventos: unknown[] }

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

function validarPersona(p: unknown): { ok: true; valor: PulsoPersona } | { ok: false; error: string } {
  if (!esObjeto(p)) return { ok: false, error: `tiene que ser un objeto con slack_id y accion (llegó: ${tipoDe(p)}).` }
  const n = typeof p.slack_id === 'string' ? normalizarSlackId(p.slack_id) : null
  if (!n || (n.ok && !n.valor)) return { ok: false, error: 'falta el slack_id.' }
  if (!n.ok || !n.valor) return { ok: false, error: 'el slack_id no es un ID de miembro de Slack (empieza por U, p. ej. U01ABCD2EFG).' }
  // Estricto a propósito: un "Activar" mal escrito tiene que fallar, no tomarse por otra cosa.
  if (p.accion !== 'activar' && p.accion !== 'desactivar') {
    return { ok: false, error: 'accion tiene que ser "activar" o "desactivar", en minúsculas.' }
  }
  let eventos: unknown[] = []
  if (p.eventos !== undefined && p.eventos !== null) {
    if (!Array.isArray(p.eventos)) return { ok: false, error: 'eventos, si viene, tiene que ser una lista.' }
    eventos = p.eventos.slice(0, MAX_EVENTOS)
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
      const slack = esObjeto(p) && typeof p.slack_id === 'string' ? normalizarSlackId(p.slack_id) : null
      const quien = slack?.ok && slack.valor ? ` (${slack.valor})` : ''
      const campos = esObjeto(p) ? ` Campos recibidos: ${describirCampos(p)}.` : ''
      return { ok: false, error: `Persona ${i + 1}${quien}: ${r.error}${campos}` }
    }
    valor.push(r.valor)
  }
  return { ok: true, valor }
}

// El inicio más antiguo de `eventos` que ya haya llegado (una fecha futura no sirve: no se
// inventa una ausencia que no ha empezado), sin ir más de MAX_DIAS_ATRAS hacia atrás.
function inicioDeEventos(eventos: unknown[], hoy: string): string | null {
  const inicios = eventos
    .map((e) => (esObjeto(e) ? e.inicio : undefined))
    .filter((d): d is string => esFecha(d) && d <= hoy)
    .sort()
  if (!inicios.length) return null
  const tope = addDiasISO(hoy, -MAX_DIAS_ATRAS)
  return inicios[0] < tope ? tope : inicios[0]
}

type Abierta = { id: number } | { nueva: Extract<Operacion, { op: 'abrir' }> }

export function planificar(
  pulsos: PulsoPersona[],
  perfiles: PerfilIdentificable[],
  actuales: AusenciaActual[],
  hoy: string,
): { operaciones: Operacion[]; respuesta: EnvioAceptado; resumen: string } {
  const porSlack = new Map(perfiles.filter((p) => p.slack_id).map((p) => [p.slack_id as string, p]))
  const abiertas = new Map<string, Abierta>()
  const cerradasHoy = new Set<string>()
  for (const a of actuales) {
    if (a.hasta === null) abiertas.set(a.slack_id, { id: a.id })
    else if (a.hasta === hoy) cerradasHoy.add(a.slack_id)
  }

  const operaciones: Operacion[] = []
  const personas: ResultadoPersona[] = []
  for (const { slack_id, accion, eventos } of pulsos) {
    const abierta = abiertas.get(slack_id)
    let resultado: Resultado
    if (accion === 'activar') {
      if (abierta) {
        resultado = 'ya_iniciada'
      } else {
        const nueva = { op: 'abrir' as const, slack_id, desde: hoy, eventos }
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
      // Se perdió el activar: si `eventos` dice desde cuándo, se guarda la ausencia entera.
      const desde = inicioDeEventos(eventos, hoy)
      if (desde) {
        operaciones.push({ op: 'cerrada', slack_id, desde, hasta: hoy, eventos })
        cerradasHoy.add(slack_id)
        resultado = 'terminada'
      } else {
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
