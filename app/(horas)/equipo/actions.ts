'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

// Anular un registro desde /equipo. El RPC anular_registro_diario (migración 0017) valida
// que solo el admin pueda anular ajenos y escribe la auditoría 'anular'.
export async function anularRegistroEquipo(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('anular_registro_diario', { p_log_id: id })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/equipo')
  return { ok: true }
}
