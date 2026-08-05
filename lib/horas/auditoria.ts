import { createClient } from '@/lib/supabase/server'
import type {
  AuditAction, AuditAsientoLog, AuditDateBase, AuditEntry, AuditResumenCambio, AuditSnapshotLine,
} from '@/lib/horas/auditoria-types'
import { addDiasISO, inicioDiaMadridUTC, resumirCambio, ultimoAsientoPorLog } from '@/lib/horas/auditoria-types'

// Tope duro de filas por carga. A ~660 asientos al mes son unos 7 meses de holgura;
// pasado eso la pantalla lo dice y pide acotar, en vez de truncar en silencio como
// hacía el limit(200) anterior.
export const AUDIT_MAX_ROWS = 5000

// PostgREST devuelve como mucho 1.000 filas por petición: hay que paginar.
const PAGE_SIZE = 1000

// uuids por consulta `.in(...)`: 100 son unos 4 KB de query string, lejos del límite
// de cualquier proxy. Solo entra en juego con asientos previos a 0041.
const LOTE_IDS = 100

interface RawAudit {
  id: string
  log_id: string | null
  action: AuditAction
  actor_id: string | null
  actor_name: string | null
  subject_name: string | null
  entry_date: string | null
  total_hours: number | string | null
  at: string
  lines_before: AuditSnapshotLine[] | null
  lines_after: AuditSnapshotLine[] | null
}

// Los snapshots se seleccionan pero NO se reenvían al navegador: aquí solo sirven para
// calcular el resumen compacto. El detalle lo pide la fila al desplegarse.
const COLS = 'id, log_id, action, actor_id, actor_name, subject_name, entry_date, total_hours, at, lines_before, lines_after'

// Asientos de auditoría del rango, del más reciente al más antiguo.
//
// `base` decide sobre qué columna se acota:
//   - 'at' (por defecto): instante del movimiento. Es un timestamptz, así que los
//     límites se calculan como el inicio del día EN MADRID, no en UTC (ver
//     inicioDiaMadridUTC): si no, en verano se perderían las dos primeras horas.
//     El límite superior es exclusivo sobre el día siguiente, para que `to` entre
//     entero.
//   - 'entry_date': día de trabajo del registro afectado. Es un date pelado y la
//     comparación es directa, sin zonas horarias de por medio.
export async function getAuditEntries(
  from: string,
  to: string,
  base: AuditDateBase,
): Promise<{ entries: AuditEntry[]; truncado: boolean }> {
  const supabase = await createClient()

  // Ojo al orden de las llamadas: en supabase-js, `.order()` devuelve un
  // TransformBuilder que ya NO tiene `.gte()`. Los filtros van primero, el orden
  // después; al revés no compila.
  const pagina = (desde: number, hasta: number) => {
    const q = supabase.from('time_log_audit').select(COLS)
    const acotada =
      base === 'entry_date'
        ? q.gte('entry_date', from).lte('entry_date', to)
        : q.gte('at', inicioDiaMadridUTC(from)).lt('at', inicioDiaMadridUTC(addDiasISO(to, 1)))
    // `id` desempata: un guardado multi-fecha escribe un asiento por fecha, todos con
    // el mismo now(). Sin segunda clave el orden dentro del empate es libre, y con
    // paginación por offset un corte de página dentro del empate puede repetir una
    // fila o comerse otra.
    return acotada.order('at', { ascending: false }).order('id', { ascending: false }).range(desde, hasta)
  }

  // Se pide una fila de más que el tope: si aparece, es que el rango no cabe.
  const raw: RawAudit[] = []
  for (let desde = 0; desde <= AUDIT_MAX_ROWS; desde += PAGE_SIZE) {
    const { data, error } = await pagina(desde, Math.min(desde + PAGE_SIZE - 1, AUDIT_MAX_ROWS))
    if (error) {
      // No lo tragamos como "sin filas": con hasta 6 peticiones por carga, un fallo a
      // mitad del bucle dejaría un resultado parcial que se leería como completo. En
      // una pantalla de auditoría, mentir sobre qué hay es peor que romper visible.
      throw new Error(
        `Auditoría: fallo consultando time_log_audit (rango ${from}..${to}, base ${base}, offset ${desde}): ${error.message}`,
      )
    }
    const chunk = (data ?? []) as unknown as RawAudit[]
    raw.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
  }

  const truncado = raw.length > AUDIT_MAX_ROWS
  const visibles = raw.slice(0, AUDIT_MAX_ROWS)
  const reconstruibles = await lineasReconstruibles(supabase, visibles)

  const entries: AuditEntry[] = visibles.map((r) => ({
    id: r.id,
    action: r.action,
    actorId: r.actor_id,
    actorName: r.actor_name ?? '—',
    subjectName: r.subject_name ?? '—',
    entryDate: r.entry_date,
    totalHours: r.total_hours == null ? null : Number(r.total_hours),
    at: r.at,
    cambio: resumenDe(r, reconstruibles),
  }))

  return { entries, truncado }
}

