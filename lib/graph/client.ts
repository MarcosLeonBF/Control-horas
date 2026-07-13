import { unstable_cache } from 'next/cache'
import type { BancoHorasProyecto } from '@/lib/types'

export const BANCO_HORAS_TAG = 'banco-horas'

// Codifica la URL del archivo en el formato que espera el endpoint /shares de Graph API
function encodeShareUrl(url: string): string {
  return 'u!' + Buffer.from(url).toString('base64url')
}

// Normaliza nombres de cabecera: minúsculas y sin acentos (casa "Fecha", "Fecha Auditoría"…).
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

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
  // Columna "Fecha" (opcional, case/acentos-insensitive): mes de la asignación.
  // El resto de columnas 1..n son posiciones. Col 0 = proyecto.
  const fechaIdx = header.findIndex((h) => norm(h) === 'fecha')
  const posCols = header
    .map((h, col) => ({ position: String(h ?? '').trim(), col }))
    .filter((c) => c.col !== 0 && c.col !== fechaIdx && c.position !== '')
  const rows = (await rowsRes.json() as { value: Array<{ values: unknown[][] }> }).value

  // project → month ('' = sin fecha) → position → hours.
  // Dentro de un mismo (proyecto, mes), fila/columna repetida = bug de datos:
  // la primera aparición gana (misma política defensiva que antes por proyecto).
  const byProject = new Map<string, Map<string, Map<string, number>>>()
  for (const row of rows) {
    const cells = row.values[0]
    const project = String(cells[0] ?? '').trim()
    if (project === '') continue
    const month = fechaIdx === -1 ? '' : excelDateToISO(cells[fechaIdx]).slice(0, 7)
    if (fechaIdx !== -1 && month === '') {
      // Error de datos (spec §6): cuenta en totales, no aparece en ningún mes.
      console.warn(`[banco-horas] fila sin fecha válida en el Excel: "${project}"`)
    }
    let months = byProject.get(project)
    if (!months) { months = new Map(); byProject.set(project, months) }
    let bucket = months.get(month)
    if (!bucket) { bucket = new Map(); months.set(month, bucket) }
    for (const { position, col } of posCols) {
      const hours = Number(cells[col] ?? 0)
      if (isNaN(hours)) continue
      if (!bucket.has(position)) bucket.set(position, hours)
    }
  }

  // Totales por posición = Σ de todos los meses (incluida la clave '' sin fecha).
  const result: BancoHorasProyecto[] = []
  for (const [project, months] of byProject) {
    const totals = new Map<string, number>()
    for (const bucket of months.values()) {
      for (const [position, hours] of bucket) totals.set(position, (totals.get(position) ?? 0) + hours)
    }
    const monthList = [...months.entries()]
      .filter(([month]) => month !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, bucket]) => ({
        month,
        positions: [...bucket.entries()].map(([position, hours]) => ({ position, hours })),
      }))
    result.push({
      project,
      positions: [...totals.entries()].map(([position, hours]) => ({ position, hours })),
      months: monthList,
    })
  }
  return result
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
export interface ProyectoEstado {
  project: string
  estado: string
  manager: string
  fechaAuditoria: string
  tipoContrato: string   // "Tipo de Contrato" (para horas provisionales)
  inicioContable: string // "Fecha Inicio Contable" ISO o ''
  finContable: string    // "Fecha Fin Contable" ISO o ''
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
  const projIdx = header.findIndex((h) => norm(h) === 'proyecto')
  const estadoIdx = header.findIndex((h) => norm(h) === 'estado')
  if (projIdx === -1 || estadoIdx === -1) {
    throw new Error(`La hoja ${sheet} necesita columnas "Proyecto" y "Estado".`)
  }
  // Opcionales: manager del proyecto y fecha de auditoría (filtros de Bancos).
  const managerIdx = header.findIndex((h) => norm(h) === 'manager del proyecto')
  const auditIdx = header.findIndex((h) => norm(h) === 'fecha auditoria')
  const tipoIdx = header.findIndex((h) => norm(h) === 'tipo de contrato')
  const inicioIdx = header.findIndex((h) => norm(h) === 'fecha inicio contable')
  const finIdx = header.findIndex((h) => norm(h) === 'fecha fin contable')

