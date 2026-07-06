import { unstable_cache } from 'next/cache'
import type { BancoHorasProyecto } from '@/lib/types'

export const BANCO_HORAS_TAG = 'banco-horas'

// Codifica la URL del archivo en el formato que espera el endpoint /shares de Graph API
function encodeShareUrl(url: string): string {
  return 'u!' + Buffer.from(url).toString('base64url')
}

// Paso 1: obtiene el token de acceso con client credentials
async function getToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.AZURE_CLIENT_ID!,
        client_secret: process.env.AZURE_CLIENT_SECRET!,
        grant_type:    'client_credentials',
        scope:         'https://graph.microsoft.com/.default',
      }),
    }
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Error obteniendo token de Azure: ${text}`)
  }

  const data = await res.json() as { access_token: string }
  return data.access_token
}

// Paso 2: resuelve driveId e itemId a partir de la URL del archivo
async function resolveDriveItem(token: string, fileUrl: string) {
  const encoded = encodeShareUrl(fileUrl)

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } }
    throw new Error(`Error resolviendo archivo: ${err?.error?.message ?? res.status}`)
  }

  const item = await res.json() as {
    id: string
    parentReference: { driveId: string }
  }

  return { driveId: item.parentReference.driveId, itemId: item.id }
}

// Paso 3: lee la tabla "BancoHoras". La primera columna es el proyecto; cada
// columna siguiente es una POSICIÓN (CRM, SEO, Growth Strategists…) con sus horas.
// Las posiciones se leen de la cabecera, así que admite columnas nuevas sin tocar código.
async function readBancoHorasTable(
  token: string,
  driveId: string,
  itemId: string
): Promise<BancoHorasProyecto[]> {
  const base = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/tables/BancoHoras`
  const headers = { Authorization: `Bearer ${token}` }
  const [headerRes, rowsRes] = await Promise.all([
    fetch(`${base}/headerRowRange`, { headers }),
    fetch(`${base}/rows`, { headers }),
  ])

  if (!headerRes.ok || !rowsRes.ok) {
    const bad = !headerRes.ok ? headerRes : rowsRes
    const err = await bad.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(`Error leyendo tabla BancoHoras: ${err?.error?.message ?? bad.status}`)
  }

  const header = (await headerRes.json() as { values: unknown[][] }).values[0] ?? []
  const positions = header.slice(1).map((h) => String(h ?? '').trim()) // columnas 1..n = posiciones
  const rows = (await rowsRes.json() as { value: Array<{ values: unknown[][] }> }).value

  return rows
    .map((row) => {
      const cells = row.values[0]
      const project = String(cells[0] ?? '').trim()
      const list = positions
        .map((position, i) => ({ position, hours: Number(cells[i + 1] ?? 0) }))
        .filter((p) => p.position !== '' && !isNaN(p.hours))
      return { project, positions: list }
    })
    .filter((item) => item.project !== '')
}

// Función principal que ejecuta los 3 pasos
export async function fetchBancoHorasFromGraph(): Promise<BancoHorasProyecto[]> {
  const fileUrl = process.env.SHAREPOINT_FILE_URL
  if (!fileUrl) throw new Error('SHAREPOINT_FILE_URL no está configurada')

  const token                = await getToken()
  const { driveId, itemId }  = await resolveDriveItem(token, fileUrl)
  const items                = await readBancoHorasTable(token, driveId, itemId)

  return items
}

// Versión cacheada (5 minutos). Usarla desde páginas y route handlers.
export const getCachedBancoHoras = unstable_cache(
  fetchBancoHorasFromGraph,
  ['banco-horas-data'],
  { revalidate: 300, tags: [BANCO_HORAS_TAG] }
)

// ── Estado de proyectos (hoja "Clientes_Proyectos" del mismo Excel) ──────────
// Columnas usadas: Proyecto | Estado | Manager del proyecto | Fecha Auditoría.
// Proyecto→Estado distingue finalizados/pausados al registrar y en Bancos; el
// manager y la fecha de auditoría se usan para filtrar en Bancos. Se lee el
// usedRange de la hoja (funciona sea o no una Tabla con nombre). El nombre de la
// hoja se puede sobreescribir con SHAREPOINT_ESTADOS_SHEET.
export interface ProyectoEstado { project: string; estado: string; manager: string; fechaAuditoria: string }

// Celda de fecha del Excel → ISO "YYYY-MM-DD". Acepta serial numérico o texto
// tipo "12/31/2023". Vacío si no hay fecha o no se puede interpretar.
function excelDateToISO(cell: unknown): string {
  if (cell == null || cell === '') return ''
  if (typeof cell === 'number') {
    const ms = Math.round((cell - 25569) * 86400000) // 25569 = días de 1899-12-30 a 1970-01-01
    const d = new Date(ms)
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
  }
  const t = Date.parse(String(cell).trim())
  return isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10)
}

async function readClientesProyectosSheet(
  token: string,
  driveId: string,
  itemId: string,
): Promise<ProyectoEstado[]> {
  const sheet = process.env.SHAREPOINT_ESTADOS_SHEET ?? 'Clientes_Proyectos'
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets/${encodeURIComponent(sheet)}/usedRange(valuesOnly=true)`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(`Error leyendo hoja ${sheet}: ${err?.error?.message ?? res.status}`)
  }

  const values = (await res.json() as { values: unknown[][] }).values ?? []
  if (values.length < 2) return []

  const header = values[0]
  // Normaliza el encabezado: minúsculas y sin acentos (para casar "Fecha Auditoría").
  const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const projIdx = header.findIndex((h) => norm(h) === 'proyecto')
  const estadoIdx = header.findIndex((h) => norm(h) === 'estado')
  if (projIdx === -1 || estadoIdx === -1) {
    throw new Error(`La hoja ${sheet} necesita columnas "Proyecto" y "Estado".`)
  }
  // Opcionales: manager del proyecto y fecha de auditoría (filtros de Bancos).
  const managerIdx = header.findIndex((h) => norm(h) === 'manager del proyecto')
  const auditIdx = header.findIndex((h) => norm(h) === 'fecha auditoria')

  return values
    .slice(1)
    .map((cells) => ({
      project: String(cells[projIdx] ?? '').trim(),
      estado: String(cells[estadoIdx] ?? '').trim(),
      manager: managerIdx === -1 ? '' : String(cells[managerIdx] ?? '').trim(),
      fechaAuditoria: auditIdx === -1 ? '' : excelDateToISO(cells[auditIdx]),
    }))
    .filter((r) => r.project !== '')
}

export async function fetchProyectosEstadoFromGraph(): Promise<ProyectoEstado[]> {
  const fileUrl = process.env.SHAREPOINT_FILE_URL
  if (!fileUrl) throw new Error('SHAREPOINT_FILE_URL no está configurada')

  const token               = await getToken()
  const { driveId, itemId } = await resolveDriveItem(token, fileUrl)
  return readClientesProyectosSheet(token, driveId, itemId)
}

export const getCachedProyectosEstado = unstable_cache(
  fetchProyectosEstadoFromGraph,
  ['proyectos-estado-data'],
  { revalidate: 300, tags: [BANCO_HORAS_TAG] }
)
