'use server'
import { createClient } from '@/lib/supabase/server'

type Result = { ok: true } | { ok: false; error: string }

// Gestión de catálogos (PDF §19 Fase 3): áreas y etapas. Solo admin.
// La escritura va por RLS (areas_admin_write / etapas_admin_write), así que basta
// el cliente autenticado; igual validamos el rol para dar un error claro.
async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, error: 'No autenticado.' as const }
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') return { supabase, error: 'Solo un administrador puede gestionar catálogos.' as const }
  return { supabase, error: null }
}

function friendly(error: { message: string; code?: string }) {
  if (error.code === '23505') return 'Ya existe un registro con ese nombre.'
  return error.message
}

// ── Áreas ────────────────────────────────────────────────────────────────
export async function crearArea(name: string): Promise<Result> {
  const { supabase, error } = await requireAdmin()
  if (error) return { ok: false, error }
  const n = name.trim()
  if (!n) return { ok: false, error: 'El nombre es obligatorio.' }
  const { error: e } = await supabase.from('areas').insert({ name: n })
  if (e) return { ok: false, error: friendly(e) }
  return { ok: true }
}

export async function renombrarArea(id: string, name: string): Promise<Result> {
  const { supabase, error } = await requireAdmin()
  if (error) return { ok: false, error }
  const n = name.trim()
  if (!n) return { ok: false, error: 'El nombre es obligatorio.' }
  // El área interna (proyecto especial "Departamento") no se renombra: la usa el RPC.
  const { data: a } = await supabase.from('areas').select('is_internal').eq('id', id).single()
  if (a?.is_internal) return { ok: false, error: 'El área interna no se puede modificar.' }
  const { error: e } = await supabase.from('areas').update({ name: n, updated_at: new Date().toISOString() }).eq('id', id)
  if (e) return { ok: false, error: friendly(e) }
  return { ok: true }
}

export async function toggleArea(id: string, active: boolean): Promise<Result> {
  const { supabase, error } = await requireAdmin()
  if (error) return { ok: false, error }
  const { data: a } = await supabase.from('areas').select('is_internal').eq('id', id).single()
  if (a?.is_internal) return { ok: false, error: 'El área interna no se puede desactivar.' }
  const { error: e } = await supabase.from('areas').update({ active, updated_at: new Date().toISOString() }).eq('id', id)
  if (e) return { ok: false, error: friendly(e) }
  return { ok: true }
}

// ── Etapas ───────────────────────────────────────────────────────────────
export async function crearEtapa(name: string): Promise<Result> {
  const { supabase, error } = await requireAdmin()
  if (error) return { ok: false, error }
  const n = name.trim()
  if (!n) return { ok: false, error: 'El nombre es obligatorio.' }
  const { error: e } = await supabase.from('etapas').insert({ name: n })
  if (e) return { ok: false, error: friendly(e) }
  return { ok: true }
}

export async function renombrarEtapa(id: string, name: string): Promise<Result> {
  const { supabase, error } = await requireAdmin()
  if (error) return { ok: false, error }
  const n = name.trim()
  if (!n) return { ok: false, error: 'El nombre es obligatorio.' }
  const { error: e } = await supabase.from('etapas').update({ name: n, updated_at: new Date().toISOString() }).eq('id', id)
  if (e) return { ok: false, error: friendly(e) }
  return { ok: true }
}

export async function toggleEtapa(id: string, active: boolean): Promise<Result> {
  const { supabase, error } = await requireAdmin()
  if (error) return { ok: false, error }
  const { error: e } = await supabase.from('etapas').update({ active, updated_at: new Date().toISOString() }).eq('id', id)
  if (e) return { ok: false, error: friendly(e) }
  return { ok: true }
}

