// Esperas de los avisos de registro (avisos_por_revisar, 0061): reserva las vencidas, las
// procesa una a una y las cierra. La llama la tarea de cada minuto de Supabase a través de
// /api/avisos/revisar y, como red, el cron diario. Solo producción, como la bandeja.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { esProduccion } from '@/lib/avisos/entorno'
import { estadoTrasFallo, MAX_INTENTOS_REVISION } from '@/lib/avisos/reglas'
import { revisarGuardado, type EsperaGuardado } from '@/lib/avisos/detector-registro'

type FilaEspera = EsperaGuardado & { intentos: number }

async function cerrar(db: SupabaseClient, id: string, cambios: Record<string, unknown>): Promise<void> {
  const { error } = await db.from('avisos_por_revisar').update(cambios).eq('id', id)
  if (error) console.error(`[avisos] no se pudo cerrar la espera ${id}:`, error.message)
}

// `plazoMs` acota la tanda, como en despacharPendientes: el intento se cuenta al reservar,
// así que lo que no dé tiempo vuelve a 'pendiente' descontándolo.
export async function revisarPendientes(limite = 20, plazoMs = 25_000): Promise<{ hechas: number; fallidas: number }> {
  if (!esProduccion()) return { hechas: 0, fallidas: 0 }
  const inicio = Date.now()
  const db = createAdminClient()
  const { data, error } = await db.rpc('avisos_reclamar_revisiones', { p_limite: limite })
  if (error) throw new Error(`avisos_reclamar_revisiones: ${error.message}`)
  const filas = (data ?? []) as FilaEspera[]
  let hechas = 0
  let fallidas = 0
  for (const [i, fila] of filas.entries()) {
    if (Date.now() - inicio > plazoMs) {
      await Promise.all(filas.slice(i).map((f) =>
        cerrar(db, f.id, { estado: 'pendiente', intentos: f.intentos - 1, reclamado_at: null })))
      break
    }
    // Rescatada después de cortarse a mitad más veces de las que se reintenta: no se insiste.
    if (fila.intentos > MAX_INTENTOS_REVISION) {
      await cerrar(db, fila.id, { estado: 'fallida', ultimo_error: 'se cortó a mitad en cada intento' })
      fallidas++
      continue
    }
    try {
      await revisarGuardado(fila)
      await cerrar(db, fila.id, { estado: 'hecha', ultimo_error: null })
      hechas++
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e)
      console.error(`[avisos] espera ${fila.id}:`, mensaje)
      const estado = estadoTrasFallo(fila.intentos)
      if (estado === 'fallida') fallidas++
      await cerrar(db, fila.id, { estado, ultimo_error: mensaje.slice(0, 500) })
    }
  }
  return { hechas, fallidas }
}
