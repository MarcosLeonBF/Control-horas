// POST /api/avisos/v1/vacaciones — una fila de vacaciones de Airtable por envío (flujo de
// Julián). Misma clave que las consultas. Qué se acepta y qué se contesta lo decide
// procesarEnvio (lib/avisos/vacaciones.ts); aquí solo se autentica, se leen los perfiles y
// se guarda. La misma fila de Airtable dos veces actualiza, no duplica.
import { autorizado } from '@/lib/avisos/auth'
import { procesarEnvio, validarVacacion, type PerfilIdentificable } from '@/lib/avisos/vacaciones'
import { createAdminClient } from '@/lib/supabase/admin'

interface PerfilRaw { id: string; full_name: string | null; email: string | null; slack_id: string | null }

export async function POST(req: Request) {
  if (!autorizado(req, process.env.AVISOS_API_KEY)) return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'El cuerpo no es un JSON válido.' }, { status: 400 })
  }
  // Antes de ir a la base: una fila mal formada es un 400 aunque Supabase esté caído.
  const v = validarVacacion(body)
  if (!v.ok) return Response.json({ ok: false, error: v.error }, { status: 400 })

  try {
    const db = createAdminClient()
    // Todos, también los inactivos: la búsqueda es de identidad, y unas vacaciones de
    // alguien dado de baja no hacen daño.
    const { data, error } = await db.from('profiles').select('id, full_name, email, slack_id')
    if (error) throw new Error(`profiles: ${error.message}`)
    const perfiles: PerfilIdentificable[] = ((data ?? []) as PerfilRaw[]).map((p) => ({
      id: p.id, nombre: p.full_name ?? '', email: p.email, slack_id: p.slack_id,
    }))

    const r = procesarEnvio(v.valor, perfiles)
    if (r.status === 200) {
      const { error: e } = await db.from('vacaciones')
        .upsert({ ...r.fila, updated_at: new Date().toISOString() }, { onConflict: 'airtable_id' })
      if (e) throw new Error(`vacaciones: ${e.message}`)
    }
    return Response.json(r.respuesta, { status: r.status, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[avisos] vacaciones:', e instanceof Error ? e.message : e)
    // El detalle se queda en el log: hacia fuera no se enseñan mensajes internos.
    return Response.json({ ok: false, error: 'Error interno' }, { status: 500 })
  }
}