// ── Posiciones ─────────────────────────────────────────────────────────────
// El banco de horas es por posición (columnas del Excel). Cada posición se liga
// a una o más áreas: un manager ve los bancos de las posiciones de sus áreas.
export async function crearPosicion(name: string): Promise<Result> {
  const { supabase, error } = await requireAdmin()
  if (error) return { ok: false, error }
  const n = name.trim()
  if (!n) return { ok: false, error: 'El nombre es obligatorio.' }
  const { error: e } = await supabase.from('positions').insert({ name: n })
  if (e) return { ok: false, error: friendly(e) }
  return { ok: true }
}

export async function renombrarPosicion(id: string, name: string): Promise<Result> {
  const { supabase, error } = await requireAdmin()
  if (error) return { ok: false, error }
  const n = name.trim()
  if (!n) return { ok: false, error: 'El nombre es obligatorio.' }
  const { error: e } = await supabase.from('positions').update({ name: n, updated_at: new Date().toISOString() }).eq('id', id)
  if (e) return { ok: false, error: friendly(e) }
  return { ok: true }
}

export async function togglePosicion(id: string, active: boolean): Promise<Result> {
  const { supabase, error } = await requireAdmin()
  if (error) return { ok: false, error }
  const { error: e } = await supabase.from('positions').update({ active, updated_at: new Date().toISOString() }).eq('id', id)
  if (e) return { ok: false, error: friendly(e) }
  return { ok: true }
}

// Reemplaza las áreas ligadas a una posición.
export async function setPosicionAreas(id: string, areaIds: string[]): Promise<Result> {
  const { supabase, error } = await requireAdmin()
  if (error) return { ok: false, error }
  const { error: delErr } = await supabase.from('position_areas').delete().eq('position_id', id)
  if (delErr) return { ok: false, error: friendly(delErr) }
  if (areaIds.length) {
    const { error: insErr } = await supabase.from('position_areas').insert(areaIds.map((area_id) => ({ position_id: id, area_id })))
    if (insErr) return { ok: false, error: friendly(insErr) }
  }
  return { ok: true }
}

// ── Departamentos ──────────────────────────────────────────────────────────
export async function crearDepartamento(name: string): Promise<Result> {
  const { supabase, error } = await requireAdmin()
  if (error) return { ok: false, error }
  const n = name.trim()
  if (!n) return { ok: false, error: 'El nombre es obligatorio.' }
  const { error: e } = await supabase.from('departamentos').insert({ name: n })
  if (e) return { ok: false, error: friendly(e) }
  return { ok: true }
}

export async function renombrarDepartamento(id: string, name: string): Promise<Result> {
  const { supabase, error } = await requireAdmin()
  if (error) return { ok: false, error }
  const n = name.trim()
  if (!n) return { ok: false, error: 'El nombre es obligatorio.' }
  const { error: e } = await supabase.from('departamentos').update({ name: n, updated_at: new Date().toISOString() }).eq('id', id)
  if (e) return { ok: false, error: friendly(e) }
  return { ok: true }
}

export async function toggleDepartamento(id: string, active: boolean): Promise<Result> {
  const { supabase, error } = await requireAdmin()
  if (error) return { ok: false, error }
  const { error: e } = await supabase.from('departamentos').update({ active, updated_at: new Date().toISOString() }).eq('id', id)
  if (e) return { ok: false, error: friendly(e) }
  return { ok: true }
}

// Reemplaza las etapas ligadas a un departamento.
export async function setDepartamentoEtapas(id: string, etapaIds: string[]): Promise<Result> {
  const { supabase, error } = await requireAdmin()
  if (error) return { ok: false, error }
  const { error: delErr } = await supabase.from('departamento_etapas').delete().eq('departamento_id', id)
  if (delErr) return { ok: false, error: friendly(delErr) }
  if (etapaIds.length) {
    const { error: insErr } = await supabase.from('departamento_etapas').insert(etapaIds.map((etapa_id) => ({ departamento_id: id, etapa_id })))
    if (insErr) return { ok: false, error: friendly(insErr) }
  }
  return { ok: true }
}
