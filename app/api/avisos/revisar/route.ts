// POST /api/avisos/revisar — la llama cada minuto la tarea avisos-revisar de Supabase
// (pg_cron + pg_net, migración 0061), y solo cuando hay algo vencido: esperas de los avisos
// de registro o reintentos de la bandeja. Contesta enseguida (pg_net no espera la respuesta)
// y trabaja después. Misma clave que el cron diario: CRON_SECRET.
import { after } from 'next/server'
import { autorizado } from '@/lib/avisos/auth'
import { esProduccion } from '@/lib/avisos/entorno'
import { revisarPendientes } from '@/lib/avisos/revisiones'
import { despacharPendientes } from '@/lib/avisos/bandeja'

export const maxDuration = 60

export async function POST(req: Request) {
  if (!autorizado(req, process.env.CRON_SECRET)) return Response.json({ error: 'No autorizado' }, { status: 401 })
  if (!esProduccion()) return Response.json({ ok: true, omitido: 'fuera de producción' })
  after(async () => {
    // Plazos por debajo de maxDuration: lo que no dé tiempo vuelve a la cola sin gastar intento.
    try { await revisarPendientes(20, 25_000) } catch (e) { console.error('[avisos] revisar:', e instanceof Error ? e.message : e) }
    try { await despacharPendientes(50, 25_000) } catch (e) { console.error('[avisos] despacho:', e instanceof Error ? e.message : e) }
  })
  return Response.json({ ok: true }, { status: 202 })
}
