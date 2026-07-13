# Horas Provisionales de Setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el **primer mes** (el de `Fecha Inicio Contable`) de un proyecto **sin ningún registro en `BancoHoras`** use la tarifa de la hoja `Horas_Provisionales_Setup` (arranque, más alta); el resto de meses sigue con la tarifa provisional normal.

**Architecture:** El lector de Graph gana la hoja `Horas_Provisionales_Setup` (misma forma que `Horas_Provisionales`, se generaliza el lector para no duplicarlo). La función pura `provisionalPorPosicion` recibe una tarifa de setup opcional y, para un proyecto sin registros reales, aplica esa tarifa **solo** al mes que coincide con su inicio contable. `getBancosHoras`/`getBancoHorasDetalle` cargan la tarifa de setup y la pasan. La UI no cambia (el mes de setup se ve como provisional). Spec: [2026-07-13-horas-provisionales-setup-design.md](../specs/2026-07-13-horas-provisionales-setup-design.md).

**Tech Stack:** Next.js App Router (RSC), TypeScript, Microsoft Graph (Excel `usedRange`), `unstable_cache`, Supabase (supabase-js), Playwright.

## Global Constraints

- **Sin framework de unit tests**: la puerta por tarea es `npx tsc --noEmit`; cierre con `npm run build`. Lint roto repo-wide (no se usa).
- **Dev server**: lo gestiona el usuario; nunca arrancarlo/pararlo. Playwright no lo auto-lanza. Si `http://localhost:3000` no responde, saltar la verificación en vivo y anotarlo.
- Mes = string `'YYYY-MM'`; se comparan lexicográficamente (siempre zero-padded).
- **Disparador del setup**: proyecto **sin ningún registro** en `BancoHoras` (`mesesReales` vacío). Con al menos un registro real → todo provisional normal (comportamiento actual).
- **Mes de setup**: el mes de `Fecha Inicio Contable` (`inicioContable`, a nivel `YYYY-MM`). Fecha fija; el setup **no** se mueve con la ventana. Inicio fuera de la ventana → sin setup.
- **Fuente del setup**: hoja `Horas_Provisionales_Setup` (misma estructura que `Horas_Provisionales`: fila = tipo de contrato, columnas = 12 posiciones). Sin fila para el tipo de contrato → el mes de inicio cae a la tarifa normal (fallback defensivo).
- **Semántica de totales**: las provisionales (setup incluido) **suman** al `assigned`/total como **transitorio** y van marcadas `provisional: true` (comportamiento actual del repo; ver `lib/horas/bancos.ts`). No hay estado guardado: en cuanto aparece la fila real del mes, el criterio `mesesReales.has(M)` la reemplaza.
- **UI**: sin cambios. El mes de setup se muestra con el badge "Provisional" existente.
- **Ventana** = `(últimoRegistroGlobal, mesActual]`, ya calculada con `mesesVentana(ultimoRegistroGlobal(excel), currentMonth())`.
- Commits en español estilo repo (`feat(bancos): …` / `refactor(bancos): …`) terminando con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Lector de `Horas_Provisionales_Setup` (Graph)

**Files:**
- Modify: `lib/graph/client.ts` (generalizar `readHorasProvisionalesSheet` líneas 250-282; actualizar `fetchHorasProvEntriesFromGraph` líneas 289-296; añadir fetcher/cache/export de setup tras `getCachedHorasProvisionales` línea 307)

**Interfaces:**
- Consumes: helpers de módulo existentes (`getToken`, `resolveDriveItem`), tipos `HorasProvisionales` (línea 248) y `HorasProvEntries` (línea 287), `BANCO_HORAS_TAG` (línea 4), `unstable_cache`.
- Produces: `getCachedHorasProvisionalesSetup(): Promise<HorasProvisionales>` (tipoContrato → posición → horas/mes del mes de arranque).

- [ ] **Step 1: Generalizar el lector de hojas de tarifa (DRY)**

En `lib/graph/client.ts`, reemplazar la función `readHorasProvisionalesSheet` (líneas 250-282) por una versión con el nombre de hoja parametrizado:

```ts
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
```

- [ ] **Step 2: Actualizar el fetcher normal para usar el lector generalizado**

Reemplazar `fetchHorasProvEntriesFromGraph` (líneas 289-296) por:

```ts
async function fetchHorasProvEntriesFromGraph(): Promise<HorasProvEntries> {
  const fileUrl = process.env.SHAREPOINT_FILE_URL
  if (!fileUrl) throw new Error('SHAREPOINT_FILE_URL no está configurada')
  const token = await getToken()
  const { driveId, itemId } = await resolveDriveItem(token, fileUrl)
  const map = await readTarifaProvisionalSheet(token, driveId, itemId, 'Horas_Provisionales')
  return [...map].map(([tipo, ps]) => [tipo, [...ps]])
}
```

