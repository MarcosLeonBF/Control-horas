'use server'

import { createClient } from '@/lib/supabase/server'
import type { ExportRow } from '@/lib/export'

interface RawProject { name: string }
interface RawBank { projects: RawProject | RawProject[] }
interface RawMov {
  amount: number
  description: string | null
  reason: string | null
  reference: string | null
  actor_name: string
  entry_date: string
  hucha_banks: RawBank | RawBank[]
}

// Movimientos (consumos o ampliaciones) de TODOS los proyectos, para descarga (admin).
export async function getMovimientosExport(type: 'consumo' | 'ampliacion'): Promise<ExportRow[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') return []

  const { data, error } = await supabase
    .from('hucha_movements')
    .select('amount, description, reason, reference, actor_name, entry_date, hucha_banks!inner(projects!inner(name))')
    .eq('type', type)
    .order('entry_date', { ascending: false })
  if (error) return []

  const rows = (data ?? []) as unknown as RawMov[]
  return rows.map((m) => {
    const bank = Array.isArray(m.hucha_banks) ? m.hucha_banks[0] : m.hucha_banks
    const proj = Array.isArray(bank.projects) ? bank.projects[0] : bank.projects
    return {
      Proyecto: proj?.name ?? '—',
      Fecha: m.entry_date,
      Monto: Math.abs(Number(m.amount)),
      Detalle: (type === 'consumo' ? m.description : m.reason) ?? '',
      Referencia: m.reference ?? '',
      Por: m.actor_name,
    }
  })
}
