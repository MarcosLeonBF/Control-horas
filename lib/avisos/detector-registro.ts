// Detector de registros: después de guardar, el pulso (solo altas, uno por fecha), los
// días llamativos y la evaluación de los bancos de los proyectos que tocó el guardado.
import { createAdminClient } from '@/lib/supabase/admin'
import { emitirAviso } from '@/lib/avisos/bandeja'
import { esProduccion, esPersonaDePrueba } from '@/lib/avisos/entorno'
import { perfilesPorId, managerDe } from '@/lib/avisos/personas'
import { resumirPorDia, motivosLlamativo, claveLlamativo, textoProyectos, descripcionLlamativo } from '@/lib/avisos/reglas'
import { evaluarBancos } from '@/lib/avisos/detector-bancos'

export interface LineaGuardada {
  entry_date: string
  project: string
  hours: number
}

// esAlta = el guardado no traía ancla. logId = el id que devolvió guardar_registro: sirve
// para saber de quién es el registro (un admin puede editar registros ajenos). Nunca lanza.
export async function alGuardarRegistro(args: { esAlta: boolean; logId: string; lineas: LineaGuardada[] }): Promise<void> {
  if (!esProduccion()) return
  try {
    const db = createAdminClient()
    const { data: log, error } = await db.from('time_logs').select('user_id').eq('id', args.logId).single()
    if (error) throw new Error(`time_logs: ${error.message}`)
    const duenoId = log.user_id as string
    const perfiles = await perfilesPorId(db)
    const dueno = perfiles.get(duenoId)
    if (!dueno || esPersonaDePrueba(dueno.persona.email)) return
    const manager = managerDe(dueno, perfiles)

    const dias = [...new Set(args.lineas.map((l) => l.entry_date))]
    // El día entero (puede haber varios registros el mismo día), no solo este guardado.
    const { data: delDia, error: e2 } = await db.from('time_log_lines')
      .select('project, hours, time_logs!inner(entry_date, user_id, status)')
      .eq('time_logs.user_id', duenoId)
      .in('time_logs.entry_date', dias)
      .neq('time_logs.status', 'anulado')
    if (e2) throw new Error(`time_log_lines: ${e2.message}`)
    type FilaDia = { project: string; hours: number; time_logs: { entry_date: string } }
    const totales = resumirPorDia(((delDia ?? []) as unknown as FilaDia[])
      .map((l) => ({ dia: l.time_logs.entry_date, proyecto: l.project.trim(), horas: Number(l.hours) })))
    const deEste = resumirPorDia(args.lineas
      .map((l) => ({ dia: l.entry_date, proyecto: l.project.trim(), horas: Number(l.hours) })))

    for (const dia of dias) {
      const total = totales.get(dia) ?? { total: 0, porProyecto: new Map<string, number>() }
      const este = deEste.get(dia)
      if (args.esAlta && este) {
        const proyectos = [...este.porProyecto].map(([proyecto, horas]) => ({ proyecto, horas }))
        await emitirAviso('registro.enviado', {
          persona: dueno.persona, manager_directo: manager, dia,
          horas_registro: este.total, horas_dia: total.total,
          proyectos, proyectos_texto: textoProyectos(proyectos),
        })
      }
      for (const m of motivosLlamativo(total)) {
        await emitirAviso('registro.llamativo', {
          persona: dueno.persona, manager_directo: manager, dia,
          regla: m.regla, valor: m.valor, limite: m.limite, proyecto: m.proyecto,
          horas_dia: total.total, descripcion: descripcionLlamativo(m, dia),
        }, { clave: claveLlamativo(duenoId, dia, m) })
      }
    }

    const proyectos = [...new Set(args.lineas.map((l) => l.project.trim()))].filter((p) => p !== 'Departamento')
    if (proyectos.length) await evaluarBancos(proyectos)
  } catch (e) {
    console.error('[avisos] alGuardarRegistro:', e instanceof Error ? e.message : e)
  }
}
