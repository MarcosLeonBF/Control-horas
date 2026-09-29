// POST /api/avisos/v1/vacaciones — una fila de vacaciones de Airtable por envío (flujo de
// Julián). Misma clave que las consultas. Qué se acepta y qué se contesta lo decide
// procesarEnvio (lib/avisos/vacaciones.ts); aquí solo se autentica, se leen los perfiles y
// se guarda. La misma fila de Airtable dos veces actualiza, no duplica.
//
// Todo envío con la clave correcta, aceptado o no, se anota en `avisos_entrantes` (0053)
// para verlo en Administración → Avisos → Recibidos.
import { after } from 'next/server'
import { autorizado } from '@/lib/avisos/auth'
import { anotacionEntrante } from '@/lib/avisos/entrantes'
import {
  procesarEnvio, validarVacacion, type EnvioAceptado, type EnvioRechazado, type PerfilIdentificable,
} from '@/lib/avisos/vacaciones'
import { createAdminClient } from '@/lib/supabase/admin'

const PLAZO_MS = 5_000 // cada operación de la anotación: sin plazo, una base colgada la dejaría viva
const RETENCION_DIAS = 90

interface PerfilRaw { id: string; full_name: string | null; email: string | null; slack_id: string | null }

export async function POST(req: Request) {
  // Sin clave no se anota nada: cualquiera podría llenar la tabla.
  if (!autorizado(req, process.env.AVISOS_API_KEY)) return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 })
  // El cliente se crea al usarlo y siempre dentro de un try: sin variables de entorno
  // lanza, y eso tiene que acabar en un 500 con cuerpo, no en el error genérico de Next.
  let db: ReturnType<typeof createAdminClient> | null = null
  const cliente = () => (db ??= createAdminClient())

  // Contesta y anota el envío DESPUÉS de responder: quien llama no espera a la base, y si
  // la base tarda o falla no le afecta (el registro es para mirar, no puede tumbar la
  // entrada). `interno` es el detalle de un 500: se guarda para el admin, no se contesta.
  function contestar(
    status: number,
    respuesta: EnvioAceptado | EnvioRechazado,
    recibido: { cuerpo?: unknown; crudo?: string; interno?: string },
  ) {
    after(async () => {
      try {
        const fila = anotacionEntrante('vacaciones', { status, respuesta, ...recibido })
        const tabla = () => cliente().from('avisos_entrantes')
        let { error } = await tabla().insert(fila).abortSignal(AbortSignal.timeout(PLAZO_MS))
        // Hay cuerpos que Postgres no admite (un \u0000 en un texto): al menos, la fila.
        if (error) {
          const aviso = `No se pudo guardar lo recibido: ${error.message}`.slice(0, 2000)
          ;({ error } = await tabla().insert({ ...fila, cuerpo: null, cuerpo_texto: aviso }).abortSignal(AbortSignal.timeout(PLAZO_MS)))
        }
        if (error) console.error('[avisos] vacaciones: no se pudo anotar el envío:', error.message)
        // Lo recibido puede traer campos de Airtable que no pedimos: se guarda 90 días.
        const limite = new Date(Date.now() - RETENCION_DIAS * 86_400_000).toISOString()
        await tabla().delete().lt('created_at', limite).abortSignal(AbortSignal.timeout(PLAZO_MS))
      } catch (e) {
        console.error('[avisos] vacaciones: no se pudo anotar el envío:', e instanceof Error ? e.message : e)
      }
    })
    return Response.json(respuesta, { status, headers: { 'Cache-Control': 'no-store' } })
  }

  // Como texto primero: si no es JSON, se guarda lo que llegó para poder verlo.
  let crudo: string
  try {
    crudo = await req.text()
  } catch {
    return contestar(400, { ok: false, error: 'No se pudo leer el cuerpo.' }, {})
  }
  let body: unknown
  try {
    body = JSON.parse(crudo)
  } catch {
    return contestar(400, { ok: false, error: 'El cuerpo no es un JSON válido.' }, { crudo })
  }
  // Antes de leer los perfiles: una fila mal formada es un 400 aunque la base falle.
  const v = validarVacacion(body)
  if (!v.ok) return contestar(400, { ok: false, error: v.error }, { cuerpo: body })

  try {
    // Todos, también los inactivos: la búsqueda es de identidad, y unas vacaciones de
    // alguien dado de baja no hacen daño.
    const db = cliente()
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
    return contestar(r.status, r.respuesta, { cuerpo: body })
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e)
    console.error('[avisos] vacaciones:', detalle)
    // Hacia fuera no se enseñan mensajes internos; el admin los ve en Recibidos.
    return contestar(500, { ok: false, error: 'Error interno' }, { cuerpo: body, interno: `Error interno: ${detalle}` })
  }
}
