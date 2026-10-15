'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCachedProyectosEstado } from '@/lib/graph/client'
import { getViewerScope } from '@/lib/horas/scope'
import { posicionesDelAlcance, type BancosScope } from '@/lib/horas/bancos'
import { esManagerDelProyecto, errorAlAmpliar } from '@/lib/horas/ampliar-permisos'
import { candidatosManager } from '@/lib/horas/candidatos-manager'
import { trasResponder } from '@/lib/avisos/tras-responder'
import { alAmpliarHoras, evaluarBancos } from '@/lib/avisos/detector-bancos'

type Result = { ok: true } | { ok: false; error: string }

// Ampliar horas de una posición (spec 2026-10-15-ampliaciones-por-posicion). Aquí se decide
// quién puede: el admin, o el manager del proyecto según el Excel —dato que la base no
// tiene— en una posición de sus áreas. Por eso ampliar_horas solo la ejecuta el servidor
// (service role, 0062), que le dice quién amplía; la base revalida lo que sí sabe.
export async function ampliarHoras(
  project: string,
  input: { position: string; hours: number; reason: string; entry_date: string },
): Promise<Result> {
  const viewer = await getViewerScope()
  if (!viewer) return { ok: false, error: 'No autenticado.' }
  if (viewer.role !== 'admin' && viewer.role !== 'manager') {
    return { ok: false, error: 'No autorizado: solo un admin o el manager del proyecto amplían horas.' }
  }
  const name = project.trim()
  const position = input.position.trim()
  const scope: BancosScope = viewer.role === 'admin' ? { role: 'admin' } : { role: 'manager', areaIds: viewer.areaIds }

  // null = no se pudo comprobar (Excel o perfiles sin leer): el manager no amplía a ciegas.
  let esManager: boolean | null = false
  if (viewer.role === 'manager') {
    try {
      const meta = (await getCachedProyectosEstado()).find((e) => e.project.trim() === name)
      esManager = esManagerDelProyecto(meta?.manager, viewer.userId, await candidatosManager())
    } catch (e) {
      console.warn(`[bancos] ampliarHoras: no se pudo comprobar el manager de "${name}":`, e instanceof Error ? e.message : e)
      esManager = null
    }
  }

  let posicionesAlcance: string[]
  try {
    posicionesAlcance = await posicionesDelAlcance(scope)
  } catch (e) {
    console.warn('[bancos] ampliarHoras: sin catálogo de posiciones:', e instanceof Error ? e.message : e)
    return { ok: false, error: 'No se pudieron leer las posiciones. Inténtalo en un rato.' }
  }

  const motivo = errorAlAmpliar({ role: viewer.role, esManagerDelProyecto: esManager, position, posicionesAlcance })
  if (motivo) return { ok: false, error: motivo }

  const { data: ampliacionId, error } = await createAdminClient().rpc('ampliar_horas', {
    p_actor: viewer.userId,
    p_project: name,
    p_position: position,
    p_hours: input.hours,
    p_reason: input.reason,
    p_entry_date: input.entry_date,
  })
  if (error) return { ok: false, error: error.message }
  // Avisa de la ampliación (banco.ampliacion) y rearma el banco, que ha mejorado, para
  // avisar otra vez si vuelve a caer. El id que devuelve el RPC es la clave anti-duplicados.
  trasResponder(() => alAmpliarHoras(ampliacionId as string, name))
  revalidatePath(`/bancos/${encodeURIComponent(name)}`)
  revalidatePath('/bancos')
  return { ok: true }
}

// Anular lo decide la base (anular_ampliacion_horas, 0062): el admin, cualquiera; el
// manager, las que hizo él. Va con la sesión del usuario, no con service role.
export async function anularAmpliacionHoras(id: string, project: string): Promise<Result> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('anular_ampliacion_horas', { p_id: id })
  if (error) return { ok: false, error: error.message }
  // Quitar horas puede empeorar el banco: se evalúa (y avisa si toca).
  trasResponder(() => evaluarBancos([project]))
  revalidatePath(`/bancos/${encodeURIComponent(project)}`)
  revalidatePath('/bancos')
  return { ok: true }
}
