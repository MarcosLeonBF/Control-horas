// Detector de HUCHA: proyecto nuevo (al sincronizar), ampliación y cambios de nivel
// (baja, agotada, excedida). El estado de cada HUCHA ya lo calcula la base
// (compute_hucha_status): aquí solo se compara con el último anotado.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { emitirAviso } from '@/lib/avisos/bandeja'
import { esProduccion, esPersonaDePrueba, enlaceHucha } from '@/lib/avisos/entorno'
import { transicion, comoNivel, centesimas, type Nivel } from '@/lib/avisos/reglas'
import { leerEstados, guardarEstados } from '@/lib/avisos/estado'
import type { ManagerAviso, SaldoHucha } from '@/lib/avisos/contrato'

export interface MovimientoAmpliacion {
  id: string
  amount: number
  reason: string | null
  reference: string | null
  entry_date: string
  actor_name: string
}

interface BancoRaw { currency: string | null; assigned_total: number; consumed_total: number; remaining: number; status: string }
interface HuchaRaw {
  id: string
  name: string
  hucha_banks: BancoRaw | BancoRaw[] | null
  project_assignments: { profiles: { id: string; full_name: string | null; email: string | null } | null }[] | null
}

interface Hucha {
  id: string
  nombre: string
  moneda: string
  saldo: SaldoHucha
  nivel: Nivel | null
  managers: ManagerAviso[]
}

const SELECT_HUCHA =
  'id, name, hucha_banks(currency, assigned_total, consumed_total, remaining, status), project_assignments(profiles(id, full_name, email))'

// Los E2E siembran en la única base (la de producción) los proyectos «Cliente E2E
// Asignado» y «Cliente E2E NoAsignado» y managers @hucha.test: ni esos proyectos ni esas
// personas pueden acabar en un aviso real.
const PROYECTO_E2E = /\be2e\b/i

// Proyectos activos con su banco y sus managers (project_assignments), sin los de los E2E.
async function leerHuchas(db: SupabaseClient, ids?: string[]): Promise<Hucha[]> {
  let q = db.from('projects').select(SELECT_HUCHA).eq('status', 'activo')
  if (ids) q = q.in('id', ids)
  const { data, error } = await q
  if (error) throw new Error(`projects/hucha_banks: ${error.message}`)
  return ((data ?? []) as unknown as HuchaRaw[]).flatMap((p) => {
    if (PROYECTO_E2E.test(p.name)) return []
    const b = Array.isArray(p.hucha_banks) ? p.hucha_banks[0] : p.hucha_banks
    if (!b) return []
    const managers = (p.project_assignments ?? [])
      .map((a) => a.profiles)
      .filter((pr): pr is { id: string; full_name: string | null; email: string | null } => pr !== null)
      .filter((pr) => !esPersonaDePrueba(pr.email))
      .map((pr) => ({ id: pr.id, nombre: pr.full_name ?? '', email: pr.email }))
    return [{
      id: p.id, nombre: p.name, moneda: b.currency ?? 'EUR',
      saldo: {
        asignado: centesimas(Number(b.assigned_total)),
        consumido: centesimas(Number(b.consumed_total)),
        disponible: centesimas(Number(b.remaining)),
      },
      nivel: comoNivel(b.status), managers,
    }]
  })
}

