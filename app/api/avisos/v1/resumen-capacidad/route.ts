// GET /api/avisos/v1/resumen-capacidad?top=10 — para el resumen quincenal del flujo de Julián.
// `proxy.ts` excluye /api de la sesión: la ruta se autentica con su propia clave.
import { autorizado } from '@/lib/avisos/auth'
import { resumenCapacidad } from '@/lib/avisos/consultas'

export const maxDuration = 60

export async function GET(req: Request) {
  if (!autorizado(req, process.env.AVISOS_API_KEY)) return Response.json({ error: 'No autorizado' }, { status: 401 })
  const n = Number(new URL(req.url).searchParams.get('top') ?? '10')
  const top = Number.isInteger(n) ? Math.min(Math.max(n, 1), 50) : 10
  try {
    return Response.json(await resumenCapacidad(top), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[avisos] resumen-capacidad:', e instanceof Error ? e.message : e)
    return Response.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 })
  }
}
