import type { SupabaseClient } from '@supabase/supabase-js'

export interface ExcelProyecto { proyecto: string; hucha: number }
export interface HuchaExcelData { proyectos: ExcelProyecto[]; managerPorProyecto: Map<string, string> }
export interface SyncReport {
  proyectosCreados: number
  proyectosActualizados: number
  managersAsignados: number
  managersNoEncontrados: { proyecto: string; manager: string }[]
  saltadosSinHucha: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function aplicarSync(data: HuchaExcelData, db: SupabaseClient<any>): Promise<SyncReport> {
  const report: SyncReport = {
    proyectosCreados: 0, proyectosActualizados: 0, managersAsignados: 0,
    managersNoEncontrados: [], saltadosSinHucha: 0,
  }

  // Cargar perfiles una vez para matchear manager por nombre (case-insensitive).
  const { data: profiles } = await db.from('profiles').select('id, full_name')
  const perfilPorNombre = new Map<string, string[]>()
  for (const p of profiles ?? []) {
    const key = String(p.full_name ?? '').trim().toLowerCase()
    if (!key) continue
    perfilPorNombre.set(key, [...(perfilPorNombre.get(key) ?? []), p.id])
  }

  for (const { proyecto, hucha } of data.proyectos) {
    if (!(hucha > 0)) { report.saltadosSinHucha++; continue }

    // Upsert proyecto por nombre.
    const { data: existing } = await db.from('projects').select('id').eq('name', proyecto).maybeSingle()
    let projectId: string
    if (existing) { projectId = existing.id; report.proyectosActualizados++ }
    else {
      const { data: created, error } = await db.from('projects').insert({ name: proyecto }).select('id').single()
      if (error) throw new Error(`crear proyecto "${proyecto}": ${error.message}`)
      projectId = created.id; report.proyectosCreados++
    }

    // Banco (el trigger lo crea) y base del Excel.
    const { data: bank, error: be } = await db.from('hucha_banks').select('id').eq('project_id', projectId).single()
    if (be) throw new Error(`banco de "${proyecto}": ${be.message}`)
    const { error: re } = await db.rpc('set_hucha_excel_base', { p_bank_id: bank.id, p_hucha: hucha })
    if (re) throw new Error(`set base "${proyecto}": ${re.message}`)

    // Asignación de manager por nombre.
    const mgr = (data.managerPorProyecto.get(proyecto) ?? '').trim()
    if (mgr) {
      const ids = perfilPorNombre.get(mgr.toLowerCase()) ?? []
      if (ids.length === 1) {
        const { data: ya } = await db.from('project_assignments')
          .select('id').eq('project_id', projectId).eq('user_id', ids[0]).maybeSingle()
        if (!ya) await db.from('project_assignments').insert({ project_id: projectId, user_id: ids[0] })
        report.managersAsignados++
      } else {
        report.managersNoEncontrados.push({ proyecto, manager: mgr })
      }
    }
  }
  return report
}
