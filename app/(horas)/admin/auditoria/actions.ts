'use server'
import { createClient } from '@/lib/supabase/server'
import type { AuditAction, AuditDetalle, AuditSnapshotLine } from '@/lib/horas/auditoria-types'

export type AuditDetalleResult = { ok: true; detalle: AuditDetalle } | { ok: false; error: string }

// Fila cruda de time_log_lines con área y etapa embebidas. supabase-js tipa las
// relaciones de forma laxa; se normaliza a AuditSnapshotLine al salir.
interface RawLinea {
  project: string
  department: string | null
  hours: number | string
  description: string | null
  areas: { name: string } | null
  etapas: { name: string } | null
}

// Detalle de UN asiento, a demanda. La lista no lleva snapshots (pesaban ~609 bytes
// por columna y casi ninguna fila se despliega), así que el "qué cambió" se pide aquí
// al abrir la fila.
export async function getAuditDetalle(auditId: string): Promise<AuditDetalleResult> {
  const supabase = await createClient()

  // Una server action es un endpoint público: el `redirect` de la página no la
  // protege. El rol se revalida en cada llamada.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado.' }
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') return { ok: false, error: 'Solo un administrador puede ver la auditoría.' }

  const { data: asiento, error } = await supabase
    .from('time_log_audit')
    .select('id, log_id, action, lines_before, lines_after')
    .eq('id', auditId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!asiento) return { ok: false, error: 'El movimiento ya no existe.' }

  // Asiento posterior a 0041: los snapshots son la verdad guardada.
  if (asiento.lines_before !== null || asiento.lines_after !== null) {
    return {
      ok: true,
      detalle: {
        tipo: 'snapshot',
        before: asiento.lines_before as AuditSnapshotLine[] | null,
        after: asiento.lines_after as AuditSnapshotLine[] | null,
      },
    }
  }

  // Sin snapshots. Solo se puede reconstruir si el registro sigue existiendo (log_id
  // es `on delete set null`) y este es su ÚLTIMO movimiento: entonces las líneas vivas
  // son exactamente lo que dejó. Con movimientos posteriores, no.
  if (!asiento.log_id) return { ok: true, detalle: { tipo: 'sin-detalle' } }

  const { data: ultimo, error: errUltimo } = await supabase
    .from('time_log_audit')
    .select('id')
    .eq('log_id', asiento.log_id)
    .order('at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (errUltimo) return { ok: false, error: errUltimo.message }
  if (ultimo?.id !== auditId) return { ok: true, detalle: { tipo: 'sin-detalle' } }

  // Mismo orden que el snapshot del RPC (audit_snapshot_lineas): proyecto, descripción.
  const { data: lineas, error: errLineas } = await supabase
    .from('time_log_lines')
    .select('project, department, hours, description, areas(name), etapas(name)')
    .eq('log_id', asiento.log_id)
    .order('project')
    .order('description')
  if (errLineas) return { ok: false, error: errLineas.message }
  // Sin líneas vivas no hay nada que enseñar: mejor decirlo que pintar una lista vacía.
  if (!lineas?.length) return { ok: true, detalle: { tipo: 'sin-detalle' } }

  return {
    ok: true,
    detalle: {
      tipo: 'reconstruido',
      action: asiento.action as AuditAction,
      lineas: (lineas as unknown as RawLinea[]).map((l) => ({
        project: l.project,
        area: l.areas?.name ?? '—',
        department: l.department ?? '—',
        etapa: l.etapas?.name ?? '—',
        hours: Number(l.hours),
        description: l.description ?? '',
      })),
    },
  }
}
