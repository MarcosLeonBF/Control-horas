'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { trasResponder } from '@/lib/avisos/tras-responder'
import { alAmpliarHoras, evaluarBancos } from '@/lib/avisos/detector-bancos'

type Result = { ok: true } | { ok: false; error: string }

export async function ampliarHoras(
  project: string,
  input: { hours: number; reason: string; entry_date: string },
): Promise<Result> {
  const supabase = await createClient()
  const { data: ampliacionId, error } = await supabase.rpc('ampliar_horas', {
    p_project: project,
    p_hours: input.hours,
    p_reason: input.reason,
    p_entry_date: input.entry_date,
  })
  if (error) return { ok: false, error: error.message }
  // Avisa de la ampliación (banco.ampliacion) y rearma el banco, que ha mejorado, para
  // avisar otra vez si vuelve a caer. El id que devuelve el RPC es la clave anti-duplicados.
  trasResponder(() => alAmpliarHoras(ampliacionId as string, project))
  revalidatePath(`/bancos/${encodeURIComponent(project)}`)
  revalidatePath('/bancos')
  return { ok: true }
}

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
