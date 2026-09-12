// Detector de bancos de horas: compara el nivel de cada banco (por posición y total del
// proyecto) con el último anotado en avisos_estado y avisa cuando empeora. Usa el mismo
// cálculo que /bancos (getBancosHoras: carry forward, provisionales e histórico).
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBancosHoras } from '@/lib/horas/bancos'
import { diaMadrid } from '@/lib/horas/auditoria-types'
import { emitirAviso } from '@/lib/avisos/bandeja'
import { esProduccion, enlaceBanco } from '@/lib/avisos/entorno'
import { nivelesDeBancos, type NivelBanco } from '@/lib/avisos/capacidad'
import { transicion, type Nivel } from '@/lib/avisos/reglas'
import { leerEstados, guardarEstados } from '@/lib/avisos/estado'
import { perfilesPorId, managerPorNombre, type Perfil } from '@/lib/avisos/personas'
import type { DatosBanco } from '@/lib/avisos/contrato'

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

// Sin `proyectos` evalúa todos (cron diario). Nunca lanza.
export async function evaluarBancos(proyectos?: string[]): Promise<void> {
  if (!esProduccion()) return
  try {
    const db = createAdminClient()
    const filtro = proyectos ? new Set(proyectos.map((p) => p.trim())) : null
    const niveles = (await nivelesActuales(db)).filter((n) => !filtro || filtro.has(n.proyecto))
    if (!niveles.length) return
    const previos = await leerEstados(db, 'banco:')
    const hoy = diaMadrid(new Date().toISOString())
    const aGuardar: { clave: string; nivel: Nivel }[] = []
    let perfiles: Map<string, Perfil> | null = null

    for (const n of niveles) {
      const anterior = previos.get(n.clave) ?? null
      const t = transicion(anterior, n.nivel)
      if (!t.guardar) continue
      // Línea base y rearme: se anotan sin avisar.
      if (!t.avisar || anterior === null) {
        aGuardar.push({ clave: n.clave, nivel: n.nivel })
        continue
      }
      try {
        perfiles ??= await perfilesPorId(db)
        const manager = managerPorNombre(n.managerExcel, perfiles)
        if (manager && !manager.id) console.warn(`[avisos] manager del Excel sin usuario único: "${manager.nombre}" (${n.proyecto})`)
        const datos: DatosBanco = {
          proyecto: n.proyecto, alcance: n.alcance, posicion: n.posicion, nivel: n.nivel, nivel_anterior: anterior,
          horas: n.horas, porcentaje_consumido: n.porcentajeConsumido, estado_proyecto: n.estadoProyecto ?? null,
          manager_proyecto: manager, enlace: enlaceBanco(n.proyecto),
        }
        // Clave por transición y día: si dos guardados evalúan a la vez, sale un solo aviso.
        const base = `${n.clave}:${anterior}>${n.nivel}:${hoy}`
        await emitirAviso('banco.nivel', datos, { clave: `${base}:nivel` })
        // al_tope es solo del total del proyecto: el contrato fija alcance "proyecto" y
        // posicion null, y una sola posición no debe disparar el aviso de "100% del proyecto".
        if (t.alTope && n.alcance === 'proyecto') await emitirAviso('banco.al_tope', datos, { clave: `${base}:tope` })
        // Solo se anota si el aviso salió: si falla, la próxima pasada lo reintenta.
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
