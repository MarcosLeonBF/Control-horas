import { createAdminClient } from '@/lib/supabase/admin'
import { getCachedBancoHoras } from '@/lib/graph/client'
import { nivelesAlcanzados, masSevero, mensajeAlerta, type Threshold } from '@/lib/horas/alertas-core'

async function sendSlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) return // sin webhook configurado: no-op
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch {
    /* un fallo de Slack nunca debe romper el guardado */
  }
}

// Recalcula el consumo de los proyectos afectados y dispara una alerta Slack al
// cruzar 80 / 100 / exceso (cada umbral, una sola vez por proyecto).
// assigned = Horas CRM (Excel) + ampliaciones activas ; consumed = líneas no anuladas.
// Nunca lanza: las alertas no deben afectar el guardado del registro.
export async function checkHorasAlertas(projects: string[]): Promise<void> {
  try {
    const unique = [...new Set(projects.map((p) => p.trim()))].filter((p) => p && p !== 'Departamento')
    if (!unique.length) return

    const db = createAdminClient()

    let excel: { project: string; totalHours: number }[] = []
    try {
      excel = await getCachedBancoHoras()
    } catch {
      excel = []
    }
    const baseByProject = new Map(excel.map((e) => [e.project.trim(), Number(e.totalHours)]))

    for (const project of unique) {
      const { data: amps } = await db
        .from('horas_ampliaciones').select('hours').eq('project', project).eq('active', true)
      const ampSum = (amps ?? []).reduce((s, a) => s + Number(a.hours), 0)
      const assigned = (baseByProject.get(project) ?? 0) + ampSum
      if (assigned <= 0) continue

      const { data: lines } = await db
        .from('time_log_lines').select('hours, time_logs!inner(status)')
        .eq('project', project).neq('time_logs.status', 'anulado')
      const consumed = (lines ?? []).reduce((s, l) => s + Number(l.hours), 0)

      const niveles = nivelesAlcanzados(assigned, consumed)
      if (!niveles.length) continue

      const { data: prev } = await db.from('horas_alertas').select('threshold').eq('project', project)
      const yaEnviadas = new Set((prev ?? []).map((r) => r.threshold as Threshold))
      const nuevos = niveles.filter((n) => !yaEnviadas.has(n))
      if (!nuevos.length) continue

      // Registra todos los niveles nuevos (para no repetirlos) y avisa solo el más severo.
      await db.from('horas_alertas').upsert(
        nuevos.map((threshold) => ({ project, threshold, consumed, assigned })),
        { onConflict: 'project,threshold', ignoreDuplicates: true },
      )
      const top = masSevero(nuevos)
      if (top) await sendSlack(mensajeAlerta(project, top, assigned, consumed))
    }
  } catch {
    /* nunca romper el guardado por las alertas */
  }
}