  return values
    .slice(1)
    .map((cells) => ({
      project: String(cells[projIdx] ?? '').trim(),
      estado: String(cells[estadoIdx] ?? '').trim(),
      manager: managerIdx === -1 ? '' : String(cells[managerIdx] ?? '').trim(),
      fechaAuditoria: auditIdx === -1 ? '' : excelDateToISO(cells[auditIdx]),
      tipoContrato: tipoIdx === -1 ? '' : String(cells[tipoIdx] ?? '').trim(),
      inicioContable: inicioIdx === -1 ? '' : excelDateToISO(cells[inicioIdx]),
      finContable: finIdx === -1 ? '' : excelDateToISO(cells[finIdx]),
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

// ── Horas provisionales (hoja "Horas_Provisionales" del mismo Excel) ──────────
// Primera columna = tipo de contrato; columnas siguientes = posiciones (mismas que
// BancoHoras). Cada celda = horas/mes provisionales de esa posición para ese contrato.
export type HorasProvisionales = Map<string, Map<string, number>>

async function readTarifaProvisionalSheet(
  token: string,
  driveId: string,
  itemId: string,
  sheet: string,
): Promise<HorasProvisionales> {
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets/${encodeURIComponent(sheet)}/usedRange(valuesOnly=true)`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(`Error leyendo hoja ${sheet}: ${err?.error?.message ?? res.status}`)
  }
  const values = (await res.json() as { values: unknown[][] }).values ?? []
  if (values.length < 2) return new Map()

  const header = values[0]
  const posCols = header
    .map((h, col) => ({ position: String(h ?? '').trim(), col }))
    .filter((c) => c.col !== 0 && c.position !== '')

  const out: HorasProvisionales = new Map()
  for (const cells of values.slice(1)) {
    const tipo = String(cells[0] ?? '').trim()
    if (tipo === '') continue
    const porPos = new Map<string, number>()
    for (const { position, col } of posCols) {
      const hours = Number(cells[col] ?? 0)
      if (!isNaN(hours)) porPos.set(position, hours)
    }
    out.set(tipo, porPos)
  }
  return out
}

// unstable_cache serializa su valor a JSON: un Map se perdería (vuelve como objeto
// plano sin .get). Cacheamos la forma serializable (entries) y reconstruimos el Map al
// leer, para que los consumidores sigan usando .get().
type HorasProvEntries = [string, [string, number][]][]

async function fetchHorasProvEntriesFromGraph(): Promise<HorasProvEntries> {
  const fileUrl = process.env.SHAREPOINT_FILE_URL
  if (!fileUrl) throw new Error('SHAREPOINT_FILE_URL no está configurada')
  const token = await getToken()
  const { driveId, itemId } = await resolveDriveItem(token, fileUrl)
  const map = await readTarifaProvisionalSheet(token, driveId, itemId, 'Horas_Provisionales')
  return [...map].map(([tipo, ps]) => [tipo, [...ps]])
}

const getCachedHorasProvEntries = unstable_cache(
  fetchHorasProvEntriesFromGraph,
  ['horas-provisionales-entries'], // key nueva: invalida cualquier caché viejo con el Map roto
  { revalidate: 300, tags: [BANCO_HORAS_TAG] },
)

export async function getCachedHorasProvisionales(): Promise<HorasProvisionales> {
  const entries = await getCachedHorasProvEntries()
  return new Map(entries.map(([tipo, ps]) => [tipo, new Map(ps)]))
}

// ── Horas provisionales de SETUP (hoja "Horas_Provisionales_Setup") ───────────
// Misma estructura que Horas_Provisionales (tipo contrato × posición), con los valores
// del mes de arranque. Se aplica solo al primer mes (Fecha Inicio Contable) de un
// proyecto sin registros en BancoHoras; el resto usa la tarifa normal.
async function fetchHorasProvSetupEntriesFromGraph(): Promise<HorasProvEntries> {
  const fileUrl = process.env.SHAREPOINT_FILE_URL
  if (!fileUrl) throw new Error('SHAREPOINT_FILE_URL no está configurada')
  const token = await getToken()
  const { driveId, itemId } = await resolveDriveItem(token, fileUrl)
  const map = await readTarifaProvisionalSheet(token, driveId, itemId, 'Horas_Provisionales_Setup')
  return [...map].map(([tipo, ps]) => [tipo, [...ps]])
}

const getCachedHorasProvSetupEntries = unstable_cache(
  fetchHorasProvSetupEntriesFromGraph,
  ['horas-provisionales-setup-entries'],
  { revalidate: 300, tags: [BANCO_HORAS_TAG] },
)

export async function getCachedHorasProvisionalesSetup(): Promise<HorasProvisionales> {
  const entries = await getCachedHorasProvSetupEntries()
  return new Map(entries.map(([tipo, ps]) => [tipo, new Map(ps)]))
}
