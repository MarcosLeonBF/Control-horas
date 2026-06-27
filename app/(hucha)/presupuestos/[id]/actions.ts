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

export async function ampliarPresupuesto(
  projectId: string,
  input: { monto: number; motivo: string; referencia: string; fecha: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isFinite(input.monto) || input.monto <= 0) return { ok: false, error: 'El monto debe ser mayor a 0.' }
  if (!input.motivo.trim()) return { ok: false, error: 'El motivo es obligatorio.' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('registrar_movimiento_hucha', {
    p_project_id: projectId,
    p_type: 'ampliacion',
    p_amount: input.monto,
    p_reason: input.motivo.trim(),
    p_reference: input.referencia.trim() || null,
    p_entry_date: input.fecha || undefined,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/presupuestos/${projectId}`)
  revalidatePath('/presupuestos')
  return { ok: true }
}

export async function anularMovimiento(
  projectId: string, movementId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('registrar_movimiento_hucha', {
    p_project_id: projectId,
    p_type: 'anulacion',
    p_amount: 1, // la RPC deriva el efecto real del movimiento original; sólo cumple la validación > 0
    p_corrects_movement_id: movementId,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/presupuestos/${projectId}`)
  revalidatePath('/presupuestos')
  return { ok: true }
}
