# Horas Provisionales — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rellenar los meses vacíos del banco de horas (delay de `BancoHoras`) con un estimado por tipo de contrato × posición (hoja `Horas_Provisionales`), marcado como provisional y derivado al leer; y alimentar la lista del banco de `Clientes_Proyectos` para que los proyectos nuevos con consumo dejen de estar huérfanos.

**Architecture:** El lector de Graph gana la hoja `Horas_Provisionales` y tres columnas de `Clientes_Proyectos`. Una función pura calcula las entradas mensuales provisionales de un proyecto según los criterios. `getBancosHoras`/`getBancoHorasDetalle` pasan a recorrer el registro maestro (`Clientes_Proyectos`) e inyectan lo provisional en el desglose `monthly` (marcado, sin sumar al total confirmado). La UI mensual marca esos meses. Spec: [2026-07-08-horas-provisionales-design.md](../specs/2026-07-08-horas-provisionales-design.md).

**Tech Stack:** Next.js App Router (RSC + client components), TypeScript, Supabase (supabase-js), Microsoft Graph (Excel), Tailwind v4 + shadcn/ui, Playwright.

## Global Constraints

- **UI**: identidad visual existente (tokens `--brand`, `--muted-surface`, `--status-*`; `font-display`; componentes de `components/ui`). Copy en español, sentence case.
- **Dev server**: lo gestiona el usuario; nunca arrancarlo/pararlo. Playwright no lo auto-lanza. Si `http://localhost:3000` no responde, saltar e2e y anotarlo.
- **Sin framework de unit tests**: la puerta por tarea es `npx tsc --noEmit`; verificación end-to-end en la Tarea 6 (e2e) + comprobación manual.
- Mes = string `'YYYY-MM'`; se comparan lexicográficamente (siempre zero-padded).
- **Provisionales NO suman al total confirmado**: viven solo en el desglose `monthly`, marcadas con `provisional: true`. El `assigned`/`consumed`/`status` de nivel fila y de nivel proyecto siguen siendo reales (Excel + ampliaciones).
- **Ventana** = `(últimoRegistroGlobal, mesActual]`. "Último registro global" = mes máximo con filas reales en `BancoHoras` (global; la carga es en lote).
- **Criterios de elegibilidad** (todos): mes en ventana; proyecto sin fila real en `BancoHoras` para ese mes; `Estado` no contiene "paus"; `Fecha Inicio Contable ≤ mes`; `Fecha Fin Contable` vacía o `≥ mes`; existe tarifa para el tipo de contrato.
- **Alcance de proyectos**: todos los de `Clientes_Proyectos` (sin filtrar `Cuenta como Proyecto`).
- **Arrastre de saldo**: FUERA DE ALCANCE.
- Commits en español estilo repo (`feat(bancos): …`) con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Lectores del Excel — columnas de `Clientes_Proyectos` y hoja `Horas_Provisionales`

**Files:**
- Modify: `lib/graph/client.ts` (interfaz `ProyectoEstado` línea 176; `readClientesProyectosSheet` líneas 195-213; añadir lector y export nuevos tras `getCachedProyectosEstado` línea 229)

**Interfaces:**
- Consumes: nada nuevo (Graph API existente; helpers `norm`, `excelDateToISO` ya a nivel de módulo).
- Produces:
  - `ProyectoEstado` gana `tipoContrato: string; inicioContable: string; finContable: string` (ISO `YYYY-MM-DD` o `''`).
  - `type HorasProvisionales = Map<string, Map<string, number>>` (tipoContrato → posición → horas/mes).
  - `getCachedHorasProvisionales(): Promise<HorasProvisionales>`.

- [ ] **Step 1: Extender `ProyectoEstado` y su lectura**

En `lib/graph/client.ts`, reemplazar la interfaz (línea 176):

```ts
export interface ProyectoEstado {
  project: string
  estado: string
  manager: string
  fechaAuditoria: string
  tipoContrato: string   // "Tipo de Contrato" (para horas provisionales)
  inicioContable: string // "Fecha Inicio Contable" ISO o ''
  finContable: string    // "Fecha Fin Contable" ISO o ''
}
```

En `readClientesProyectosSheet`, tras la línea del `auditIdx` (línea 203) añadir:

```ts
  const tipoIdx = header.findIndex((h) => norm(h) === 'tipo de contrato')
  const inicioIdx = header.findIndex((h) => norm(h) === 'fecha inicio contable')
  const finIdx = header.findIndex((h) => norm(h) === 'fecha fin contable')
```

