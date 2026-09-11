// GET /api/avisos/v1/dias-sin-registrar?fecha=YYYY-MM-DD — para la escalera de recordatorios.
// Sin fecha, hoy en Madrid (el reloj del servidor va en UTC).
import { autorizado } from '@/lib/avisos/auth'
import { diasSinRegistrarDe } from '@/lib/avisos/consultas'
import { diaMadrid } from '@/lib/horas/auditoria-types'

export const maxDuration = 60

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  if (!autorizado(req, process.env.AVISOS_API_KEY)) return Response.json({ error: 'No autorizado' }, { status: 401 })
  const pedida = new URL(req.url).searchParams.get('fecha')
  if (pedida !== null && !FECHA_ISO.test(pedida)) {
    return Response.json({ error: 'El parámetro fecha tiene que ser YYYY-MM-DD.' }, { status: 400 })
  }
  const fecha = pedida ?? diaMadrid(new Date().toISOString())
  try {
    return Response.json(await diasSinRegistrarDe(fecha), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[avisos] dias-sin-registrar:', e instanceof Error ? e.message : e)
    return Response.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 })
  }
}
