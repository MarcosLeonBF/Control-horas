import { createClient } from '@/lib/supabase/server'
import type { AuditAction, AuditDateBase, AuditEntry, AuditSnapshotLine } from '@/lib/horas/auditoria-types'
import { addDiasISO, inicioDiaMadridUTC } from '@/lib/horas/auditoria-types'

// Tope duro de filas por carga. A ~660 asientos al mes son unos 7 meses de holgura;
// pasado eso la pantalla lo dice y pide acotar, en vez de truncar en silencio como
// hacía el limit(200) anterior.
export const AUDIT_MAX_ROWS = 5000

// PostgREST devuelve como mucho 1.000 filas por petición: hay que paginar.
const PAGE_SIZE = 1000

interface RawAudit {
  id: string
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

const COLS = 'id, action, actor_id, actor_name, subject_name, entry_date, total_hours, at, lines_before, lines_after'

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
    return acotada.order('at', { ascending: false }).range(desde, hasta)
  }

  // Se pide una fila de más que el tope: si aparece, es que el rango no cabe.
  const raw: RawAudit[] = []
  for (let desde = 0; desde <= AUDIT_MAX_ROWS; desde += PAGE_SIZE) {
    const { data } = await pagina(desde, Math.min(desde + PAGE_SIZE - 1, AUDIT_MAX_ROWS))
    const chunk = (data ?? []) as unknown as RawAudit[]
    raw.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
  }

  const truncado = raw.length > AUDIT_MAX_ROWS
  const entries: AuditEntry[] = raw.slice(0, AUDIT_MAX_ROWS).map((r) => ({
    id: r.id,
    action: r.action,
    actorId: r.actor_id,
    actorName: r.actor_name ?? '—',
    subjectName: r.subject_name ?? '—',
    entryDate: r.entry_date,
    totalHours: r.total_hours == null ? null : Number(r.total_hours),
    at: r.at,
    before: r.lines_before,
    after: r.lines_after,
  }))

  return { entries, truncado }
}
