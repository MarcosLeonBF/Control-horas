import { revalidateTag } from 'next/cache'
import { getCachedBancoHoras, BANCO_HORAS_TAG } from '@/lib/graph/client'

// GET /api/banco-horas → devuelve proyectos y horas (cacheado 5 min)
export async function GET() {
  try {
    const data = await getCachedBancoHoras()
    return Response.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[banco-horas]', message)
    return Response.json({ error: message }, { status: 500 })
  }
}

// POST /api/banco-horas → fuerza la relectura del Excel
export async function POST() {
  revalidateTag(BANCO_HORAS_TAG, {})
  try {
    const data = await getCachedBancoHoras()
    return Response.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[banco-horas] refresh', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
