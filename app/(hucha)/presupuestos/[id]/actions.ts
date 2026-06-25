'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function registrarConsumo(
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  const projectId = String(formData.get('project_id') ?? '')
  const amount = Number(formData.get('amount'))
  const description = String(formData.get('description') ?? '').trim()
  const entryDate = String(formData.get('entry_date') ?? '')

  if (!projectId) return { ok: false, error: 'Proyecto inválido.' }
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'El importe debe ser mayor a 0.' }
  if (!description) return { ok: false, error: 'La descripción es obligatoria.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('registrar_movimiento_hucha', {
    p_project_id: projectId,
    p_type: 'consumo',
    p_amount: amount,
    p_description: description,
    p_entry_date: entryDate || undefined,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/presupuestos/${projectId}`)
  revalidatePath('/presupuestos')
  return { ok: true }
}
