// Vacaciones que llegan desde Airtable (flujo de Julián): POST /api/avisos/v1/vacaciones,
// una fila de Airtable por envío. Se guardan en `vacaciones` (0052) por su id de Airtable:
// si la misma fila vuelve a llegar, se actualiza. Puro, sin IO: la ruta solo autentica,
// lee los perfiles y guarda lo que esto decide.
//
// A la persona se la busca al LEER, no al guardar: de la lista de Slack, la mayoría no
// tiene perfil en la plataforma, y sus vacaciones tienen que empezar a contar solas el día
// que se les dé de alta. Al recibir se busca igual, para contestar a quién corresponde y
// para rechazar una fila cuyos datos apuntan a dos personas distintas. Al leer, con esta
// misma resolverPersona y un 'conflicto' como "no cuenta" (ver procesarEnvio).
import { normalizarSlackId } from '@/lib/slack-id'
import { addDiasISO } from '@/lib/horas/auditoria-types'

// Una errata tipo "2062" dejaría a alguien sin recordatorios durante años sin que nadie se
// enterara: un periodo más largo se rechaza en vez de guardarse.
export const TOPE_DIAS_VACACIONES = 90

const ID_MAX = 200
const PATRON_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type EstadoVacacion = 'aprobada' | 'cancelada'

export interface VacacionEntrada {
  id: string // id de la fila en Airtable
  slack_id: string | null
  email: string | null // en minúsculas
  desde: string // YYYY-MM-DD, incluido
  hasta: string // YYYY-MM-DD, incluido
  estado: EstadoVacacion
}

export interface PerfilIdentificable { id: string; nombre: string; email: string | null; slack_id: string | null }

export type Resolucion =
  | { tipo: 'encontrada'; perfil: PerfilIdentificable }
  | { tipo: 'no_encontrada' }
  | { tipo: 'conflicto'; error: string }

// Una fecha YYYY-MM-DD que existe: 2026-02-30 no pasa (Date la movería al 2 de marzo).
function esFecha(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDiasISO(v, 0) === v
}

// Ausente, null o vacío es "no viene": es lo que manda Airtable con el campo en blanco.
function vacio(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
}

export function validarVacacion(body: unknown): { ok: true; valor: VacacionEntrada } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'El cuerpo tiene que ser un objeto JSON con una fila de vacaciones.' }
  }
  const b = body as Record<string, unknown>

  if (typeof b.id !== 'string' || !b.id.trim() || b.id.trim().length > ID_MAX) {
    return { ok: false, error: `Falta el id de la fila de Airtable (texto, como mucho ${ID_MAX} caracteres).` }
  }

  let slackId: string | null = null
  if (!vacio(b.slack_id)) {
    const n = typeof b.slack_id === 'string' ? normalizarSlackId(b.slack_id) : { ok: false as const }
    if (!n.ok) return { ok: false, error: 'El slack_id no es un ID de miembro de Slack (empieza por U, p. ej. U01ABCD2EFG).' }
    slackId = n.valor
  }

  let email: string | null = null
  if (!vacio(b.email)) {
    const e = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
    if (!PATRON_EMAIL.test(e)) return { ok: false, error: 'El email no tiene un formato válido.' }
    email = e
  }

  if (!slackId && !email) {
    return { ok: false, error: 'Hace falta slack_id o email para saber de quién son las vacaciones.' }
  }

  if (!esFecha(b.desde)) return { ok: false, error: 'La fecha desde tiene que ser YYYY-MM-DD y existir.' }
  if (!esFecha(b.hasta)) return { ok: false, error: 'La fecha hasta tiene que ser YYYY-MM-DD y existir.' }
  if (b.hasta < b.desde) return { ok: false, error: 'La fecha hasta no puede ser anterior a desde.' }
  if (b.hasta > addDiasISO(b.desde, TOPE_DIAS_VACACIONES - 1)) {
    return { ok: false, error: `Un periodo de vacaciones no puede pasar de ${TOPE_DIAS_VACACIONES} días.` }
  }

  // Estricto a propósito: si llegara "Aprobado" y se tomara como "no cuenta", las
  // vacaciones dejarían de funcionar sin que nadie lo notara.
  if (b.estado !== 'aprobada' && b.estado !== 'cancelada') {
    return { ok: false, error: 'El estado tiene que ser "aprobada" o "cancelada", en minúsculas.' }
  }

  return { ok: true, valor: { id: b.id.trim(), slack_id: slackId, email, desde: b.desde, hasta: b.hasta, estado: b.estado } }
}

