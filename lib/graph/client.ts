import { unstable_cache } from 'next/cache'
import type { BancoHorasItem } from '@/lib/types'

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

// Paso 3: lee las filas de la tabla "BancoHoras" del Excel
async function readBancoHorasTable(
  token: string,
  driveId: string,
  itemId: string
): Promise<BancoHorasItem[]> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/tables/BancoHoras/rows`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } }
    throw new Error(`Error leyendo tabla BancoHoras: ${err?.error?.message ?? res.status}`)
  }

  const data = await res.json() as { value: Array<{ values: unknown[][] }> }

  return data.value
    .map((row) => ({
      project:    String(row.values[0][0] ?? '').trim(),
      totalHours: Number(row.values[0][1] ?? 0),
    }))
    .filter((item) => item.project !== '' && !isNaN(item.totalHours) && item.totalHours > 0)
}

// Función principal que ejecuta los 3 pasos
export async function fetchBancoHorasFromGraph(): Promise<BancoHorasItem[]> {
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
