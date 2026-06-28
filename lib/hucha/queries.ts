import { createClient } from '@/lib/supabase/server'
import type { ProjectWithBank, HuchaBankRow, HuchaMovementRow, DashboardRow, HuchaStatus } from './types'

interface RawBank { assigned_total: number; consumed_total: number; remaining: number; status: HuchaStatus }
interface RawProfile { full_name: string | null }
interface RawAssignment { profiles: RawProfile | RawProfile[] | null }
interface RawDashboardProject {
  id: string; name: string; client: string | null
  hucha_banks: RawBank | RawBank[]
  project_assignments: RawAssignment[] | null
}

// Todos los proyectos con su banco y manager(es). El RLS limita a admin (ve todo)
// o manager (sus asignados); la pantalla del dashboard la gatea a admin.
export async function getDashboardRows(): Promise<DashboardRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, client, hucha_banks!inner(assigned_total, consumed_total, remaining, status), project_assignments(profiles(full_name))')
    .eq('status', 'activo')
    .order('name')
  if (error) throw error
  const rows = (data ?? []) as unknown as RawDashboardProject[]
  return rows.map((p) => {
    const bank = Array.isArray(p.hucha_banks) ? p.hucha_banks[0] : p.hucha_banks
    const managers = (p.project_assignments ?? [])
      .map((a) => (Array.isArray(a.profiles) ? a.profiles[0]?.full_name : a.profiles?.full_name))
      .filter((n): n is string => Boolean(n))
    return {
      projectId: p.id, name: p.name, client: p.client, managers,
      assigned: Number(bank.assigned_total), consumed: Number(bank.consumed_total),
      remaining: Number(bank.remaining), status: bank.status,
    }
  })
}

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
