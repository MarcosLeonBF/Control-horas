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
  | { op: 'eventos'; id: number; eventos: EventoRef[] }
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
    if (typeof v !== 'string') continue
    let t = v.replace(/\u0000/g, '').trim().slice(0, k === 'tipo' ? 50 : 30)
    // Una fecha con hora ("2026-10-02T00:00:00.000Z", como la serializan a veces Airtable o
    // n8n) vale por su día.
    if (k !== 'tipo' && /^\d{4}-\d{2}-\d{2}T/.test(t)) t = t.slice(0, 10)
    if (t) limpio[k] = t
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

// ¿Hay un evento en curso hoy que sigue después? Distingue una ausencia nueva (que empieza el
// día que acaba otra) de un pulso repetido. Uno futuro no cuenta: es otra ausencia.
function sigueDespues(eventos: unknown, hoy: string): boolean {
  return fechasDe(eventos).some((e) => e.inicio <= hoy && hoy < e.fin)
}

// El último día de una ausencia según SUS eventos: los que contienen su primer día. Uno viejo
// o uno futuro de otra ausencia no dice nada de esta (y cerrarla en un fin anterior a su
// inicio la rompería).
function finSegunEventos(eventos: unknown, desde: string): string | null {
  const fines = fechasDe(eventos).filter((e) => e.inicio <= desde && desde <= e.fin).map((e) => e.fin).sort()
  return fines.length ? fines[fines.length - 1] : null
}

// Carreras: si dos envíos a la vez dejaron a una persona con una ausencia abierta y otra ya
// cerrada que la alcanza (el activar y el desactivar de un festivo, a la vez), la abierta es
// esa misma ausencia: se da por cerrada donde acaba la otra. No si sus eventos dicen que
// sigue después (una ausencia nueva que empieza el día que acaba otra).
function cierrePorCarrera(
  abierta: { slack_id: string; desde: string; eventos: unknown },
  filas: { slack_id: string; hasta: string | null }[],
): string | null {
  const fin = finSegunEventos(abierta.eventos, abierta.desde)
  let cierre: string | null = null
  for (const f of filas) {
    if (f.slack_id !== abierta.slack_id || f.hasta === null || f.hasta < abierta.desde) continue
    if (fin !== null && fin > f.hasta) continue
    if (cierre === null || f.hasta > cierre) cierre = f.hasta
  }
  return cierre
}

type Abierta = { id: number; desde: string; eventos: unknown } | { nueva: Extract<Operacion, { op: 'abrir' }> }

