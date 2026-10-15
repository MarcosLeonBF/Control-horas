// POST /api/hub/usuarios/{id}/baja — Acceso le quita a una persona el acceso a Control de
// Gestión: ficha inactiva y usuario de Supabase baneado, sin borrar nada. 204 siempre que no
// falle la base (también si no tenía ficha). Ver darDeBaja en lib/hub/conector.ts.
import { darDeBaja, errorInterno, rechazoConector } from '@/lib/hub/conector'
import { esUuid } from '@/lib/hub/ficha'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rechazo = rechazoConector(req)
  if (rechazo) return rechazo
  const { id } = await params
  if (!esUuid(id)) return new Response(null, { status: 404 })
  try {
    await darDeBaja(createAdminClient(), id)
    return new Response(null, { status: 204 })
  } catch (e) {
    return errorInterno(e)
  }
}
