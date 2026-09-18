// Detector de bancos de horas: compara el nivel de cada banco (por posición y total del
// proyecto) con el último anotado en avisos_estado y avisa cuando empeora. Usa el mismo
// cálculo que /bancos (getBancosHoras: carry forward, provisionales e histórico).
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBancosHoras } from '@/lib/horas/bancos'
import { emitirAviso } from '@/lib/avisos/bandeja'
import { esProduccion, esPersonaDePrueba, enlaceBanco, enlaceRegistro } from '@/lib/avisos/entorno'
import { nivelesDeBancos, datosAmpliacionHoras, type NivelBanco } from '@/lib/avisos/capacidad'
import { transicion, avisosDeBanco, type Nivel } from '@/lib/avisos/reglas'
import { leerEstados, guardarEstados } from '@/lib/avisos/estado'
import { perfilesPorId, managerPorNombre, actorDe, type Perfil } from '@/lib/avisos/personas'
import type { DatosBanco, PersonaAviso } from '@/lib/avisos/contrato'

async function ampliacionesActivas(db: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await db.from('horas_ampliaciones').select('project, hours').eq('active', true)
  if (error) throw new Error(`horas_ampliaciones: ${error.message}`)
  const out = new Map<string, number>()
  for (const a of data ?? []) {
    const p = String(a.project).trim()
    out.set(p, (out.get(p) ?? 0) + Number(a.hours))
  }
  return out
}

// Niveles actuales de los bancos de proyectos activos. También los usa el resumen de capacidad.
// Modo estricto: con el Excel o los perfiles a medias lanza en vez de calcular bancos
// falsos; evaluarBancos lo captura y no avisa ni anota nada, y el resumen responde 500.
export async function nivelesActuales(db: SupabaseClient = createAdminClient()): Promise<NivelBanco[]> {
  const [rows, amps] = await Promise.all([getBancosHoras({ role: 'admin' }, { estricto: true }), ampliacionesActivas(db)])
  return nivelesDeBancos(rows, amps)
}

// Tras ampliar horas: avisa de la ampliación (banco.ampliacion) y re-evalúa el banco, que
// ha mejorado y puede tener que rearmarse. Es el gemelo de alAmpliarHucha. Nunca lanza.
//
// Lo que sale de la base —la ampliación tal como quedó guardada y quién la hizo— es seguro.
// El estado del banco y el manager del proyecto salen del Excel de SharePoint, en modo
// estricto: si Graph falla, nivelesActuales lanza. Esa lectura se aísla aquí para que el
// fallo no se coma el aviso: sale igual, con esos campos en null (datosAmpliacionHoras).
export async function alAmpliarHoras(ampliacionId: string, project: string): Promise<void> {
  if (!esProduccion()) return
  try {
    const db = createAdminClient()
    const { data: amp, error } = await db
      .from('horas_ampliaciones')
      .select('project, hours, reason, entry_date, actor_name, created_by')
      .eq('id', ampliacionId)
      .single()
    if (error || !amp) throw new Error(`horas_ampliaciones ${ampliacionId}: ${error?.message ?? 'no encontrada'}`)

    const actor = await actorDe(db, amp.created_by as string | null, amp.actor_name as string)
    // Los E2E amplían horas en un proyecto real (y lo anulan al acabar): sus usuarios no
    // generan avisos, igual que en detector-registro.
    if (!esPersonaDePrueba(actor.email)) {
      let total: NivelBanco | undefined
      try {
        const nombre = String(amp.project).trim()
        total = (await nivelesActuales(db)).find((n) => n.alcance === 'proyecto' && n.proyecto === nombre)
      } catch (e) {
        console.warn(`[avisos] alAmpliarHoras ${ampliacionId}: sin estado del banco (Excel):`, e instanceof Error ? e.message : e)
      }
      const perfiles = await perfilesPorId(db)
      const datos = datosAmpliacionHoras(
        { project: amp.project as string, hours: Number(amp.hours), reason: amp.reason as string, entry_date: String(amp.entry_date) },
        actor, total, managerPorNombre(total?.managerExcel, perfiles), enlaceBanco(String(amp.project).trim()),
      )
      // Clave por el id de la ampliación, como hucha.ampliacion con el del movimiento: si el
      // despacho se reintenta, esta ampliación nunca sale dos veces.
      await emitirAviso('banco.ampliacion', datos, { clave: `banco.ampliacion:${ampliacionId}` })
    }
  } catch (e) {
    console.error('[avisos] alAmpliarHoras:', e instanceof Error ? e.message : e)
  }
  await evaluarBancos([project]) // la ampliación mejora el banco: rearme
}

