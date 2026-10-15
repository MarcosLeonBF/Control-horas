// GET /api/hub/esquema — los campos de la ficha de Control de Gestión que Acceso pinta al dar
// de alta o editar a una persona, con las opciones vivas de la app. Ver lib/hub/conector.ts.
import { errorInterno, opcionesVivas, rechazoConector } from '@/lib/hub/conector'
import { construirEsquema } from '@/lib/hub/ficha'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: Request) {
  const rechazo = rechazoConector(req)
  if (rechazo) return rechazo
  try {
    return Response.json(construirEsquema(await opcionesVivas(createAdminClient())))
  } catch (e) {
    return errorInterno(e)
  }
}
