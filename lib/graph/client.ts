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