export function planificar(
  pulsos: PulsoPersona[],
  perfiles: PerfilIdentificable[],
  actuales: AusenciaActual[],
  hoy: string,
): { operaciones: Operacion[]; respuesta: EnvioAceptado; resumen: string } {
  const porSlack = new Map(perfiles.filter((p) => p.slack_id).map((p) => [p.slack_id as string, p]))
  const ayer = addDiasISO(hoy, -1)
  const abiertas = new Map<string, Abierta>()
  const cerradasHoy = new Set<string>()
  const cerradasAyer = new Set<string>()
  const operaciones: Operacion[] = []
  for (const a of actuales) {
    if (a.hasta === hoy) cerradasHoy.add(a.slack_id)
    else if (a.hasta === ayer) cerradasAyer.add(a.slack_id)
  }
  for (const a of actuales) {
    if (a.hasta !== null) continue
    // Una carrera anterior la dejó abierta junto a otra cerrada: se repara ahora.
    const cierre = cierrePorCarrera(a, actuales)
    if (cierre) {
      operaciones.push({ op: 'cerrar', id: a.id, hasta: cierre })
      if (cierre === hoy) cerradasHoy.add(a.slack_id)
      continue
    }
    abiertas.set(a.slack_id, { id: a.id, desde: a.desde, eventos: a.eventos })
  }

  const personas: ResultadoPersona[] = []
  for (const { slack_id, accion, eventos } of pulsos) {
    let abierta = abiertas.get(slack_id)
    let resultado: Resultado

    // Se perdió el desactivar de una ausencia vieja: si sus eventos dicen que ya terminó,
    // se cierra en su fin y este activar abre otra. Sin esto seguiría abierta sin límite.
    if (accion === 'activar' && abierta && 'id' in abierta) {
      const fin = finSegunEventos(abierta.eventos, abierta.desde)
      if (fin && fin < hoy) {
        operaciones.push({ op: 'cerrar', id: abierta.id, hasta: fin })
        abiertas.delete(slack_id)
        abierta = undefined
      }
    }

    if (accion === 'activar') {
      if (abierta) {
        // Repetido. Si trae fechas que la ausencia guardada no tenía (el primer pulso llegó
        // sin ellas), se añaden: así se sabe cuándo vuelve.
        if ('id' in abierta) {
          const guardados = Array.isArray(abierta.eventos) ? (abierta.eventos as EventoRef[]) : []
          const clave = (e: EventoRef) => `${e.inicio ?? ''}|${e.fin ?? ''}|${e.tipo ?? ''}`
          const vistos = new Set(guardados.map(clave))
          const nuevos = eventos.filter((e) => !vistos.has(clave(e)))
          if (nuevos.length) {
            const todos = [...guardados, ...nuevos].slice(0, MAX_EVENTOS)
            operaciones.push({ op: 'eventos', id: abierta.id, eventos: todos })
            abierta.eventos = todos
          }
        }
        resultado = 'ya_iniciada'
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
    } else if (cerradasHoy.has(slack_id) || cerradasAyer.has(slack_id)) {
      // Repetido: el mismo día, o reintentado pasada la medianoche.
      resultado = 'ya_terminada'
    } else if (fechasDe(eventos).length && !inicioEnCurso(eventos, hoy)) {
      // Sus fechas dicen que la ausencia no es hoy: no se inventa una.
      resultado = 'sin_ausencia'
    } else {
      // Sin su activar (se perdió, o llegó antes que él: los pulsos van de uno en uno). El
      // desactivar llega el último día, así que al menos hoy es ausencia; si un evento en
      // curso dice desde cuándo, se guarda entera. Así el activar que llegue después no
      // reabre nada.
      operaciones.push({ op: 'cerrada', slack_id, desde: inicioEnCurso(eventos, hoy) ?? hoy, hasta: hoy, eventos })
      cerradasHoy.add(slack_id)
      resultado = 'terminada'
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
// Hasta qué día llega una ausencia vista desde `hoy`, y si sigue abierta (sin fecha de
// vuelta conocida).
function finDe(f: FilaAusencia, hoy: string): { fin: string; abierta: boolean } {
  if (f.hasta !== null) return { fin: f.hasta, abierta: false }
  const segunEventos = finSegunEventos(f.eventos, f.desde)
  return segunEventos && segunEventos < hoy ? { fin: segunEventos, abierta: false } : { fin: hoy, abierta: true }
}

// Las filas tal como hay que leerlas: una abierta que una carrera dejó junto a otra cerrada
// que la alcanza se lee cerrada ahí (el siguiente pulso de esa persona la repara en la base).
function sinCarreras(filas: FilaAusencia[]): FilaAusencia[] {
  return filas.map((f) => {
    if (f.hasta !== null) return f
    const cierre = cierrePorCarrera(f, filas)
    return cierre ? { ...f, hasta: cierre } : f
  })
}

export function ausenciasPorPersona(
  filas: FilaAusencia[],
  hoy: string,
  ventana: string,
): Map<string, { ausenteHoy: boolean; dias: Set<string> }> {
  const porSlack = new Map<string, { ausenteHoy: boolean; dias: Set<string> }>()
  for (const f of sinCarreras(filas)) {
    if (f.desde > hoy) continue
    const { fin } = finDe(f, hoy)
    const a = porSlack.get(f.slack_id) ?? { ausenteHoy: false, dias: new Set<string>() }
    if (f.desde <= hoy && hoy <= fin) a.ausenteHoy = true
    const hasta = fin < hoy ? fin : hoy
    for (let d = f.desde > ventana ? f.desde : ventana; d <= hasta; d = addDiasISO(d, 1)) a.dias.add(d)
    porSlack.set(f.slack_id, a)
  }
  return porSlack
}

// Quién está de ausencia `hoy`, por slack_id, desde cuándo y hasta cuándo si se sabe: `fin`
// es el día del desactivar si ya llegó (hoy es su último día) o el fin que trajeron sus
// eventos; null si el pulso llegó sin fechas y todavía no hay desactivar. Lo usan los avisos
// (de quien está fuera no se manda nada) y la etiqueta del panel. Con dos ausencias a la vez
// se juntan: la vuelta es la más tardía, y desconocida si alguna no la dice.
export interface AusenciaHoy { desde: string; fin: string | null }

export function ausenciasHoy(filas: FilaAusencia[], hoy: string): Map<string, AusenciaHoy> {
  const porSlack = new Map<string, AusenciaHoy>()
  for (const f of sinCarreras(filas)) {
    if (f.desde > hoy) continue
    const fin = f.hasta ?? finSegunEventos(f.eventos, f.desde)
    if (fin !== null && fin < hoy) continue // terminó (o se perdió el desactivar y sus eventos ya acabaron)
    const previa = porSlack.get(f.slack_id)
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
