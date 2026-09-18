// GET /api/avisos/v1/resumen-hucha — el resumen de capacidad, pero del presupuesto de
// HUCHA en vez del banco de horas. Misma clave y mismo 500 genérico hacia fuera que
// resumen-capacidad, pero SIN `top`: trae todos los proyectos activos con HUCHA.
// `proxy.ts` excluye /api de la sesión: la ruta se autentica con su propia clave.
import { autorizado } from '@/lib/avisos/auth'
import { resumenHucha } from '@/lib/avisos/consultas'

export const maxDuration = 60

export async function GET(req: Request) {
  if (!autorizado(req, process.env.AVISOS_API_KEY)) return Response.json({ error: 'No autorizado' }, { status: 401 })
  try {
    return Response.json(await resumenHucha(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[avisos] resumen-hucha:', e instanceof Error ? e.message : e)
    // El detalle se queda en el log: hacia fuera no se enseñan mensajes internos (tablas…).
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}
