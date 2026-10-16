// GET y PUT /api/hub/usuarios/{id} — la ficha de Control de Rentabilidad de una persona, para
// Acceso. {id} es el `sub` de Acceso (= id de auth.users). Ver lib/hub/conector.ts.
import { errorInterno, guardarFicha, leerFicha, rechazoConector } from '@/lib/hub/conector'
import { esUuid } from '@/lib/hub/ficha'
import { createAdminClient } from '@/lib/supabase/admin'

type Contexto = { params: Promise<{ id: string }> }

// 200 { activo, datos } o 404 si no tiene ficha.
export async function GET(req: Request, { params }: Contexto) {
  const rechazo = rechazoConector(req)
  if (rechazo) return rechazo
  const { id } = await params
  if (!esUuid(id)) return new Response(null, { status: 404 })
  try {
    const ficha = await leerFicha(createAdminClient(), id)
    return ficha ? Response.json(ficha) : new Response(null, { status: 404 })
  } catch (e) {
    return errorInterno(e)
  }
}

// { email, nombre, activo, datos } → 200 { activo, datos } (lo guardado) o 422 { errores }.
export async function PUT(req: Request, { params }: Contexto) {
  const rechazo = rechazoConector(req)
  if (rechazo) return rechazo
  const { id } = await params
  if (!esUuid(id)) return Response.json({ errores: { id: 'El identificador no es válido.' } }, { status: 422 })

  let cuerpo: unknown
  try {
    cuerpo = await req.json()
  } catch {
    return Response.json({ errores: { cuerpo: 'El cuerpo no es JSON válido.' } }, { status: 422 })
  }

  try {
    const r = await guardarFicha(createAdminClient(), id, cuerpo)
    return r.ok ? Response.json(r.ficha) : Response.json({ errores: r.errores }, { status: 422 })
  } catch (e) {
    return errorInterno(e)
  }
}