- [ ] **Step 3: Añadir el fetcher, cache y export de setup**

Justo después de `getCachedHorasProvisionales` (tras la línea 307, al final del bloque de horas provisionales) añadir:

```ts
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
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores. (El único llamador de la vieja `readHorasProvisionalesSheet` era `fetchHorasProvEntriesFromGraph`, actualizado en el Step 2; no quedan referencias al nombre viejo.)

- [ ] **Step 5: Commit**

```bash
git add lib/graph/client.ts
git commit -m "$(cat <<'EOF'
refactor(bancos): lector de tarifa provisional parametrizado + hoja Horas_Provisionales_Setup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Regla de setup en la función pura

**Files:**
- Modify: `lib/horas/provisionales.ts` (`provisionalPorPosicion` líneas 33-57)

**Interfaces:**
- Consumes: `BancoMensual` (tipo, ya importado), `ProyectoProvisionalMeta` (misma).
- Produces: `provisionalPorPosicion(meta, mesesReales, ventana, tarifa, tarifaSetup?)` — mismo tipo de retorno `Map<string, BancoMensual[]>`. El 5º parámetro es **opcional** (undefined → sin setup, comportamiento idéntico al actual), de modo que esta tarea compila sola sin tocar los llamadores todavía.

- [ ] **Step 1: Añadir `tarifaSetup` y aplicar la tarifa de setup al mes de inicio**

Reemplazar la función `provisionalPorPosicion` (líneas 33-57) por:

```ts
export function provisionalPorPosicion(
  meta: ProyectoProvisionalMeta,
  mesesReales: Set<string>,
  ventana: string[],
  tarifa: Map<string, number> | undefined,
  tarifaSetup?: Map<string, number>,
): Map<string, BancoMensual[]> {
  const out = new Map<string, BancoMensual[]>()
  if (!tarifa) return out                                    // sin tarifa
  if (meta.estado.toLowerCase().includes('paus')) return out // Estado Pausa fuera
  if (meta.inicioContable === '') return out                 // sin inicio: no ubicable
  const inicioMes = meta.inicioContable.slice(0, 7)
  const finMes = meta.finContable ? meta.finContable.slice(0, 7) : ''
  // Proyecto nuevo = sin ningún registro real en BancoHoras. Su mes de arranque
  // (inicioMes), si cae en la ventana, usa la tarifa de setup; el resto, la normal.
  const esNuevo = mesesReales.size === 0
  for (const M of ventana) {
    if (mesesReales.has(M)) continue   // ya hay fila real ese mes
    if (inicioMes > M) continue        // aún no arrancó
    if (finMes && finMes < M) continue // ya finalizó
    const tabla = (esNuevo && M === inicioMes && tarifaSetup) ? tarifaSetup : tarifa
    for (const [position, hours] of tabla) {
      if (hours <= 0) continue
      const arr = out.get(position) ?? []
      arr.push({ month: M, assigned: hours, consumed: 0, provisional: true })
      out.set(position, arr)
    }
  }
  return out
}
```

