import type { HuchaExcelData, ExcelProyecto } from '@/lib/hucha/sync'

function encodeShareUrl(url: string): string {
  return 'u!' + Buffer.from(url).toString('base64url')
}

async function getToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.AZURE_CLIENT_ID!,
        client_secret: process.env.AZURE_CLIENT_SECRET!,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      }),
    }
  )
  if (!res.ok) throw new Error(`Token Azure: ${await res.text()}`)
  return ((await res.json()) as { access_token: string }).access_token
}

async function gget(token: string, url: string): Promise<any> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json()
  if (!res.ok) throw new Error(`Graph ${url}: ${JSON.stringify(body)}`)
  return body
}

export async function fetchHuchaExcel(): Promise<HuchaExcelData> {
  const fileUrl = process.env.SHAREPOINT_HUCHA_FILE_URL
  if (!fileUrl) throw new Error('SHAREPOINT_HUCHA_FILE_URL no está configurada')
  const token = await getToken()
  const item = await gget(token, `https://graph.microsoft.com/v1.0/shares/${encodeShareUrl(fileUrl)}/driveItem`)
  const base = `https://graph.microsoft.com/v1.0/drives/${item.parentReference.driveId}/items/${item.id}/workbook`

  // ProyectosHucha_1: [Proyecto, Hucha]
  const ph = await gget(token, `${base}/tables/ProyectosHucha_1/rows`)
  const proyectos: ExcelProyecto[] = (ph.value as Array<{ values: unknown[][] }>)
    .map((r) => ({ proyecto: String(r.values[0][0] ?? '').trim(), hucha: Number(r.values[0][1] ?? 0) }))
    .filter((p) => p.proyecto !== '')

  // Clientes_Proyectos: localizar columnas Proyecto y "Manager del proyecto"
  const cols = await gget(token, `${base}/tables/Clientes_Proyectos/columns`)
  const names = (cols.value as Array<{ name: string }>).map((c) => c.name)
  const iProj = names.indexOf('Proyecto')
  const iMgr = names.indexOf('Manager del proyecto')
  const managerPorProyecto = new Map<string, string>()
  if (iProj >= 0 && iMgr >= 0) {
    const cp = await gget(token, `${base}/tables/Clientes_Proyectos/rows`)
    for (const r of cp.value as Array<{ values: unknown[][] }>) {
      const proj = String(r.values[0][iProj] ?? '').trim()
      const mgr = String(r.values[0][iMgr] ?? '').trim()
      if (proj) managerPorProyecto.set(proj, mgr)
    }
  }

  return { proyectos, managerPorProyecto }
}