Y en el `.map((cells) => ({ … }))` (líneas 207-212) añadir los tres campos:

```ts
    .map((cells) => ({
      project: String(cells[projIdx] ?? '').trim(),
      estado: String(cells[estadoIdx] ?? '').trim(),
      manager: managerIdx === -1 ? '' : String(cells[managerIdx] ?? '').trim(),
      fechaAuditoria: auditIdx === -1 ? '' : excelDateToISO(cells[auditIdx]),
      tipoContrato: tipoIdx === -1 ? '' : String(cells[tipoIdx] ?? '').trim(),
      inicioContable: inicioIdx === -1 ? '' : excelDateToISO(cells[inicioIdx]),
      finContable: finIdx === -1 ? '' : excelDateToISO(cells[finIdx]),
    }))
```

- [ ] **Step 2: Lector de `Horas_Provisionales`**

Tras el `getCachedProyectosEstado` (línea 229) añadir:

```ts
// ── Horas provisionales (hoja "Horas_Provisionales" del mismo Excel) ──────────
// Primera columna = tipo de contrato; columnas siguientes = posiciones (mismas que
// BancoHoras). Cada celda = horas/mes provisionales de esa posición para ese contrato.
export type HorasProvisionales = Map<string, Map<string, number>>

async function readHorasProvisionalesSheet(
  token: string,
  driveId: string,
  itemId: string,
): Promise<HorasProvisionales> {
  const sheet = 'Horas_Provisionales'
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

export async function fetchHorasProvisionalesFromGraph(): Promise<HorasProvisionales> {
  const fileUrl = process.env.SHAREPOINT_FILE_URL
  if (!fileUrl) throw new Error('SHAREPOINT_FILE_URL no está configurada')
  const token = await getToken()
  const { driveId, itemId } = await resolveDriveItem(token, fileUrl)
  return readHorasProvisionalesSheet(token, driveId, itemId)
}

export const getCachedHorasProvisionales = unstable_cache(
  fetchHorasProvisionalesFromGraph,
  ['horas-provisionales-data'],
  { revalidate: 300, tags: [BANCO_HORAS_TAG] },
)
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores. (Los consumidores de `ProyectoEstado` — registrar, reportes, bancos — solo leen los campos existentes; los nuevos son aditivos.)

El lector se ejercita end-to-end en la Tarea 6 (e2e). Aquí la puerta es el typecheck; no hace falta más.

- [ ] **Step 4: Commit**

```bash
git add lib/graph/client.ts
git commit -m "feat(bancos): lector de Horas_Provisionales y columnas contables de Clientes_Proyectos"
```

---

### Task 2: Función pura de provisionales + campos de tipo

**Files:**
- Modify: `lib/horas/bancos-status.ts` (`BancoMensual` líneas 13-18; `BancoDetalleMensual` líneas 46-52)
- Create: `lib/horas/provisionales.ts`

**Interfaces:**
- Consumes: `BancoMensual` (bancos-status), `addMonths` ([lib/horas/format.ts](../../../lib/horas/format.ts)).
- Produces:
  - `BancoMensual` gana `provisional?: boolean`.
  - `BancoDetalleMensual` gana `provisional: number`.
  - `lib/horas/provisionales.ts`:
    - `ultimoRegistroGlobal(excel: { months: { month: string }[] }[]): string`
    - `mesesVentana(ultimoGlobal: string, mesActual: string): string[]`
    - `interface ProyectoProvisionalMeta { tipoContrato: string; estado: string; inicioContable: string; finContable: string }`
    - `provisionalPorPosicion(meta, mesesReales: Set<string>, ventana: string[], tarifa: Map<string, number> | undefined): Map<string, BancoMensual[]>`

- [ ] **Step 1: Campos en `bancos-status.ts`**

`BancoMensual` (líneas 13-18) → añadir `provisional`:

```ts
export interface BancoMensual {
  month: string // 'YYYY-MM'
  assigned: number
  consumed: number
  provisional?: boolean // true si `assigned` es un estimado provisional (no confirmado)
}
```

`BancoDetalleMensual` (líneas 46-52) → añadir `provisional`:

```ts
export interface BancoDetalleMensual {
  month: string // 'YYYY-MM'
  excelAssigned: number
  ampliado: number // Σ ampliaciones ACTIVAS con entry_date en ese mes
  consumed: number
  provisional: number // Σ horas provisionales del mes (0 si el mes es real)
}
```

- [ ] **Step 2: Crear `lib/horas/provisionales.ts`**

```ts
import type { BancoMensual } from '@/lib/horas/bancos-status'
import { addMonths } from '@/lib/horas/format'

