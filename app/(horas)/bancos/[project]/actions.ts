'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

type Result = { ok: true } | { ok: false; error: string }

export async function ampliarHoras(
  project: string,
  input: { hours: number; reason: string; entry_date: string },
): Promise<Result> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('ampliar_horas', {
    p_project: project,
    p_hours: input.hours,
    p_reason: input.reason,
    p_entry_date: input.entry_date,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/bancos/${encodeURIComponent(project)}`)
  revalidatePath('/bancos')
  return { ok: true }
}

export async function anularAmpliacionHoras(id: string, project: string): Promise<Result> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('anular_ampliacion_horas', { p_id: id })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/bancos/${encodeURIComponent(project)}`)
  revalidatePath('/bancos')
  return { ok: true }
}
