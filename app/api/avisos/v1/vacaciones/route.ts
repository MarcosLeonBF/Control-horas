// POST /api/avisos/v1/vacaciones — ausencias por pulsos desde el flujo de Julián: una lista
// de personas, cada una con su slack_id y `activar` (empieza la ausencia) o `desactivar`
// (termina). Misma clave que las consultas. Qué se acepta y qué se hace lo deciden
// validarEnvio y planificar (lib/avisos/vacaciones.ts); aquí solo se autentica, se lee lo
// necesario y se ejecuta.
//
// Todo envío con la clave correcta, aceptado o no, se anota en `avisos_entrantes` (0053)
// para verlo en Administración → Avisos → Recibidos.
import { after } from 'next/server'
import { autorizado } from '@/lib/avisos/auth'
import { anotacionEntrante } from '@/lib/avisos/entrantes'
import {
  planificar, validarEnvio, type AusenciaActual, type EnvioAceptado, type EnvioRechazado, type Operacion,
  type PerfilIdentificable,
} from '@/lib/avisos/vacaciones'
import { diaMadrid } from '@/lib/horas/auditoria-types'
import { createAdminClient } from '@/lib/supabase/admin'

const PLAZO_MS = 5_000 // cada operación de la anotación: sin plazo, una base colgada la dejaría viva
const RETENCION_DIAS = 90

type Db = ReturnType<typeof createAdminClient>
interface PerfilRaw { id: string; full_name: string | null; slack_id: string | null }

// Primero los cambios y después las altas: una persona que en el mismo envío termina una
// ausencia abierta y empieza otra no puede tener dos abiertas ni un momento (índice único
// de una abierta por persona). Si dos envíos a la vez dan de alta el mismo periodo, el
// índice persona + día de inicio (0055) hace fallar al segundo con un 500; el flujo reintenta
// y ya ve la fila.
async function ejecutar(db: Db, operaciones: Operacion[]): Promise<void> {
  const ahora = new Date().toISOString()
  for (const o of operaciones) {
    if (o.op !== 'cambio') continue
    const cambio: Record<string, unknown> = { updated_at: ahora }
    if (o.hasta !== undefined) cambio.hasta = o.hasta
    if (o.eventos !== undefined) cambio.eventos = o.eventos
    const { error } = await db.from('vacaciones').update(cambio).eq('id', o.id)
    if (error) throw new Error(`vacaciones (cambio): ${error.message}`)
  }
  const altas = operaciones.flatMap((o) =>
    o.op === 'alta' ? [{ slack_id: o.slack_id, desde: o.desde, hasta: o.hasta, eventos: o.eventos }] : [])
  if (altas.length) {
    const { error } = await db.from('vacaciones').insert(altas)
    if (error) throw new Error(`vacaciones (alta): ${error.message}`)
  }
}

export async function POST(req: Request) {
  // Sin clave no se anota nada: cualquiera podría llenar la tabla.
  if (!autorizado(req, process.env.AVISOS_API_KEY)) return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 })
  // El cliente se crea al usarlo y siempre dentro de un try: sin variables de entorno
  // lanza, y eso tiene que acabar en un 500 con cuerpo, no en el error genérico de Next.
  let db: Db | null = null
  const cliente = () => (db ??= createAdminClient())

  // Contesta y anota el envío DESPUÉS de responder: quien llama no espera a la base, y si
  // la base tarda o falla no le afecta (el registro es para mirar, no puede tumbar la
  // entrada). `interno` es el detalle de un 500: se guarda para el admin, no se contesta.
  function contestar(
    status: number,
    respuesta: EnvioAceptado | EnvioRechazado,
    recibido: { cuerpo?: unknown; crudo?: string; interno?: string; resumen?: string },
  ) {
    after(async () => {
      try {
        const fila = anotacionEntrante('vacaciones', { status, error: respuesta.ok ? null : respuesta.error, ...recibido })
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
  // Antes de ir a la base: un envío mal formado es un 400 aunque la base falle.
  const v = validarEnvio(body)
  if (!v.ok) return contestar(400, v, { cuerpo: body })

  try {
    const db = cliente()
    const hoy = diaMadrid(new Date().toISOString())
    // Todas las ausencias de las personas del envío (son pocas por persona): un pulso con
    // fechas puede apuntar a un periodo de hace días, y hay que encontrar su fila.
    const slacks = [...new Set(v.valor.map((x) => x.slack_id))]
    const [perfiles, actuales] = await Promise.all([
      db.from('profiles').select('id, full_name, slack_id').not('slack_id', 'is', null),
      db.from('vacaciones').select('id, slack_id, desde, hasta, eventos').in('slack_id', slacks),
    ])
    if (perfiles.error) throw new Error(`profiles: ${perfiles.error.message}`)
    if (actuales.error) throw new Error(`vacaciones: ${actuales.error.message}`)

    const plan = planificar(
      v.valor,
      ((perfiles.data ?? []) as PerfilRaw[]).map((p): PerfilIdentificable => ({ id: p.id, nombre: p.full_name ?? '', slack_id: p.slack_id })),
      (actuales.data ?? []) as AusenciaActual[],
      hoy,
    )
    await ejecutar(db, plan.operaciones)
    return contestar(200, plan.respuesta, { cuerpo: body, resumen: plan.resumen })
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e)
    console.error('[avisos] vacaciones:', detalle)
    // Hacia fuera no se enseñan mensajes internos; el admin los ve en Recibidos.
    return contestar(500, { ok: false, error: 'Error interno' }, { cuerpo: body, interno: `Error interno: ${detalle}` })
  }
}
