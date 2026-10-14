'use server'
import { createClient } from '@/lib/supabase/server'
import { trasResponder } from '@/lib/avisos/tras-responder'
import { alGuardarRegistro } from '@/lib/avisos/detector-registro'
import { revisarPendientes } from '@/lib/avisos/revisiones'

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
  const id = data as string
  // Avisos (pulso, llamativo y bancos): después de responder se anota una espera de 5 minutos
  // y salen con cómo quedaron los registros. El guardado nunca espera a la red.
  trasResponder(async () => {
    await alGuardarRegistro({ logId: id, anclaId: logId })
    // Segundo reloj: de paso se procesan las esperas de otros que ya vencieron. Normalmente no
    // hay ninguna (el reloj de Supabase las toma al minuto); si ese reloj se para, así salen
    // con el siguiente guardado de cualquiera y no con el cron del día siguiente.
    await revisarPendientes(3, 8_000)
  })
  return { ok: true, id }
}
