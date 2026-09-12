// GET /api/avisos/cron — revisión diaria (vercel.json). Detecta lo que cambia sin que nadie
// registre (cierre de mes, Excel) y reintenta la cola. Vercel manda el CRON_SECRET solo.
import { autorizado } from '@/lib/avisos/auth'
import { esProduccion } from '@/lib/avisos/entorno'
import { evaluarBancos } from '@/lib/avisos/detector-bancos'
import { evaluarHucha } from '@/lib/avisos/detector-hucha'
import { despacharPendientes } from '@/lib/avisos/bandeja'

export const maxDuration = 60

export async function GET(req: Request) {
  if (!autorizado(req, process.env.CRON_SECRET)) return Response.json({ error: 'No autorizado' }, { status: 401 })
  if (!esProduccion()) return Response.json({ ok: true, omitido: 'fuera de producción' })
  await evaluarBancos() // nunca lanzan
  await evaluarHucha()
  try {
    // Plazo por debajo de maxDuration: lo que no dé tiempo vuelve a la cola sin gastar intento.
    return Response.json({ ok: true, despacho: await despacharPendientes(100, 45_000) })
  } catch (e) {
    console.error('[avisos] cron despacho:', e instanceof Error ? e.message : e)
    // El detalle se queda en el log: hacia fuera no se enseñan mensajes internos.
    return Response.json({ ok: false, error: 'Error interno' }, { status: 500 })
  }
}