// El slack_id manda (es único en la plataforma); el email sirve cuando no llega o cuando la
// persona aún no tiene el suyo cargado. Si los datos apuntan a dos personas, no se elige:
// asignar las vacaciones a quien no es la dejaría sin recordatorios, y nadie lo notaría.
export function resolverPersona(
  ident: { slack_id: string | null; email: string | null },
  perfiles: PerfilIdentificable[],
): Resolucion {
  const porSlack = ident.slack_id ? perfiles.find((p) => p.slack_id === ident.slack_id) ?? null : null
  const porEmail = ident.email ? perfiles.filter((p) => (p.email ?? '').trim().toLowerCase() === ident.email) : []

  if (porSlack) {
    if (porEmail.length && !porEmail.some((p) => p.id === porSlack.id)) {
      return { tipo: 'conflicto', error: `El slack_id ${ident.slack_id} es de ${porSlack.nombre} y el email ${ident.email} es de ${porEmail[0].nombre}.` }
    }
    return { tipo: 'encontrada', perfil: porSlack }
  }

  if (porEmail.length > 1) {
    return { tipo: 'conflicto', error: `El email ${ident.email} está en más de una persona de la plataforma.` }
  }
  const deEmail = porEmail[0]
  if (!deEmail) return { tipo: 'no_encontrada' }
  if (ident.slack_id && deEmail.slack_id && deEmail.slack_id !== ident.slack_id) {
    return { tipo: 'conflicto', error: `El email ${ident.email} es de ${deEmail.nombre}, que tiene otro slack_id (${deEmail.slack_id}).` }
  }
  return { tipo: 'encontrada', perfil: deEmail }
}

export interface FilaVacacion {
  airtable_id: string; slack_id: string | null; email: string | null
  desde: string; hasta: string; estado: EstadoVacacion
}

export type EnvioAceptado = { ok: true; id: string; persona: { id: string; nombre: string } | null; cuenta: boolean }
export type EnvioRechazado = { ok: false; error: string }

// Lo que contesta la URL y, si procede, la fila que hay que guardar, a partir de una fila
// ya validada (la ruta valida antes de leer los perfiles). Una fila sin persona en la
// plataforma se guarda igual (persona: null): contará si algún día se le da de alta.
//
// `persona` es a quién corresponde con los perfiles de HOY, no algo que se guarde: al leer
// se vuelve a resolver. Por eso quien lea `vacaciones` tiene que usar esta misma
// resolverPersona y tratar un 'conflicto' como "no cuenta": los perfiles cambian (se carga
// un slack_id, se da de alta a alguien) y una fila aceptada hoy puede chocar mañana. Con
// esa regla nunca acaba en otra persona; en el peor caso deja de contar y la persona
// recibe recordatorios, que es el fallo que se ve.
export function procesarEnvio(
  e: VacacionEntrada,
  perfiles: PerfilIdentificable[],
): { status: 422; respuesta: EnvioRechazado } | { status: 200; fila: FilaVacacion; respuesta: EnvioAceptado } {
  const r = resolverPersona(e, perfiles)
  // Una cancelación no le asigna vacaciones a nadie: se guarda aunque los datos choquen.
  // Rechazarla dejaría en vigor la versión aprobada que ya se guardó con esa misma fila.
  if (r.tipo === 'conflicto' && e.estado === 'aprobada') return { status: 422, respuesta: { ok: false, error: r.error } }

  return {
    status: 200,
    fila: { airtable_id: e.id, slack_id: e.slack_id, email: e.email, desde: e.desde, hasta: e.hasta, estado: e.estado },
    respuesta: {
      ok: true, id: e.id,
      persona: r.tipo === 'encontrada' ? { id: r.perfil.id, nombre: r.perfil.nombre } : null,
      cuenta: e.estado === 'aprobada',
    },
  }
}