function resumenDe(r: RawAudit, reconstruibles: Map<string, number>): AuditResumenCambio | null {
  if (r.lines_before !== null || r.lines_after !== null) {
    return resumirCambio(r.lines_before, r.lines_after)
  }
  const lineas = reconstruibles.get(r.id)
  return lineas ? { tipo: 'reconstruido', lineas } : null
}

type Supabase = Awaited<ReturnType<typeof createClient>>

// id del asiento → nº de líneas vivas, para los asientos previos a 0041 cuyo detalle
// sí se puede reconstruir (ver `ultimoAsientoPorLog`). Los que no califican no salen
// del mapa y se quedan sin detalle, que es lo honesto.
async function lineasReconstruibles(supabase: Supabase, raw: RawAudit[]): Promise<Map<string, number>> {
  // Candidatos: sin snapshots y todavía apuntando a un registro. `log_id` es
  // `on delete set null`, así que un log_id no nulo garantiza que el time_logs existe.
  const candidatos = raw.filter((r) => r.lines_before === null && r.lines_after === null && r.log_id !== null)
  if (candidatos.length === 0) return new Map()

  // Se consulta TODA la historia de esos registros, sin el filtro de rango: un asiento
  // puede ser el más nuevo de la ventana visible y tener ediciones posteriores fuera de
  // ella. Mirar solo lo cargado daría por "último" algo que no lo es.
  const asientos = await asientosDeLogs(supabase, unicos(candidatos.map((r) => r.log_id!)))
  const ultimo = ultimoAsientoPorLog(asientos)

  const califican = candidatos.filter((r) => ultimo.get(r.log_id!) === r.id)
  if (califican.length === 0) return new Map()

  const cuentas = await contarLineasVivas(supabase, unicos(califican.map((r) => r.log_id!)))
  const salida = new Map<string, number>()
  for (const r of califican) {
    const n = cuentas.get(r.log_id!) ?? 0
    // Un registro sin líneas vivas no da nada que enseñar: mejor "sin detalle" que un
    // "creado con 0 líneas" que se leería como un hecho.
    if (n > 0) salida.set(r.id, n)
  }
  return salida
}

const unicos = (ids: string[]) => [...new Set(ids)]

async function asientosDeLogs(supabase: Supabase, logIds: string[]): Promise<AuditAsientoLog[]> {
  const out: AuditAsientoLog[] = []
  for (let i = 0; i < logIds.length; i += LOTE_IDS) {
    const lote = logIds.slice(i, i + LOTE_IDS)
    for (let desde = 0; ; desde += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('time_log_audit')
        .select('id, log_id, at')
        .in('log_id', lote)
        .range(desde, desde + PAGE_SIZE - 1)
      if (error) {
        throw new Error(`Auditoría: fallo buscando el último movimiento de ${lote.length} registros: ${error.message}`)
      }
      const chunk = (data ?? []) as unknown as { id: string; log_id: string; at: string }[]
      for (const a of chunk) out.push({ id: a.id, logId: a.log_id, at: a.at })
      if (chunk.length < PAGE_SIZE) break
    }
  }
  return out
}

async function contarLineasVivas(supabase: Supabase, logIds: string[]): Promise<Map<string, number>> {
  const cuentas = new Map<string, number>()
  for (let i = 0; i < logIds.length; i += LOTE_IDS) {
    const lote = logIds.slice(i, i + LOTE_IDS)
    for (let desde = 0; ; desde += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('time_log_lines')
        .select('log_id')
        .in('log_id', lote)
        .range(desde, desde + PAGE_SIZE - 1)
      if (error) {
        throw new Error(`Auditoría: fallo contando las líneas vivas de ${lote.length} registros: ${error.message}`)
      }
      const chunk = (data ?? []) as unknown as { log_id: string }[]
      for (const l of chunk) cuentas.set(l.log_id, (cuentas.get(l.log_id) ?? 0) + 1)
      if (chunk.length < PAGE_SIZE) break
    }
  }
  return cuentas
}
