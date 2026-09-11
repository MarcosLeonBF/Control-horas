// Último nivel conocido de cada banco y cada HUCHA (avisos_estado): sin él no se sabe
// si un nivel "empeoró". Se lee entero por prefijo; son pocos cientos de filas.
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { comoNivel, type Nivel } from '@/lib/avisos/reglas'

export async function leerEstados(db: SupabaseClient, prefijo: 'banco:' | 'hucha:'): Promise<Map<string, Nivel>> {
  const filas = await fetchAllRows<{ clave: string; nivel: string }>((desde, hasta) =>
    db.from('avisos_estado').select('clave, nivel').like('clave', `${prefijo}%`).range(desde, hasta))
  const out = new Map<string, Nivel>()
  for (const f of filas) {
    const n = comoNivel(f.nivel)
    if (n) out.set(f.clave, n)
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
