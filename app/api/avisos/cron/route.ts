// GET /api/avisos/cron — revisión diaria (vercel.json). Detecta lo que cambia sin que nadie
// registre (cierre de mes, Excel) y reintenta la cola. Vercel manda el CRON_SECRET solo.
import { autorizado } from '@/lib/avisos/auth'
import { esProduccion } from '@/lib/avisos/entorno'
import { evaluarBancos } from '@/lib/avisos/detector-bancos'
import { evaluarHucha } from '@/lib/avisos/detector-hucha'
import { despacharPendientes } from '@/lib/avisos/bandeja'
import { revisarPendientes } from '@/lib/avisos/revisiones'
import { plazoRestante } from '@/lib/avisos/reglas'

export const maxDuration = 60

export async function GET(req: Request) {
  if (!autorizado(req, process.env.CRON_SECRET)) return Response.json({ error: 'No autorizado' }, { status: 401 })
  if (!esProduccion()) return Response.json({ ok: true, omitido: 'fuera de producción' })
  // Un solo plazo por debajo de maxDuration para todo; lo que no dé tiempo vuelve a la cola
  // sin gastar intento.
  const fin = Date.now() + 55_000
  // Primero, la red del reloj de cada minuto (/api/avisos/revisar): si se paró, las esperas de
  // los avisos de registro salen al menos aquí. Antes que evaluarBancos(), para que la caída de
  // un banco por un registro salga con su `registro` y no con null.
  try { await revisarPendientes(100, 25_000) } catch (e) { console.error('[avisos] cron revisar:', e instanceof Error ? e.message : e) }
  await evaluarBancos() // nunca lanzan
  await evaluarHucha()
  try {
    const resto = plazoRestante(fin)
    return Response.json({ ok: true, despacho: resto > 1_000 ? await despacharPendientes(100, resto) : null })
  } catch (e) {
    console.error('[avisos] cron despacho:', e instanceof Error ? e.message : e)
    // El detalle se queda en el log: hacia fuera no se enseñan mensajes internos.
    return Response.json({ ok: false, error: 'Error interno' }, { status: 500 })
  }
}
