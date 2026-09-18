// GET /api/avisos/v1/resumen-hucha?top=10 — el resumen de capacidad, pero del presupuesto
// de HUCHA en vez del banco de horas. Mismas reglas que resumen-capacidad: misma clave,
// mismo `top` y mismo 500 genérico hacia fuera.
// `proxy.ts` excluye /api de la sesión: la ruta se autentica con su propia clave.
import { autorizado } from '@/lib/avisos/auth'
import { resumenHucha } from '@/lib/avisos/consultas'

export const maxDuration = 60

export async function GET(req: Request) {
  if (!autorizado(req, process.env.AVISOS_API_KEY)) return Response.json({ error: 'No autorizado' }, { status: 401 })
  const n = Number(new URL(req.url).searchParams.get('top') ?? '10')
  const top = Number.isInteger(n) ? Math.min(Math.max(n, 1), 50) : 10
  try {
    return Response.json(await resumenHucha(top), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[avisos] resumen-hucha:', e instanceof Error ? e.message : e)
    // El detalle se queda en el log: hacia fuera no se enseñan mensajes internos (tablas…).
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}