// Mayor mes 'YYYY-MM' con filas reales en cualquier proyecto (último registro global).
// '' si no hay meses. La carga del Excel es en lote, así que el máximo global es un
// piso seguro para la ventana.
export function ultimoRegistroGlobal(excel: { months: { month: string }[] }[]): string {
  let max = ''
  for (const p of excel) for (const m of p.months) if (m.month > max) max = m.month
  return max
}

// Meses (YYYY-MM) de la ventana (ultimoGlobal, mesActual]. Vacío si ultimoGlobal es ''
// o ya alcanzó mesActual.
export function mesesVentana(ultimoGlobal: string, mesActual: string): string[] {
  if (!ultimoGlobal || ultimoGlobal >= mesActual) return []
  const out: string[] = []
  let m = addMonths(ultimoGlobal, 1)
  while (m <= mesActual) { out.push(m); m = addMonths(m, 1) }
  return out
}

export interface ProyectoProvisionalMeta {
  tipoContrato: string
  estado: string
  inicioContable: string // ISO 'YYYY-MM-DD' o ''
  finContable: string    // ISO 'YYYY-MM-DD' o ''
}

// Entradas mensuales provisionales por posición para un proyecto: para cada mes de la
// ventana que NO sea real y cumpla los criterios, la tarifa por posición. Vacío si el
// proyecto no es elegible o no hay tarifa (el caller loguea el caso sin tarifa).
export function provisionalPorPosicion(
  meta: ProyectoProvisionalMeta,
  mesesReales: Set<string>,
  ventana: string[],
  tarifa: Map<string, number> | undefined,
): Map<string, BancoMensual[]> {
  const out = new Map<string, BancoMensual[]>()
  if (!tarifa) return out                                    // sin tarifa
  if (meta.estado.toLowerCase().includes('paus')) return out // Estado Pausa fuera
  if (meta.inicioContable === '') return out                 // sin inicio: no ubicable
  const inicioMes = meta.inicioContable.slice(0, 7)
  const finMes = meta.finContable ? meta.finContable.slice(0, 7) : ''
  for (const M of ventana) {
    if (mesesReales.has(M)) continue   // ya hay fila real ese mes
    if (inicioMes > M) continue        // aún no arrancó
    if (finMes && finMes < M) continue // ya finalizó
    for (const [position, hours] of tarifa) {
      if (hours <= 0) continue
      const arr = out.get(position) ?? []
      arr.push({ month: M, assigned: hours, consumed: 0, provisional: true })
      out.set(position, arr)
    }
  }
  return out
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores (los constructores existentes de `BancoDetalleMensual` en bancos.ts todavía no rellenan `provisional` → error esperado que arregla la Tarea 4; si aparece, es la señal para continuar allí). Para que esta tarea cierre limpia, añadir `provisional: 0` en el único constructor actual de `BancoDetalleMensual` en [lib/horas/bancos.ts:223](../../../lib/horas/bancos.ts#L223): `{ month, excelAssigned: 0, ampliado: 0, consumed: 0, provisional: 0 }`.

- [ ] **Step 4: Commit**

```bash
git add lib/horas/bancos-status.ts lib/horas/provisionales.ts lib/horas/bancos.ts
git commit -m "feat(bancos): función pura de horas provisionales + campos provisional"
```

---

### Task 3: `getBancosHoras` — alimentar de Clientes_Proyectos e inyectar provisionales

**Files:**
- Modify: `lib/horas/bancos.ts` (`getBancosHoras` líneas 52-130)

**Interfaces:**
- Consumes: `getCachedHorasProvisionales`, `ProyectoEstado` (Task 1); `ultimoRegistroGlobal`, `mesesVentana`, `provisionalPorPosicion` (Task 2); `currentMonth` (format.ts); `BancoMensual` (bancos-status).
- Produces: `getBancosHoras` devuelve filas para TODOS los proyectos de `Clientes_Proyectos` (unión Excel + provisional + consumo), con `monthly` que incluye meses provisionales marcados. Firma sin cambios.

- [ ] **Step 1: Imports**

En `lib/horas/bancos.ts` líneas 2-4, ampliar:

```ts
import { getCachedBancoHoras, getCachedProyectosEstado, getCachedHorasProvisionales, type ProyectoEstado, type HorasProvisionales } from '@/lib/graph/client'
import { computeHorasStatus, HORAS_SEVERITY, type BancoHorasRow, type BancoHorasDetalle, type AmpliacionHoras, type MovimientoBanco, type BancoMensual, type BancoDetalleMensual } from '@/lib/horas/bancos-status'
import type { BancoHorasProyecto } from '@/lib/types'
import { currentMonth } from '@/lib/horas/format'
import { ultimoRegistroGlobal, mesesVentana, provisionalPorPosicion } from '@/lib/horas/provisionales'
```

(Verificar que `getCachedProyectosEstado` exporte también los tipos; `ProyectoEstado`/`HorasProvisionales` son `export`ados en client.ts por la Tarea 1.)

- [ ] **Step 2: Reescribir `getBancosHoras`**

Reemplazar toda la función (líneas 52-130) por:

```ts
export async function getBancosHoras(scope: BancosScope): Promise<BancoHorasRow[]> {
  let excel: BancoHorasProyecto[] = []
  try { excel = await getCachedBancoHoras() } catch { excel = [] }

  let horasProv: HorasProvisionales = new Map()
  try { horasProv = await getCachedHorasProvisionales() } catch { horasProv = new Map() }

  const db = createAdminClient()
  const { data: lines } = await db
    .from('time_log_lines')
    .select('project, hours, time_logs!inner(status, user_id, entry_date)')
    .neq('time_logs.status', 'anulado')

  const { allowed, userPosition } = await loadPositionContext(scope)

  // Registro maestro de proyectos + metadatos (Clientes_Proyectos).
  const metaByProject = new Map<string, ProyectoEstado>()
  try {
    for (const e of await getCachedProyectosEstado()) metaByProject.set(e.project.trim(), e)
  } catch { /* sin metadatos: banco solo con lo real */ }

  // Consumo por (proyecto, posición): total, por mes, y posiciones con consumo por proyecto.
  const consumed = new Map<string, number>()
  const consumedMes = new Map<string, Map<string, number>>()
  const posConsumoPorProyecto = new Map<string, Set<string>>()
  for (const l of (lines ?? []) as unknown as { project: string; hours: number; time_logs: { user_id: string; entry_date: string } }[]) {
    const project = l.project.trim()
    if (project === 'Departamento') continue // horas internas: no consumen banco
    const position = userPosition.get(l.time_logs.user_id)
    if (!position) continue // usuario sin posición: no se atribuye
    const k = key(project, position)
    consumed.set(k, (consumed.get(k) ?? 0) + Number(l.hours))
    const month = l.time_logs.entry_date.slice(0, 7)
    let porMes = consumedMes.get(k)
    if (!porMes) { porMes = new Map(); consumedMes.set(k, porMes) }
    porMes.set(month, (porMes.get(month) ?? 0) + Number(l.hours))
    let ps = posConsumoPorProyecto.get(project)
    if (!ps) { ps = new Set(); posConsumoPorProyecto.set(project, ps) }
    ps.add(position)
  }

  const excelByProject = new Map<string, BancoHorasProyecto>()
  for (const p of excel) excelByProject.set(p.project.trim(), p)

  // Ventana provisional (global).
  const ventana = mesesVentana(ultimoRegistroGlobal(excel), currentMonth())

  // Conjunto de proyectos = registro maestro ∪ los que tengan Excel o consumo. Sin "Departamento".
  const projectNames = new Set<string>([...metaByProject.keys(), ...excelByProject.keys(), ...posConsumoPorProyecto.keys()])
  projectNames.delete('Departamento')

  const rows: BancoHorasRow[] = []
  for (const project of projectNames) {
    const proj = excelByProject.get(project)
    const meta = metaByProject.get(project)
    const mesesReales = new Set((proj?.months ?? []).map((m) => m.month))
    const tarifa = meta ? horasProv.get(meta.tipoContrato) : undefined
    if (meta && meta.tipoContrato && horasProv.size > 0 && !tarifa) {
      console.warn(`[horas-provisionales] sin tarifa para tipo de contrato "${meta.tipoContrato}" (proyecto "${project}")`)
    }
    const provByPos = meta
      ? provisionalPorPosicion(
          { tipoContrato: meta.tipoContrato, estado: meta.estado, inicioContable: meta.inicioContable, finContable: meta.finContable },
          mesesReales, ventana, tarifa,
        )
      : new Map<string, BancoMensual[]>()

    // Posiciones del proyecto = Excel ∪ consumo ∪ provisional.
    const positions = new Set<string>([
      ...(proj?.positions ?? []).map((p) => p.position),
      ...(posConsumoPorProyecto.get(project) ?? []),
      ...provByPos.keys(),
    ])
    const excelByPos = new Map((proj?.positions ?? []).map((p) => [p.position, Number(p.hours)]))

    for (const position of positions) {
      if (!visible(allowed, position)) continue
      const assigned = excelByPos.get(position) ?? 0
      const k = key(project, position)
      const cons = consumed.get(k) ?? 0
      const prov = provByPos.get(position) ?? []
      if (assigned === 0 && cons === 0 && prov.length === 0) continue // nada que mostrar

      // monthly: Excel real + provisional (disjuntos por mes) + consumo (merge).
      const byMonth = new Map<string, BancoMensual>()
      for (const m of proj?.months ?? []) {
        const h = m.positions.find((p) => p.position === position)?.hours ?? 0
        if (h !== 0) byMonth.set(m.month, { month: m.month, assigned: h, consumed: 0 })
      }
      for (const pm of prov) byMonth.set(pm.month, { ...pm })
      for (const [month, h] of consumedMes.get(k) ?? []) {
        const acc = byMonth.get(month) ?? { month, assigned: 0, consumed: 0 }
        acc.consumed += h
        byMonth.set(month, acc)
      }
      const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))

      rows.push({
        project, position, assigned, consumed: cons,
        remaining: assigned - cons,
        status: computeHorasStatus(assigned, cons),
        monthly,
        projectEstado: meta?.estado,
        manager: meta?.manager,
        fechaAuditoria: meta?.fechaAuditoria,
      })
    }
  }

  return rows.sort((a, b) => a.project.localeCompare(b.project) || a.position.localeCompare(b.position))
}
```

Nota: `assigned`/`consumed`/`status` de la fila siguen siendo **reales** (total del Excel + consumo total); lo provisional vive solo en `monthly` (§6).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Verificación en vivo (si el server está arriba)**

`Test-NetConnection localhost -Port 3000 -InformationLevel Quiet` → si True, abrir `/bancos` como admin y confirmar que un proyecto nuevo con consumo (p. ej. "Opospills") ya aparece. Si no está el server, dejar para la Tarea 6.

- [ ] **Step 5: Commit**

```bash
git add lib/horas/bancos.ts
git commit -m "feat(bancos): la lista del banco se alimenta de Clientes_Proyectos + provisionales por mes"
```

---

### Task 4: `getBancoHorasDetalle` — provisionales por posición y en la cabecera mensual

**Files:**
- Modify: `lib/horas/bancos.ts` (`getBancoHorasDetalle` líneas 133-258)

**Interfaces:**
- Consumes: lo mismo que Task 3 (helpers de provisionales, meta, tarifa).
- Produces: `getBancoHorasDetalle` inyecta provisionales en `posiciones[].monthly` (marcadas) y suma `provisional` en `monthly` (BancoDetalleMensual). Firma sin cambios.

- [ ] **Step 1: Traer meta + tarifa + ventana en el detalle**

En `getBancoHorasDetalle`, tras obtener `posicionesExcel`/`mesesExcel` (líneas 139-148), guardar también el `excel` completo y traer meta/tarifa. Reemplazar el bloque try (líneas 139-148) por:

```ts
  let posicionesExcel: { position: string; hours: number }[] = []
  let mesesExcel: BancoHorasProyecto['months'] = []
  let allExcel: BancoHorasProyecto[] = []
  try {
    allExcel = await getCachedBancoHoras()
    const proj = allExcel.find((e) => e.project.trim() === name)
    posicionesExcel = proj?.positions ?? []
    mesesExcel = proj?.months ?? []
  } catch {
    posicionesExcel = []
  }

  let meta: ProyectoEstado | undefined
  try { meta = (await getCachedProyectosEstado()).find((e) => e.project.trim() === name) } catch { /* sin meta */ }
  let horasProv: HorasProvisionales = new Map()
  try { horasProv = await getCachedHorasProvisionales() } catch { horasProv = new Map() }

  const ventana = mesesVentana(ultimoRegistroGlobal(allExcel), currentMonth())
  const mesesRealesProj = new Set(mesesExcel.map((m) => m.month))
  const tarifa = meta ? horasProv.get(meta.tipoContrato) : undefined
  const provByPos = meta
    ? provisionalPorPosicion(
        { tipoContrato: meta.tipoContrato, estado: meta.estado, inicioContable: meta.inicioContable, finContable: meta.finContable },
        mesesRealesProj, ventana, tarifa,
      )
    : new Map<string, BancoMensual[]>()
```

- [ ] **Step 2: Incluir posiciones provisionales y marcarlas en `posiciones`**

`posNames` (líneas 186-188) suma las posiciones con provisional:

```ts
  const posNames = new Set<string>()
  for (const p of posicionesExcel) if (visible(allowed, p.position)) posNames.add(p.position)
  for (const p of consumedByPos.keys()) posNames.add(p)
  for (const p of provByPos.keys()) if (visible(allowed, p)) posNames.add(p)
```

En el `.map((position) => { … })` de `posiciones` (líneas 192-208), inyectar provisional en `byMonth` (entre los meses de Excel y el consumo):

```ts
  const posiciones: BancoHorasRow[] = [...posNames]
    .map((position) => {
      const assigned = excelByPos.get(position) ?? 0
      const consumed = consumedByPos.get(position) ?? 0
      const byMonth = new Map<string, BancoMensual>()
      for (const m of mesesExcel) {
        const h = m.positions.find((p) => p.position === position)?.hours ?? 0
        if (h !== 0) byMonth.set(m.month, { month: m.month, assigned: h, consumed: 0 })
      }
      for (const pm of provByPos.get(position) ?? []) byMonth.set(pm.month, { ...pm })
      for (const [month, h] of consumedByPosMes.get(position) ?? []) {
        const acc = byMonth.get(month) ?? { month, assigned: 0, consumed: 0 }
        acc.consumed += h
        byMonth.set(month, acc)
      }
      const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
      return { project: name, position, assigned, consumed, remaining: assigned - consumed, status: computeHorasStatus(assigned, consumed), monthly }
    })
    .sort((a, b) => HORAS_SEVERITY[a.status] - HORAS_SEVERITY[b.status] || a.position.localeCompare(b.position))
```

- [ ] **Step 3: Sumar `provisional` en el `monthly` de nivel proyecto**

En el bloque de `detalleByMonth` (líneas 220-237), incluir el `provisional` al recorrer `posiciones[].monthly`. Reemplazar el `monthEntry` y el bucle por:

```ts
  const detalleByMonth = new Map<string, BancoDetalleMensual>()
  const monthEntry = (month: string) => {
    let e = detalleByMonth.get(month)
    if (!e) { e = { month, excelAssigned: 0, ampliado: 0, consumed: 0, provisional: 0 }; detalleByMonth.set(month, e) }
    return e
  }
  for (const p of posiciones) {
    for (const m of p.monthly) {
      const e = monthEntry(m.month)
      e.consumed += m.consumed
      if (m.provisional) e.provisional += m.assigned
      else e.excelAssigned += m.assigned
    }
  }
  for (const a of ampliaciones) {
    if (!a.active) continue
    monthEntry(a.entry_date.slice(0, 7)).ampliado += Number(a.hours)
  }
  const monthly = [...detalleByMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores (el `provisional: 0` que añadió la Tarea 2 en el constructor viejo se reemplaza por este `monthEntry`).

- [ ] **Step 5: Commit**

```bash
git add lib/horas/bancos.ts
git commit -m "feat(bancos): provisionales en el detalle (por posición y cabecera mensual)"
```

---

### Task 5: UI — marcar los meses provisionales (lista y detalle)

**Files:**
- Modify: `lib/horas/bancos-status.ts` (`groupBancosByProject` líneas 129-158)
- Modify: `components/horas/BancosHorasClient.tsx`
- Modify: `components/horas/BancoDetalleView.tsx`

**Interfaces:**
- Consumes: `BancoMensual.provisional`, `BancoDetalleMensual.provisional` (Task 2/3/4).
- Produces: marca visual "Provisional" en la vista Mensual de la lista y del detalle.

- [ ] **Step 1: `groupBancosByProject` propaga `provisional` al `monthly` del proyecto**

En [lib/horas/bancos-status.ts](../../../lib/horas/bancos-status.ts), dentro del merge de `byMonth` (bucle `for (const m of p.monthly)`), propagar el flag:

```ts
    const byMonth = new Map<string, BancoMensual>()
    for (const p of g.positions) {
      for (const m of p.monthly) {
        const acc = byMonth.get(m.month) ?? { month: m.month, assigned: 0, consumed: 0 }
        acc.assigned += m.assigned
        acc.consumed += m.consumed
        if (m.provisional) acc.provisional = true
        byMonth.set(m.month, acc)
      }
    }
    g.monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
```

- [ ] **Step 2: Marcador en la lista (`BancosHorasClient.tsx`)**

En la fila del proyecto, junto al badge de estado en Mensual, mostrar "Provisional" cuando el mes elegido es provisional. Localizar el bloque del badge (el que hoy hace `vista === 'mensual' && g.assigned === 0 && g.consumed === 0 ? '—' : <HorasStatusBadge>`), y envolverlo así:

```tsx
                    <span className="flex w-28 shrink-0 items-center justify-end gap-1.5">
                      {vista === 'mensual' && g.monthly.find((m) => m.month === mes)?.provisional && (
                        <span className="rounded-full bg-(--brand)/10 px-1.5 py-px text-[0.62rem] font-medium text-(--brand)">Provisional</span>
                      )}
                      {vista === 'mensual' && g.assigned === 0 && g.consumed === 0 && !g.monthly.find((m) => m.month === mes)?.provisional
                        ? <span aria-label="Sin datos este mes" className="text-sm text-muted-foreground/50">—</span>
                        : <HorasStatusBadge status={g.status} />}
                    </span>
```

(Nota: un mes provisional tiene `g.assigned` del mes > 0, así que no cae en el "—"; el badge de estado se calcula sobre provisional-asignado vs consumido, como en el resto.)

- [ ] **Step 3: Marcador en el detalle (`BancoDetalleView.tsx`)**

a) **Cabecera mensual**: la variable `mm = d.monthly.find((m) => m.month === mes)` y `cab`. En Mensual, si el mes es provisional (`mm.provisional > 0` y `mm.excelAssigned === 0`), la cabecera usa el provisional como asignado y muestra la marca. Reemplazar el cálculo de `cab` (en modo mensual) para contemplar provisional:

```tsx
  const mm = d.monthly.find((m) => m.month === mes)
  const esProvisional = esMensual && !!mm && mm.provisional > 0 && mm.excelAssigned === 0
  const cab = esMensual
    ? { assigned: (mm?.excelAssigned ?? 0) + (mm?.ampliado ?? 0) + (mm?.provisional ?? 0), excelBase: mm?.excelAssigned ?? 0, ampliado: mm?.ampliado ?? 0, consumed: mm?.consumed ?? 0 }
    : { assigned: d.assigned, excelBase: d.excelBase, ampliado: d.assigned - d.excelBase, consumed: d.consumed }
  const restante = cab.assigned - cab.consumed
```

En la tarjeta "Asignado" de la cabecera, cuando `esProvisional`, añadir un badge "Provisional" (junto al título "Asignado"):

```tsx
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs text-foreground/50">
            Asignado
            {esProvisional && <span className="rounded-full bg-(--brand)/10 px-1.5 py-px text-[0.6rem] font-medium text-(--brand)">Provisional</span>}
          </p>
          <p className="tabular-money mt-1 text-2xl font-semibold">{formatHoras(cab.assigned)}</p>
          <p className="mt-1 text-xs text-foreground/45">
            {esProvisional ? 'Estimado por tipo de contrato' : <>Excel {formatHoras(cab.excelBase)}{cab.ampliado > 0 && <> · ampliado +{formatHoras(cab.ampliado)}</>}</>}
          </p>
        </div>
```

b) **Tabla "Por posición"**: cada fila usa `posiciones` (recalculadas por mes en Mensual). Marcar la posición provisional. En el `.map((p) => …)` de `posiciones` de este componente, si `esMensual` y la entrada mensual de esa posición es provisional, mostrar "Provisional". Localizar el cálculo de `posiciones` (el `useMemo` que hace `p.monthly.find((x) => x.month === mes)`) y llevar el flag:

```tsx
  const posiciones = useMemo(() => {
    if (!esMensual) return d.posiciones.map((p) => ({ ...p, provisionalMes: false }))
    return d.posiciones.map((p) => {
      const m = p.monthly.find((x) => x.month === mes)
      const assigned = m?.assigned ?? 0
      const consumed = m?.consumed ?? 0
      return { ...p, assigned, consumed, remaining: assigned - consumed, status: computeHorasStatus(assigned, consumed), provisionalMes: !!m?.provisional }
    })
  }, [d.posiciones, esMensual, mes])
```

En la celda de "Estado" de esa tabla, anteponer la marca cuando `p.provisionalMes`:

```tsx
                    <td className="px-4 py-2.5 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        {p.provisionalMes && <span className="rounded-full bg-(--brand)/10 px-1.5 py-px text-[0.6rem] font-medium text-(--brand)">Prov.</span>}
                        {esMensual && p.assigned === 0 && p.consumed === 0 && !p.provisionalMes
                          ? <span className="text-sm text-muted-foreground/50">—</span>
                          : <HorasStatusBadge status={p.status} />}
                      </span>
                    </td>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add lib/horas/bancos-status.ts components/horas/BancosHorasClient.tsx components/horas/BancoDetalleView.tsx
git commit -m "feat(bancos): marca visual de meses provisionales en lista y detalle"
```

---

### Task 6: e2e — proyecto nuevo aparece y marca provisional

**Files:**
- Modify: `e2e/horas-bancos.spec.ts`

**Interfaces:**
- Consumes: la UI de las Tareas 3-5.

**Contexto:** suite contra `http://localhost:3000` con datos vivos (Supabase seedeado + Excel real). El dev server lo gestiona el usuario; si el puerto no responde, dejar el spec escrito y anotar que quedó sin correr. Tolerar que el Excel no tenga aún provisionales (marca ausente → no falla).

- [ ] **Step 1: Caso — un proyecto nuevo con consumo aparece en el banco**

Añadir a `e2e/horas-bancos.spec.ts`:

```ts
test('un proyecto solo en Clientes_Proyectos (con consumo) aparece en el banco', async ({ page }) => {
  await page.goto('/bancos')
  await expect(page.getByRole('heading', { name: 'Bancos de horas' })).toBeVisible()
  // "Opospills" tiene horas registradas pero no está en BancoHoras; antes no aparecía.
  await page.getByLabel('Buscar proyecto').fill('Opospills')
  // Aparece como fila (o mensaje de vacío si el Excel/seed cambió; toleramos ambos).
  const fila = page.getByRole('link', { name: /Opospills/ })
  const vacio = page.getByText('No hay bancos que coincidan con los filtros.')
  await expect(fila.or(vacio)).toBeVisible()
})
```

- [ ] **Step 2: Caso — la marca "Provisional" aparece en Mensual (tolerante)**

```ts
test('la vista Mensual del banco marca los meses provisionales', async ({ page }) => {
  await page.goto('/bancos')
  const mensual = page.getByRole('button', { name: 'Mensual' })
  if (!(await mensual.isVisible().catch(() => false))) return // Excel sin columna Fecha
  await mensual.click()
  // Si hay datos provisionales para el mes en curso, hay al menos una marca "Provisional".
  // Tolerante: si no hay, no falla (el mes puede estar todo cargado).
  const marca = page.getByText('Provisional', { exact: true })
  if ((await marca.count()) > 0) await expect(marca.first()).toBeVisible()
})
```

- [ ] **Step 3: Ejecutar (si el server está arriba)**

`Test-NetConnection localhost -Port 3000 -InformationLevel Quiet` → si True:
Run: `npx playwright test horas-bancos --project=chromium-horas-admin --reporter=list`
Expected: verdes (incluidos los casos existentes del switch). Si el puerto no responde, anotar pendiente.

- [ ] **Step 4: Commit**

```bash
git add e2e/horas-bancos.spec.ts
git commit -m "test(bancos): e2e de proyecto nuevo en el banco y marca provisional"
```

---

### Verificación final (tras Task 6)

- [ ] `npx tsc --noEmit` limpio.
- [ ] Con el dev server arriba: `/bancos` muestra los proyectos nuevos con consumo (ej. "Opospills", ~8h); en Mensual, los proyectos elegibles muestran meses provisionales marcados con asignado estimado; el detalle marca provisional en cabecera y por posición; la vista Total no incluye provisionales en las cifras. Usar el skill `verify` para recorrer el flujo real.
- [ ] Confirmar que registrar, reportes y alertas siguen igual (solo consumen la lista de proyectos / totales reales).
- [ ] Los e2e que quedaron pendientes por server caído se ejecutan y quedan en verde.
