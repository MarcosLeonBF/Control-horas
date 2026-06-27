import { createClient } from '@/lib/supabase/server'
import type { ProjectWithBank, HuchaBankRow, HuchaMovementRow } from './types'

export async function getMyProjectsWithBanks(): Promise<ProjectWithBank[]> {
  const supabase = await createClient()
  // RLS limita a proyectos asignados (manager) o todos (admin)
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, client, hucha_banks!inner(id, project_id, currency, assigned_total, consumed_total, remaining, status)')
    .eq('status', 'activo')
    .order('name')
  if (error) throw error
  return (data ?? []).map((p) => ({
    id: p.id, name: p.name, client: p.client,
    bank: (Array.isArray(p.hucha_banks) ? p.hucha_banks[0] : p.hucha_banks) as HuchaBankRow,
  }))
}

export async function getProjectWithBank(id: string): Promise<ProjectWithBank | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, client, hucha_banks!inner(id, project_id, currency, assigned_total, consumed_total, remaining, status)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    id: data.id, name: data.name, client: data.client,
    bank: (Array.isArray(data.hucha_banks) ? data.hucha_banks[0] : data.hucha_banks) as HuchaBankRow,
  }
}

export async function getMovements(bankId: string): Promise<HuchaMovementRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('hucha_movements')
    .select('id, type, amount, balance_before, balance_after, description, reference, reason, actor_name, entry_date, created_at, corrects_movement_id')
    .eq('bank_id', bankId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as HuchaMovementRow[]
}
