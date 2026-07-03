'use server'
import { createClient } from '@/lib/supabase/server'
import { checkHorasAlertas } from '@/lib/horas/alertas'

export interface LineInput {
  entry_date: string; project: string; area_id: string; department: string; etapa_id: string; hours: number; description: string
}

export async function guardarRegistro(
  lines: LineInput[], logId: string | null = null
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!lines.length) return { ok: false, error: 'Agregá al menos una línea.' }
  const supabase = await createClient()

  // Toda la validación de alcance por posición (área, etapa, departamento y descripción)
  // vive en el motor guardar_registro (migración 0024), que la aplica a TODOS los roles,
  // incluido el admin. El RPC agrupa las líneas por su entry_date y reparte en los logs
  // diarios (alta: un log por fecha; edición: reutiliza el ancla y divide en varios días).
  const { data, error } = await supabase.rpc('guardar_registro', {
    p_anchor_log_id: logId, p_lines: lines,
  })
  if (error) return { ok: false, error: error.message }
  // Alertas de banco al 80/100/exceso (no rompen el guardado).
  await checkHorasAlertas(lines.map((l) => l.project))
  return { ok: true, id: data as string }
}
