// Detector de registros. Al guardar solo se anota una espera (avisos_por_revisar, 0061): el
// pulso (solo altas, uno por fecha), los días llamativos y la evaluación de los bancos salen
// ESPERA_REGISTRO_MINUTOS después del último cambio, armados con cómo quedaron los registros.
// Así una corrección en ese rato (la fecha que se quedó en «hoy») sale ya corregida.
import { createAdminClient } from '@/lib/supabase/admin'
import { emitirAviso } from '@/lib/avisos/bandeja'
import { esProduccion, esPersonaDePrueba, enlaceRegistro } from '@/lib/avisos/entorno'
import { perfilesPorId, managerDe, managerPorNombre, sinAvisosPropios } from '@/lib/avisos/personas'
import { getCachedProyectosEstado } from '@/lib/graph/client'
import { diaMadrid } from '@/lib/horas/auditoria-types'
import {
  resumirPorDia, claveLlamativo, textoProyectos, descripcionLlamativo, registroPorProyecto,
  armarGuardado, planAvisosRegistro, ESPERA_REGISTRO_MINUTOS, type RegistroActual,
} from '@/lib/avisos/reglas'
import { evaluarBancos } from '@/lib/avisos/detector-bancos'

// Después de guardar en /registrar. logId = el id que devolvió guardar_registro; anclaId = el
// registro que se editaba (null en un alta). Una edición de un registro que todavía espera se
// suma a su espera y la reinicia (avisos_esperar_guardado). Nunca lanza.
export async function alGuardarRegistro(args: { logId: string; anclaId: string | null }): Promise<void> {
  if (!esProduccion()) return
  try {
    const db = createAdminClient()
    const { data: log, error } = await db.from('time_logs').select('user_id, updated_at').eq('id', args.logId).single()
    if (error) throw new Error(`time_logs: ${error.message}`)
    // Los registros de ESTE guardado. guardar_registro parte el guardado por fecha pero solo
    // devuelve un id; los demás se encuentran por su updated_at: todo lo que escribe una
    // llamada lleva el mismo now(), que en Postgres es la hora de inicio de la transacción (el
    // ancla lo pone a mano, los nuevos por defecto, y time_logs no tiene triggers que lo
    // toquen). Una edición que parte el registro en otro día también sale aquí.
    const { data: delGuardado, error: e1 } = await db.from('time_logs')
      .select('id').eq('user_id', log.user_id as string).eq('updated_at', log.updated_at as string)
    if (e1) throw new Error(`time_logs del guardado: ${e1.message}`)
    const ids = [...new Set([args.logId, ...(delGuardado ?? []).map((l) => l.id as string)])]
    const { error: e2 } = await db.rpc('avisos_esperar_guardado', {
      p_user_id: log.user_id, p_log_ids: ids, p_ancla: args.anclaId,
      p_es_alta: args.anclaId === null, p_espera: `${ESPERA_REGISTRO_MINUTOS} minutes`,
    })
    if (e2) throw new Error(`avisos_esperar_guardado: ${e2.message}`)
  } catch (e) {
    console.error('[avisos] alGuardarRegistro:', e instanceof Error ? e.message : e)
  }
}

export interface EsperaGuardado {
  id: string
  log_ids: string[]
  es_alta: boolean
}

