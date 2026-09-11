'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enviarPrueba } from '@/lib/avisos/bandeja'
import { TIPOS_AVISO, type TipoAviso } from '@/lib/avisos/contrato'

type Result = { ok: true } | { ok: false; error: string }

// Id del usuario si es admin; null si no. Las acciones son puertas públicas: validan solas.
async function adminId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return me?.role === 'admin' ? user.id : null
}

// Vacía = no sale ningún aviso (el interruptor general).
export async function guardarUrl(url: string): Promise<Result> {
  const id = await adminId()
  if (!id) return { ok: false, error: 'Solo un administrador puede configurar los avisos.' }
  const limpia = url.trim()
  if (limpia) {
    let u: URL
    try { u = new URL(limpia) } catch { return { ok: false, error: 'La URL no es válida.' } }
    if (u.protocol !== 'https:') return { ok: false, error: 'La URL tiene que empezar por https://.' }
  }
  const { error } = await createAdminClient().from('avisos_config')
    .update({ url: limpia || null, updated_by: id, updated_at: new Date().toISOString() })
    .eq('id', true)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/avisos')
  return { ok: true }
}

export async function activarTipo(tipo: TipoAviso, activo: boolean): Promise<Result> {
  const id = await adminId()
  if (!id) return { ok: false, error: 'Solo un administrador puede configurar los avisos.' }
  if (!TIPOS_AVISO.includes(tipo)) return { ok: false, error: 'Tipo de aviso desconocido.' }
  const db = createAdminClient()
  const { data, error: leer } = await db.from('avisos_config').select('tipos_activos').eq('id', true).single()
  if (leer) return { ok: false, error: leer.message }
  const tipos = new Set<string>((data.tipos_activos as string[] | null) ?? [])
  if (activo) tipos.add(tipo)
  else tipos.delete(tipo)
  const { error } = await db.from('avisos_config')
    .update({ tipos_activos: [...tipos], updated_by: id, updated_at: new Date().toISOString() })
    .eq('id', true)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/avisos')
  return { ok: true }
}

export async function probarAviso(tipo: TipoAviso): Promise<{ ok: boolean; mensaje: string }> {
  if (!(await adminId())) return { ok: false, mensaje: 'Solo un administrador puede enviar pruebas.' }
  if (!TIPOS_AVISO.includes(tipo)) return { ok: false, mensaje: 'Tipo de aviso desconocido.' }
  try {
    const r = await enviarPrueba(tipo)
    revalidatePath('/admin/avisos')
    return r
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : 'No se pudo enviar la prueba.' }
  }
}