// El registro que disparó la evaluación, si la disparó uno: quién lo hizo y, por proyecto,
// qué registro enlazar (registroPorProyecto). Solo lo pasa alGuardarRegistro.
export interface OrigenRegistro {
  persona: PersonaAviso
  porProyecto: Map<string, { id: string; dia: string }>
}

// Sin `proyectos` evalúa todos (cron diario). Sin `origen` —el cron, una sincronización, una
// ampliación o su anulación— los avisos salen con `registro: null`. Nunca lanza.
export async function evaluarBancos(proyectos?: string[], origen?: OrigenRegistro): Promise<void> {
  if (!esProduccion()) return
  try {
    const db = createAdminClient()
    const filtro = proyectos ? new Set(proyectos.map((p) => p.trim())) : null
    const niveles = (await nivelesActuales(db)).filter((n) => !filtro || filtro.has(n.proyecto))
    if (!niveles.length) return
    const previos = await leerEstados(db, 'banco:')
    const aGuardar: { clave: string; nivel: Nivel }[] = []
    let perfiles: Map<string, Perfil> | null = null

    for (const n of niveles) {
      const previo = previos.get(n.clave)
      const anterior = previo?.nivel ?? null
      const t = transicion(anterior, n.nivel)
      if (!t.guardar) continue
      // Qué sale lo decide avisosDeBanco (puro y probado): al_tope solo en el total.
      const tipos = avisosDeBanco(t, n.alcance)
      // Línea base y rearme: se anotan sin avisar. Sin fila previa `tipos` ya viene vacío;
      // `!previo` está para que TypeScript sepa que abajo la hay.
      if (!tipos.length || !previo) {
        aGuardar.push({ clave: n.clave, nivel: n.nivel })
        continue
      }
      try {
        perfiles ??= await perfilesPorId(db)
        const manager = managerPorNombre(n.managerExcel, perfiles)
        if (manager && !manager.id) console.warn(`[avisos] manager del Excel sin usuario único: "${manager.nombre}" (${n.proyecto})`)
        const reg = origen?.porProyecto.get(n.proyecto)
        const datos: DatosBanco = {
          proyecto: n.proyecto, alcance: n.alcance, posicion: n.posicion, nivel: n.nivel, nivel_anterior: previo.nivel,
          horas: n.horas, porcentaje_consumido: n.porcentajeConsumido, estado_proyecto: n.estadoProyecto ?? null,
          manager_proyecto: manager, enlace: enlaceBanco(n.proyecto),
          registro: reg && origen ? { persona: origen.persona, dia: reg.dia, enlace: enlaceRegistro(reg.id) } : null,
        }
        // Clave por transición y por la fila previa (su updated_at): dos evaluaciones a la
        // vez de la misma transición comparten clave y sale un solo aviso; un rearme
        // reescribe la fila, así que volver a cruzar el mismo día trae clave nueva y avisa.
        const base = `${n.clave}:${previo.nivel}>${n.nivel}:${previo.desde}`
        for (const tipo of tipos) {
          await emitirAviso(tipo, datos, { clave: `${base}:${tipo === 'banco.al_tope' ? 'tope' : 'nivel'}` })
        }
        // Solo se anota si el aviso salió: si falla, la próxima pasada lo reintenta con la
        // misma clave, así que lo que ya salió no se repite.
        aGuardar.push({ clave: n.clave, nivel: n.nivel })
      } catch (e) {
        // Un banco que falla no debe perder la línea base ni los avisos ya emitidos de
        // los demás bancos de esta pasada: se aísla aquí y no se propaga.
        console.error(`[avisos] evaluarBancos ${n.clave}:`, e instanceof Error ? e.message : e)
      }
    }
    await guardarEstados(db, aGuardar)
  } catch (e) {
    console.error('[avisos] evaluarBancos:', e instanceof Error ? e.message : e)
  }
}