Notas de diseño (por qué es correcto):
- `M === inicioMes` acota el setup a **un** mes. El guard `inicioMes > M` garantiza `M ≥ inicioMes`, así que solo el propio mes de inicio cumple la igualdad.
- Si `inicioMes` está antes de la ventana (arranque ya pasado), ninguna `M` de la ventana lo iguala → sin setup.
- Con `tarifaSetup` undefined o sin fila para el contrato, el ternario cae a `tarifa` (normal) → fallback defensivo.
- El ternario incluye `tarifaSetup` en la condición, de modo que TypeScript estrecha `tarifaSetup` a `Map<string, number>` dentro de la rama verdadera (no hace falta `!`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores. Los dos llamadores actuales en `lib/horas/bancos.ts` siguen pasando 4 argumentos; al ser `tarifaSetup` opcional, compilan sin cambios (todavía sin setup: se conecta en la Task 3).

- [ ] **Step 3: Commit**

```bash
git add lib/horas/provisionales.ts
git commit -m "$(cat <<'EOF'
feat(bancos): tarifa de setup para el mes de inicio de un proyecto sin registros

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Conectar la tarifa de setup en `getBancosHoras` y `getBancoHorasDetalle`

**Files:**
- Modify: `lib/horas/bancos.ts` (import línea 2; `getBancosHoras` líneas 58-119; `getBancoHorasDetalle` líneas 190-201)

**Interfaces:**
- Consumes: `getCachedHorasProvisionalesSetup` (Task 1), `provisionalPorPosicion(..., tarifaSetup?)` (Task 2), `HorasProvisionales` (ya importado).
- Produces: ambos consumidores calculan la provisional del mes de inicio con la tarifa de setup para proyectos sin registros. Firmas públicas sin cambios.

- [ ] **Step 1: Import**

Reemplazar la línea 2 de `lib/horas/bancos.ts` por (añade `getCachedHorasProvisionalesSetup`):

```ts
import { getCachedBancoHoras, getCachedProyectosEstado, getCachedHorasProvisionales, getCachedHorasProvisionalesSetup, type ProyectoEstado, type HorasProvisionales } from '@/lib/graph/client'
```

- [ ] **Step 2: Cargar la tarifa de setup en `getBancosHoras`**

En `getBancosHoras`, justo después del bloque que carga `horasProv` (líneas 58-59), añadir la carga de setup con el mismo `try/catch` tolerante:

```ts
  let horasProv: HorasProvisionales = new Map()
  try { horasProv = await getCachedHorasProvisionales() } catch { horasProv = new Map() }

  let horasProvSetup: HorasProvisionales = new Map()
  try { horasProvSetup = await getCachedHorasProvisionalesSetup() } catch { horasProvSetup = new Map() }
```

- [ ] **Step 3: Resolver y pasar `tarifaSetup` en el bucle de proyectos de `getBancosHoras`**

En el bucle `for (const project of projectNames)`, reemplazar el bloque de `tarifa`/`provByPos` (líneas 110-119) por:

```ts
    const tarifa = meta ? horasProv.get(meta.tipoContrato) : undefined
    const tarifaSetup = meta ? horasProvSetup.get(meta.tipoContrato) : undefined
    if (meta && meta.tipoContrato && horasProv.size > 0 && !tarifa) {
      console.warn(`[horas-provisionales] sin tarifa para tipo de contrato "${meta.tipoContrato}" (proyecto "${project}")`)
    }
    const provByPos = meta
      ? provisionalPorPosicion(
          { tipoContrato: meta.tipoContrato, estado: meta.estado, inicioContable: meta.inicioContable, finContable: meta.finContable },
          mesesReales, ventana, tarifa, tarifaSetup,
        )
      : new Map<string, BancoMensual[]>()
```

- [ ] **Step 4: Cargar y pasar `tarifaSetup` en `getBancoHorasDetalle`**

En `getBancoHorasDetalle`, tras el bloque que carga `horasProv` (líneas 190-191) añadir la carga de setup:

```ts
  let horasProv: HorasProvisionales = new Map()
  try { horasProv = await getCachedHorasProvisionales() } catch { horasProv = new Map() }
  let horasProvSetup: HorasProvisionales = new Map()
  try { horasProvSetup = await getCachedHorasProvisionalesSetup() } catch { horasProvSetup = new Map() }
```

Y reemplazar el bloque `tarifa`/`provByPos` (líneas 195-201) por:

```ts
  const tarifa = meta ? horasProv.get(meta.tipoContrato) : undefined
  const tarifaSetup = meta ? horasProvSetup.get(meta.tipoContrato) : undefined
  const provByPos = meta
    ? provisionalPorPosicion(
        { tipoContrato: meta.tipoContrato, estado: meta.estado, inicioContable: meta.inicioContable, finContable: meta.finContable },
        mesesRealesProj, ventana, tarifa, tarifaSetup,
      )
    : new Map<string, BancoMensual[]>()
```

- [ ] **Step 5: Typecheck y build**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run build`
Expected: build correcto (compila las rutas que usan `getBancosHoras`/`getBancoHorasDetalle`).

- [ ] **Step 6: Commit**

```bash
git add lib/horas/bancos.ts
git commit -m "$(cat <<'EOF'
feat(bancos): aplica la tarifa de setup en la lista y el detalle del banco

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Verificación final (tras Task 3)

- [ ] `npx tsc --noEmit` limpio y `npm run build` correcto.
- [ ] **En vivo (si el dev server está arriba)** — `Test-NetConnection localhost -Port 3000 -InformationLevel Quiet` → si True, con el skill `verify` recorrer `/bancos` (Mensual) y comprobar sobre un proyecto **sin registros en BancoHoras** cuyo inicio contable cae en la ventana:
  - El mes de inicio muestra el **asignado de setup** (más alto que la tarifa normal de su tipo de contrato), marcado "Provisional".
  - El mes siguiente (si también es provisional) muestra la tarifa **normal**, marcado "Provisional".
  - Un proyecto **con** registros no muestra cambios (toda su provisional es normal).
  - Un proyecto cuyo inicio contable es anterior a la ventana no muestra setup.
  - Si el puerto no responde, anotar la verificación como pendiente.
- [ ] Cotejar contra un tipo de contrato conocido de `Horas_Provisionales_Setup` (p. ej. `ARCO (Implementación)` → CRM 15 en setup vs 5 normal; `CRM` → CRM 25 en setup vs 0 normal) que el número del mes de inicio corresponde a la fila de setup.
- [ ] Confirmar que la vista Total y los KPIs siguen coherentes (la provisional, setup incluido, suma como transitorio y va marcada).