// Una espera vencida: arma y emite con cómo están ahora sus registros. Todas las lecturas van
// antes del primer aviso, así que si algo falla lanza sin haber emitido nada y la espera se
// reintenta; desde el primer aviso, cada uno va por separado y un fallo se queda en el log.
export async function revisarGuardado(espera: EsperaGuardado): Promise<void> {
  const db = createAdminClient()
  const { data: logs, error } = await db.from('time_logs')
    .select('id, user_id, entry_date, status, time_log_lines(project, hours)').in('id', espera.log_ids)
  if (error) throw new Error(`time_logs: ${error.message}`)
  if (!logs?.length) return
  const duenoId = logs[0].user_id as string
  const registros: RegistroActual[] = logs.map((l) => ({
    id: l.id as string, entry_date: String(l.entry_date), status: l.status as string,
    lineas: (l.time_log_lines ?? []) as { project: string; hours: number }[],
  }))
  const { lineas, logPorDia } = armarGuardado(registros)
  if (!lineas.length) return // todo anulado: no sale nada

  // Con ausencias: de quien está fuera hoy no se manda nada.
  const perfiles = await perfilesPorId(db, diaMadrid(new Date().toISOString()))
  const dueno = perfiles.get(duenoId)
  if (!dueno || esPersonaDePrueba(dueno.persona.email)) return
  const manager = managerDe(dueno, perfiles)

  const dias = [...new Set(lineas.map((l) => l.entry_date))]
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

  // Cada aviso por separado: si uno falla, no se lleva por delante los demás días, los otros
  // avisos ni la evaluación de bancos del final.
  const emitir = async (etiqueta: string, envio: () => Promise<unknown>) => {
    try {
      await envio()
    } catch (e) {
      console.error(`[avisos] ${etiqueta}:`, e instanceof Error ? e.message : e)
    }
  }
  const enlaceDelDia = (dia: string) => enlaceRegistro(logPorDia.get(dia) ?? espera.log_ids[0])

  // Dirección y Administración no reciben avisos sobre sus registros, ni quien está de
  // ausencia hoy (de quien está fuera no se manda nada). La evaluación de bancos del final
  // sí se hace, porque va de los proyectos, no de la persona.
  if (!sinAvisosPropios(dueno.persona.equipo) && !dueno.ausenteHoy) {
    const plan = planAvisosRegistro({ esAlta: espera.es_alta, lineas, totales })
    // Manager del proyecto en proyecto_largo, del Excel como en los avisos de banco. Si el
    // Excel no responde, el aviso sale igual con manager_proyecto null (como banco.ampliacion).
    const excel = plan.llamativos.some((l) => l.motivo.proyecto)
      ? await getCachedProyectosEstado().catch((e) => {
        console.warn('[avisos] registro.llamativo sin manager del proyecto (Excel):', e instanceof Error ? e.message : e)
        return []
      })
      : []
    for (const p of plan.pulsos) {
      // Clave por espera y día: si la espera se procesa otra vez (la función se cortó después
      // de emitir y antes de cerrarla), el pulso no se repite.
      await emitir(`registro.enviado ${duenoId} ${p.dia}`, () => emitirAviso('registro.enviado', {
        persona: dueno.persona, manager_directo: manager, dia: p.dia,
        horas_registro: p.horasRegistro, horas_dia: p.horasDia,
        proyectos: p.proyectos, proyectos_texto: textoProyectos(p.proyectos),
        enlace_registro: enlaceDelDia(p.dia),
      }, { clave: `pulso:${espera.id}:${p.dia}` }))
    }
    for (const { dia, motivo: m, horasDia } of plan.llamativos) {
      await emitir(`registro.llamativo ${duenoId} ${dia} ${m.regla}`, () => emitirAviso('registro.llamativo', {
        persona: dueno.persona, manager_directo: manager, dia,
        // En dia_largo no hay proyecto: no casa con ninguna fila y sale null.
        manager_proyecto: managerPorNombre(excel.find((e) => e.project.trim() === m.proyecto)?.manager, perfiles),
        regla: m.regla, valor: m.valor, limite: m.limite, proyecto: m.proyecto,
        horas_dia: horasDia, descripcion: descripcionLlamativo(m, dia),
        // El registro de este guardado que volvió llamativo el día (el día puede tener otros
        // registros: el total de horas_dia los suma todos).
        enlace_registro: enlaceDelDia(dia),
      }, { clave: claveLlamativo(duenoId, dia, m) }))
    }
  }

  const proyectos = [...new Set(lineas.map((l) => l.project.trim()))].filter((p) => p !== 'Departamento')
  // Con el origen, si un banco cae su aviso dice por el registro de quién (y cuál).
  if (proyectos.length) {
    await evaluarBancos(proyectos, { persona: dueno.persona, porProyecto: registroPorProyecto(lineas, logPorDia) })
  }
}
