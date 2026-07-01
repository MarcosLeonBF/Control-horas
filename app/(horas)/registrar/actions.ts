'use server'
import { createClient } from '@/lib/supabase/server'
import { checkHorasAlertas } from '@/lib/horas/alertas'
import { getMyPositionEtapaIds } from '@/lib/horas/queries'

export interface LineInput {
  entry_date: string; project: string; area_id: string; department: string; etapa_id: string; hours: number; description: string
}

export async function guardarRegistro(
  lines: LineInput[], logId: string | null = null
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!lines.length) return { ok: false, error: 'Agregá al menos una línea.' }
  const supabase = await createClient()

  // Refuerzo: en proyecto cliente la etapa debe ser de la posición del usuario.
  // El admin queda exento (igual que ve todas las áreas/etapas al registrar).
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado.' }
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') {
    const allowed = new Set(await getMyPositionEtapaIds(user.id))
    const bad = lines.some((l) => l.project !== 'Departamento' && l.etapa_id && !allowed.has(l.etapa_id))
    if (bad) return { ok: false, error: 'Etapa no permitida para tu posición.' }
  }
  // El RPC agrupa las líneas por su entry_date y reparte en los logs diarios
  // (alta: un log por fecha; edición: reutiliza el ancla y divide en varios días).
  const { data, error } = await supabase.rpc('guardar_registro', {
    p_anchor_log_id: logId, p_lines: lines,
  })
  if (error) return { ok: false, error: error.message }
  // Alertas de banco al 80/100/exceso (no rompen el guardado).
  await checkHorasAlertas(lines.map((l) => l.project))
  return { ok: true, id: data as string }
}
