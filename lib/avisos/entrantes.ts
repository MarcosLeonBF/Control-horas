// Lo que los flujos le mandan a la plataforma (por ahora, vacaciones), anotado en
// `avisos_entrantes` (0053) para verlo en Administración → Avisos: cada envío con la clave
// correcta, aceptado o rechazado. Sin esto, un rechazo solo lo veía quien lo mandaba.
// Puro, sin IO: la ruta decide cuándo anotar y hace el insert.

// Un cuerpo más grande no se guarda entero: el flujo es de confianza (tiene la clave), pero
// un error suyo no debería llenar la tabla.
const CUERPO_MAX = 20_000
const TEXTO_MAX = 2_000

export function tipoDe(v: unknown): string {
  if (v === null || v === undefined) return 'vacío'
  if (Array.isArray(v)) return 'lista'
  if (typeof v === 'string') return 'texto'
  if (typeof v === 'number') return 'número'
  if (typeof v === 'boolean') return 'sí/no'
  return 'objeto'
}

// "id (número), fields (objeto)": los nombres y tipos del primer nivel, sin valores. Va en
// los mensajes de error, para que quien manda vea qué llegó sin tener que preguntar. Con
// muchos campos se cortan: un cuerpo raro no debe dar un mensaje (ni una fila) enorme.
const CAMPOS_MAX = 30

export function describirCampos(obj: Record<string, unknown>): string {
  const todos = Object.entries(obj)
  if (!todos.length) return 'ninguno'
  const lista = todos.slice(0, CAMPOS_MAX).map(([k, v]) => `${k.slice(0, 60)} (${tipoDe(v)})`).join(', ')
  return todos.length > CAMPOS_MAX ? `${lista} y ${todos.length - CAMPOS_MAX} más` : lista
}

export interface FilaEntrante {
  tipo: string; status: number; error: string | null; resumen: string | null
  cuerpo: unknown; cuerpo_texto: string | null
}

const TEXTO_CORTO_MAX = 1_000

export function anotacionEntrante(tipo: string, a: {
  status: number
  error?: string | null // el motivo que se contestó, si no fue 200
  resumen?: string | null // qué pasó, en una línea (p. ej. por persona), si fue 200
  cuerpo?: unknown // el JSON recibido; undefined si no era JSON
  crudo?: string // el texto recibido, solo si no era JSON
  interno?: string // detalle de un 500: se guarda para el admin en vez del mensaje público
}): FilaEntrante {
  let cuerpo: unknown = a.cuerpo === undefined ? null : a.cuerpo
  let texto: string | null = a.crudo !== undefined ? a.crudo.slice(0, TEXTO_MAX) : null
  if (cuerpo !== null) {
    const json = JSON.stringify(cuerpo)
    if (json.length > CUERPO_MAX) {
      texto = `Cuerpo de ${json.length} caracteres, recortado: ${json.slice(0, TEXTO_MAX)}`
      cuerpo = null
    }
  }
  const error = a.interno ?? a.error ?? null
  return {
    tipo, status: a.status,
    error: error === null ? null : error.slice(0, TEXTO_CORTO_MAX),
    resumen: a.resumen ? a.resumen.slice(0, TEXTO_CORTO_MAX) : null,
    cuerpo, cuerpo_texto: texto,
  }
}

// Lo que enseña la pantalla: los últimos envíos y, además, los rechazos recientes que se
// quedarían fuera (una carga de muchas filas taparía un 400 del principio). Sin repetir,
// del más nuevo al más viejo.
export function recibidosParaVer<T extends { id: number; created_at: string }>(ultimos: T[], rechazos: T[]): T[] {
  const porId = new Map<number, T>()
  for (const r of [...ultimos, ...rechazos]) porId.set(r.id, r)
  return [...porId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
}