// Sin `ids` evalúa todas (cron y sincronización). Nunca lanza.
export async function evaluarHucha(ids?: string[]): Promise<void> {
  if (!esProduccion()) return
  try {
    const db = createAdminClient()
    const huchas = await leerHuchas(db, ids)
    const previos = await leerEstados(db, 'hucha:')
    const aGuardar: { clave: string; nivel: Nivel }[] = []
    for (const h of huchas) {
      if (!h.nivel) continue // sin_presupuesto: no avisa
      const clave = `hucha:${h.id}`
      const previo = previos.get(clave)
      const anterior = previo?.nivel ?? null
      const t = transicion(anterior, h.nivel)
      if (!t.guardar) continue
      // Línea base y rearme: se anotan sin avisar. Sin fila previa `t.avisar` ya es false;
      // `!previo` está para que TypeScript sepa que abajo la hay.
      if (!t.avisar || !previo) {
        aGuardar.push({ clave, nivel: h.nivel })
        continue
      }
      try {
        // Clave por transición y por la fila previa (su updated_at), como en los bancos: un
        // rearme reescribe la fila y la siguiente caída, aunque sea el mismo día, avisa.
        await emitirAviso('hucha.nivel', {
          proyecto: h.nombre, proyecto_id: h.id, nivel: h.nivel, nivel_anterior: previo.nivel,
          moneda: h.moneda, saldo: h.saldo, managers: h.managers, enlace: enlaceHucha(h.id),
        }, { clave: `${clave}:${previo.nivel}>${h.nivel}:${previo.desde}` })
        // Solo se anota si el aviso salió: si falla, la próxima pasada lo reintenta.
        aGuardar.push({ clave, nivel: h.nivel })
      } catch (e) {
        // Una HUCHA que falla no debe perder la línea base ni los avisos ya emitidos de
        // las demás de esta pasada: se aísla aquí y no se propaga. La clave de dedupe (la
        // misma mientras no cambie la fila previa) evita un duplicado si otra pasada la reintenta.
        console.error(`[avisos] evaluarHucha ${clave}:`, e instanceof Error ? e.message : e)
      }
    }
    await guardarEstados(db, aGuardar)
  } catch (e) {
    console.error('[avisos] evaluarHucha:', e instanceof Error ? e.message : e)
  }
}

export async function alAmpliarHucha(projectId: string, mov: MovimientoAmpliacion): Promise<void> {
  if (!esProduccion()) return
  try {
    const db = createAdminClient()
    const [h] = await leerHuchas(db, [projectId])
    if (h) {
      await emitirAviso('hucha.ampliacion', {
        proyecto: h.nombre, proyecto_id: h.id, importe: centesimas(Number(mov.amount)), moneda: h.moneda,
        motivo: mov.reason ?? '', referencia: mov.reference, dia: mov.entry_date, actor: { nombre: mov.actor_name },
        saldo: h.saldo, nivel: h.nivel, managers: h.managers, enlace: enlaceHucha(h.id),
      }, { clave: `hucha.ampliacion:${mov.id}` })
    }
  } catch (e) {
    console.error('[avisos] alAmpliarHucha:', e instanceof Error ? e.message : e)
  }
  await evaluarHucha([projectId]) // la ampliación mejora el nivel: rearme
}

export async function alSincronizarHucha(creados: { id: string; nombre: string; hucha: number }[]): Promise<void> {
  if (!esProduccion()) return
  try {
    const db = createAdminClient()
    const huchas = creados.length ? await leerHuchas(db, creados.map((c) => c.id)) : []
    const porId = new Map(huchas.map((h) => [h.id, h]))
    for (const c of creados) {
      try {
        const h = porId.get(c.id)
        await emitirAviso('hucha.proyecto_nuevo', {
          proyecto: c.nombre, proyecto_id: c.id, presupuesto: centesimas(c.hucha), moneda: h?.moneda ?? 'EUR',
          managers: h?.managers ?? [], enlace: enlaceHucha(c.id),
        }, { clave: `hucha.nuevo:${c.id}` })
      } catch (e) {
        // Un proyecto nuevo que falla no debe saltarse el aviso de los demás proyectos
        // creados en esta misma sincronización.
        console.error(`[avisos] alSincronizarHucha ${c.id}:`, e instanceof Error ? e.message : e)
      }
    }
  } catch (e) {
    console.error('[avisos] alSincronizarHucha:', e instanceof Error ? e.message : e)
  }
  await evaluarHucha() // el Excel puede haber cambiado la base de cualquier HUCHA
}
