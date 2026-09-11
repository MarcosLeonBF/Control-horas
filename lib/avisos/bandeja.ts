// Bandeja de salida: encolar (emitirAviso) y entregar (despacharPendientes), con service
// role. Solo producción envía; el botón «Enviar prueba» sí sale desde cualquier entorno.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { construirEnvio, type FilaSaliente } from '@/lib/avisos/firma'
import { siguienteIntento } from '@/lib/avisos/reglas'
import { esProduccion, appUrl } from '@/lib/avisos/entorno'
import { ejemplos, type DatosPorTipo, type TipoAviso } from '@/lib/avisos/contrato'

const TIMEOUT_MS = 5000
const COLUMNAS_FILA = 'id, tipo, datos, prueba, intentos, created_at'

interface Config { url: string | null; tiposActivos: string[] }
type Resultado = 'enviado' | 'reintento' | 'fallido' | 'descartado'

async function leerConfig(db: SupabaseClient): Promise<Config> {
  const { data, error } = await db.from('avisos_config').select('url, tipos_activos').eq('id', true).single()
  if (error) throw new Error(`avisos_config: ${error.message}`)
  return { url: (data.url as string | null) ?? null, tiposActivos: (data.tipos_activos as string[] | null) ?? [] }
}

// Encola un aviso y devuelve su id, o null si no se encoló (fuera de producción, o esa
// clave ya se emitió). Sin URL o con el tipo inactivo queda 'descartado': así, al activar
// un tipo más adelante, no llega de golpe todo lo acumulado.
export async function emitirAviso<T extends TipoAviso>(
  tipo: T, datos: DatosPorTipo[T], opciones: { clave?: string; prueba?: boolean } = {},
): Promise<string | null> {
  const prueba = opciones.prueba === true
  if (!prueba && !esProduccion()) return null
  const db = createAdminClient()
  const cfg = await leerConfig(db)
  const conDestino = !!cfg.url && (prueba || cfg.tiposActivos.includes(tipo))
  const { data, error } = await db.from('avisos_salientes').insert({
    tipo, datos, prueba, clave: opciones.clave ?? null,
    estado: conDestino ? 'pendiente' : 'descartado',
    motivo_descarte: conDestino ? null : 'sin_destino',
  }).select('id').single()
  if (error) {
    if (error.code === '23505') return null // esa clave ya se había emitido
    throw new Error(`avisos_salientes: ${error.message}`)
  }
  return data.id as string
}

async function marcarFallo(db: SupabaseClient, fila: FilaSaliente, codigo: number | null, error: string): Promise<Resultado> {
  // Las pruebas no se reintentan: el admin ve el resultado en el momento.
  const proximo = fila.prueba ? null : siguienteIntento(fila.intentos, new Date())
  const { error: e } = await db.from('avisos_salientes').update(
    proximo
      ? { estado: 'pendiente', proximo_intento: proximo.toISOString(), ultimo_codigo: codigo, ultimo_error: error }
      : { estado: 'fallido', ultimo_codigo: codigo, ultimo_error: error },
  ).eq('id', fila.id)
  if (e) console.error('[avisos] no se pudo anotar el fallo:', e.message)
  return proximo ? 'reintento' : 'fallido'
}

async function entregar(db: SupabaseClient, fila: FilaSaliente, cfg: Config): Promise<Resultado> {
  if (!cfg.url || (!fila.prueba && !cfg.tiposActivos.includes(fila.tipo))) {
    await db.from('avisos_salientes').update({ estado: 'descartado', motivo_descarte: 'sin_destino' }).eq('id', fila.id)
    return 'descartado'
  }
  const secreto = process.env.AVISOS_FIRMA_SECRETO
  if (!secreto) {
    console.error('[avisos] falta AVISOS_FIRMA_SECRETO: no se envía nada sin firmar')
    return marcarFallo(db, fila, null, 'sin_secreto')
  }
  const { cuerpo, cabeceras } = construirEnvio(fila, secreto, new Date())
  try {
    // Con límite de tiempo: un fetch sin timeout no falla, espera (incidente de Graph, 31/08).
    const res = await fetch(cfg.url, {
      method: 'POST', headers: cabeceras, body: cuerpo, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store',
    })
    if (res.ok) {
      await db.from('avisos_salientes').update({
        estado: 'enviado', enviado_at: new Date().toISOString(), ultimo_codigo: res.status, ultimo_error: null,
      }).eq('id', fila.id)
      return 'enviado'
    }
    const texto = (await res.text().catch(() => '')).slice(0, 500)
    return marcarFallo(db, fila, res.status, texto || `HTTP ${res.status}`)
  } catch (e) {
    return marcarFallo(db, fila, null, (e instanceof Error ? e.message : String(e)).slice(0, 500))
  }
}

// Entrega los pendientes vencidos (y los 'enviando' atascados). Solo en producción: la
// cola vive en la base de producción y un servidor local no debe tocarla.
export async function despacharPendientes(limite = 25): Promise<{ enviados: number; fallidos: number }> {
  if (!esProduccion()) return { enviados: 0, fallidos: 0 }
  const db = createAdminClient()
  const { data, error } = await db.rpc('avisos_reclamar', { p_limite: limite })
  if (error) throw new Error(`avisos_reclamar: ${error.message}`)
  const filas = (data ?? []) as FilaSaliente[]
  if (!filas.length) return { enviados: 0, fallidos: 0 }
  const cfg = await leerConfig(db)
  let enviados = 0
  let fallidos = 0
  for (const fila of filas) {
    const r = await entregar(db, fila, cfg)
    if (r === 'enviado') enviados++
    if (r === 'fallido') fallidos++
  }
  return { enviados, fallidos }
}

// «Enviar prueba»: manda el ejemplo del contrato de ese tipo y devuelve el resultado.
// Reserva solo su propia fila, así que desde local no se lleva por delante la cola real.
export async function enviarPrueba(tipo: TipoAviso): Promise<{ ok: boolean; mensaje: string }> {
  const db = createAdminClient()
  const cfg = await leerConfig(db)
  if (!cfg.url) return { ok: false, mensaje: 'Primero guarda la URL del webhook.' }
  const id = await emitirAviso(tipo, ejemplos(appUrl())[tipo], { prueba: true })
  if (!id) return { ok: false, mensaje: 'No se pudo crear el aviso de prueba.' }
  const { data: fila, error } = await db.from('avisos_salientes')
    .update({ estado: 'enviando', intentos: 1, reclamado_at: new Date().toISOString() })
    .eq('id', id).eq('estado', 'pendiente')
    .select(COLUMNAS_FILA).single()
  if (error || !fila) return { ok: false, mensaje: `No se pudo reservar el aviso de prueba: ${error?.message ?? 'sin fila'}` }
  const r = await entregar(db, fila as FilaSaliente, cfg)
  const { data: fin } = await db.from('avisos_salientes').select('ultimo_codigo, ultimo_error').eq('id', id).single()
  if (r === 'enviado') return { ok: true, mensaje: `Enviado (HTTP ${fin?.ultimo_codigo ?? '2xx'}).` }
  const codigo = fin?.ultimo_codigo ? `HTTP ${fin.ultimo_codigo}` : 'sin respuesta'
  return { ok: false, mensaje: `Falló (${codigo}): ${fin?.ultimo_error ?? r}` }
}
