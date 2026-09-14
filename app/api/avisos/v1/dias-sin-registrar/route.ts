// GET /api/avisos/v1/dias-sin-registrar?fecha=YYYY-MM-DD — para la escalera de recordatorios.
// Sin fecha, hoy en Madrid (el reloj del servidor va en UTC). Una fecha futura da 400.
import { autorizado } from '@/lib/avisos/auth'
import { fechaDeConsulta } from '@/lib/avisos/calendario'
import { diasSinRegistrarDe } from '@/lib/avisos/consultas'
import { diaMadrid } from '@/lib/horas/auditoria-types'

export const maxDuration = 60

export async function GET(req: Request) {
  if (!autorizado(req, process.env.AVISOS_API_KEY)) return Response.json({ error: 'No autorizado' }, { status: 401 })
  const pedida = fechaDeConsulta(new URL(req.url).searchParams.get('fecha'), diaMadrid(new Date().toISOString()))
  if ('error' in pedida) return Response.json({ error: pedida.error }, { status: 400 })
  const { fecha } = pedida
  try {
    return Response.json(await diasSinRegistrarDe(fecha), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[avisos] dias-sin-registrar:', e instanceof Error ? e.message : e)
    // El detalle se queda en el log: hacia fuera no se enseñan mensajes internos (tablas, Graph…).
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}
