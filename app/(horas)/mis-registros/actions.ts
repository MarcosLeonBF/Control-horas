'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function anularRegistro(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('anular_registro_diario', { p_log_id: id })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/mis-registros')
  return { ok: true }
}
