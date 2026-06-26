'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchHuchaExcel } from '@/lib/hucha/excel'
import { aplicarSync, type SyncReport } from '@/lib/hucha/sync'

export async function sincronizarHucha(): Promise<{ ok: true; report: SyncReport } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado.' }
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') return { ok: false, error: 'Solo un administrador puede sincronizar.' }

  try {
    const data = await fetchHuchaExcel()
    const report = await aplicarSync(data, createAdminClient())
    revalidatePath('/presupuestos')
    return { ok: true, report }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error desconocido en la sincronización.' }
  }
}
