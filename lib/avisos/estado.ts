// Último nivel conocido de cada banco y cada HUCHA (avisos_estado): sin él no se sabe
// si un nivel "empeoró". Se lee entero por prefijo; son pocos cientos de filas.
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { comoNivel, type Nivel } from '@/lib/avisos/reglas'

// `desde` es el updated_at de la fila, que solo cambia cuando cambia el nivel: identifica
// la transición. Los detectores lo meten en la clave de dedupe para que dos evaluaciones
// a la vez compartan clave y, tras un rearme, la siguiente caída traiga una clave nueva.
export async function leerEstados(
  db: SupabaseClient, prefijo: 'banco:' | 'hucha:',
): Promise<Map<string, { nivel: Nivel; desde: string }>> {
  const filas = await fetchAllRows<{ clave: string; nivel: string; updated_at: string }>((desde, hasta) =>
    db.from('avisos_estado').select('clave, nivel, updated_at').like('clave', `${prefijo}%`).range(desde, hasta))
  const out = new Map<string, { nivel: Nivel; desde: string }>()
  for (const f of filas) {
    const n = comoNivel(f.nivel)
    if (n) out.set(f.clave, { nivel: n, desde: f.updated_at })
  }
  return out
}

export async function guardarEstados(db: SupabaseClient, filas: { clave: string; nivel: Nivel }[]): Promise<void> {
  if (!filas.length) return
  const ahora = new Date().toISOString()
  const { error } = await db.from('avisos_estado')
    .upsert(filas.map((f) => ({ ...f, updated_at: ahora })), { onConflict: 'clave' })
  if (error) throw new Error(`avisos_estado: ${error.message}`)
}
