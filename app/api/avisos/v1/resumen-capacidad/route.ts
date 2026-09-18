// GET /api/avisos/v1/resumen-capacidad — para el resumen quincenal del flujo de Julián.
// Trae TODOS los proyectos activos en cada lista: no hay `top` (desde 2026-09-18; si una
// llamada lo sigue pasando, se ignora). Igual que resumen-hucha.
// `proxy.ts` excluye /api de la sesión: la ruta se autentica con su propia clave.
import { autorizado } from '@/lib/avisos/auth'
import { resumenCapacidad } from '@/lib/avisos/consultas'

export const maxDuration = 60

export async function GET(req: Request) {
  if (!autorizado(req, process.env.AVISOS_API_KEY)) return Response.json({ error: 'No autorizado' }, { status: 401 })
  try {
    return Response.json(await resumenCapacidad(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[avisos] resumen-capacidad:', e instanceof Error ? e.message : e)
    // El detalle se queda en el log: hacia fuera no se enseñan mensajes internos (tablas, Graph…).
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}
