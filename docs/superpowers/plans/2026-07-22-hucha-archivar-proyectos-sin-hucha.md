# HUCHA — archivar proyectos que pierden su presupuesto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que al sincronizar con el Excel, un proyecto que pasa a `Hucha = 0` quede archivado (oculto de los listados, banco e histórico intactos) y que se reactive si vuelve con `Hucha > 0`.

**Architecture:** Todo el cambio de fondo vive en `aplicarSync` (`lib/hucha/sync.ts`): en `Hucha = 0` archiva el proyecto existente-activo vía `projects.status = 'archivado'`; en `Hucha > 0` reactiva si estaba archivado. Los listados ya filtran `status = 'activo'`, así que archivar oculta el proyecto sin tocar la UI de listados. El `SyncReport` gana dos contadores que el botón de sync muestra. Sin migración (la columna `projects.status` ya existe).

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript, Supabase (`@supabase/supabase-js`, service_role en el sync), Playwright (test del nodo `node-hucha`, sin browser).

## Global Constraints

- Gate de calidad = `npx tsc --noEmit` + `npm run build`. **No** usar `npm run lint` (roto repo-wide desde Next 16).
- Dev server gestionado por el usuario; debe estar levantado en `http://localhost:3000` antes de correr E2E. Playwright **sin** bloque `webServer`. Nunca arrancar/parar el dev server ni agregar `webServer`.
- El test de sync corre con el proyecto Playwright `node-hucha` (`testMatch: ['**/hucha-sync.spec.ts']`) y usa el cliente service_role; no depende de Microsoft Graph.
- Seguir el estilo existente de `lib/hucha/sync.ts`: errores con `throw new Error(\`contexto: ${error.message}\`)`.
- `projects.status` admite solo `'activo'` | `'archivado'` (`check` de `0001_foundation.sql`). No introducir otros valores.
- Archivar/reactivar **no** toca el banco (`hucha_banks`): `excel_hucha`, `assigned_total`, consumos y ampliaciones quedan como estaban.

---

## Task 1: Archivar/reactivar en `aplicarSync` (lógica + test)

Unidad de fondo. Se extiende `SyncReport` con dos contadores y se agrega la rama de archivado (`Hucha = 0`) y la reactivación (`Hucha > 0` sobre un proyecto archivado). Se cubre con un test nuevo en el spec existente.

**Files:**
- Modify: `lib/hucha/sync.ts` (interface `SyncReport` + función `aplicarSync`)
- Test: `e2e/hucha-sync.spec.ts` (agregar un `test(...)` nuevo; no tocar el existente)

**Interfaces:**
- Consumes: `HuchaExcelData`, cliente `SupabaseClient` (ya existentes en `sync.ts`).
- Produces:
  ```ts
  interface SyncReport {
    proyectosCreados: number
    proyectosActualizados: number
    proyectosArchivados: number      // NUEVO
    proyectosReactivados: number     // NUEVO
    managersAsignados: number
    managersNoEncontrados: { proyecto: string; manager: string }[]
    saltadosSinHucha: number
  }
  async function aplicarSync(data: HuchaExcelData, db: SupabaseClient): Promise<SyncReport>
  ```

- [ ] **Step 1: Escribir el test que falla**

Agregar este `test` al final de `e2e/hucha-sync.spec.ts` (después del test existente, dentro del mismo archivo; no modificar el test que ya está):

```ts
test('aplicarSync archiva un proyecto que cae a Hucha=0 y lo reactiva si vuelve', async () => {
  const proyecto = `Sync E2E Archivar ${Date.now()}`

  // 1) Alta con presupuesto -> queda activo.
  const r1 = await aplicarSync({ proyectos: [{ proyecto, hucha: 2500 }], managerPorProyecto: new Map() }, db)
  expect(r1.proyectosCreados).toBe(1)
  const { data: p1 } = await db.from('projects').select('id, status').eq('name', proyecto).single()
  expect(p1!.status).toBe('activo')

  // 2) Cae a 0 en el Excel -> se archiva; el banco NO se toca.
  const r2 = await aplicarSync({ proyectos: [{ proyecto, hucha: 0 }], managerPorProyecto: new Map() }, db)
  expect(r2.proyectosArchivados).toBe(1)
  expect(r2.saltadosSinHucha).toBe(0)
  const { data: p2 } = await db.from('projects').select('status').eq('id', p1!.id).single()
  expect(p2!.status).toBe('archivado')
  const { data: bank2 } = await db.from('hucha_banks').select('excel_hucha, assigned_total').eq('project_id', p1!.id).single()
  expect(Number(bank2!.excel_hucha)).toBe(2500)
  expect(Number(bank2!.assigned_total)).toBe(2500)

  // 3) Re-sync con 0 otra vez -> ya archivado, nada que hacer.
  const r3 = await aplicarSync({ proyectos: [{ proyecto, hucha: 0 }], managerPorProyecto: new Map() }, db)
  expect(r3.proyectosArchivados).toBe(0)
  expect(r3.saltadosSinHucha).toBe(1)

  // 4) Vuelve con presupuesto -> se reactiva y recupera base.
  const r4 = await aplicarSync({ proyectos: [{ proyecto, hucha: 3000 }], managerPorProyecto: new Map() }, db)
  expect(r4.proyectosReactivados).toBe(1)
  const { data: p4 } = await db.from('projects').select('status').eq('id', p1!.id).single()
  expect(p4!.status).toBe('activo')
  const { data: bank4 } = await db.from('hucha_banks').select('excel_hucha, assigned_total').eq('project_id', p1!.id).single()
  expect(Number(bank4!.excel_hucha)).toBe(3000)

  // Limpieza (cascade borra banco y movimientos).
  await db.from('projects').delete().like('name', 'Sync E2E Archivar%')
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Requiere el dev server levantado en `http://localhost:3000` (lo gestiona el usuario). Run:

```
npx playwright test --project=node-hucha
```

Expected: FALLA en el test nuevo. `expect(r2.proyectosArchivados).toBe(1)` recibe `undefined` (el campo aún no existe) y/o `expect(p2!.status).toBe('archivado')` recibe `'activo'` (aún se salta sin archivar). El test existente sigue en PASS.

- [ ] **Step 3: Extender la interface `SyncReport`**

En `lib/hucha/sync.ts`, reemplazar la interface `SyncReport` por:

```ts
export interface SyncReport {
  proyectosCreados: number
  proyectosActualizados: number
  proyectosArchivados: number
  proyectosReactivados: number
  managersAsignados: number
  managersNoEncontrados: { proyecto: string; manager: string }[]
  saltadosSinHucha: number
}
```

- [ ] **Step 4: Inicializar los contadores nuevos**

En `aplicarSync`, reemplazar la inicialización de `report` por:

```ts
  const report: SyncReport = {
    proyectosCreados: 0, proyectosActualizados: 0,
    proyectosArchivados: 0, proyectosReactivados: 0,
    managersAsignados: 0, managersNoEncontrados: [], saltadosSinHucha: 0,
  }
```

- [ ] **Step 5: Rama de archivado para `Hucha = 0`**

En el bucle `for (const { proyecto, hucha } of data.proyectos)`, reemplazar la línea actual:

```ts
    if (!(hucha > 0)) { report.saltadosSinHucha++; continue }
```

por:

```ts
    if (!(hucha > 0)) {
      // Hucha = 0 en el Excel: archivar si el proyecto existe y está activo; si no, saltar.
      const { data: existing } = await db.from('projects').select('id, status').eq('name', proyecto).maybeSingle()
      if (existing && existing.status === 'activo') {
        const { error } = await db.from('projects').update({ status: 'archivado' }).eq('id', existing.id)
        if (error) throw new Error(`archivar "${proyecto}": ${error.message}`)
        report.proyectosArchivados++
      } else {
        report.saltadosSinHucha++
      }
      continue
    }
```

- [ ] **Step 6: Reactivación en el upsert (`Hucha > 0`)**

Justo debajo, reemplazar el bloque de upsert actual:

```ts
    // Upsert proyecto por nombre.
    const { data: existing } = await db.from('projects').select('id').eq('name', proyecto).maybeSingle()
    let projectId: string
    if (existing) { projectId = existing.id; report.proyectosActualizados++ }
    else {
      const { data: created, error } = await db.from('projects').insert({ name: proyecto }).select('id').single()
      if (error) throw new Error(`crear proyecto "${proyecto}": ${error.message}`)
      projectId = created.id; report.proyectosCreados++
    }
```

por (agrega `status` al select y reactiva si estaba archivado):

```ts
    // Upsert proyecto por nombre.
    const { data: existing } = await db.from('projects').select('id, status').eq('name', proyecto).maybeSingle()
    let projectId: string
    if (existing) {
      projectId = existing.id
      report.proyectosActualizados++
      if (existing.status === 'archivado') {
        const { error } = await db.from('projects').update({ status: 'activo' }).eq('id', projectId)
        if (error) throw new Error(`reactivar "${proyecto}": ${error.message}`)
        report.proyectosReactivados++
      }
    } else {
      const { data: created, error } = await db.from('projects').insert({ name: proyecto }).select('id').single()
      if (error) throw new Error(`crear proyecto "${proyecto}": ${error.message}`)
      projectId = created.id; report.proyectosCreados++
    }
```

El resto de `aplicarSync` (banco + `set_hucha_excel_base` + asignación de manager) queda **igual**.

- [ ] **Step 7: Correr el test para verificar que pasa**

Run:

```
npx playwright test --project=node-hucha
```

Expected: PASS de los 2 tests del archivo (el existente `aplicarSync crea proyectos...` y el nuevo `aplicarSync archiva...`). Salida `2 passed`.

- [ ] **Step 8: Typecheck**

Run:

```
npx tsc --noEmit
```

Expected: sin errores (exit 0).

- [ ] **Step 9: Commit**

```bash
git add lib/hucha/sync.ts e2e/hucha-sync.spec.ts
git commit -m "feat(hucha): archivar proyectos que pierden su HUCHA y reactivar si vuelven"
```

---

## Task 2: Mostrar archivados/reactivados en el botón de sync

El resumen post-sync suma dos líneas para que el admin vea qué pasó al sincronizar.

**Files:**
- Modify: `components/hucha/SincronizarButton.tsx` (bloque `{report && (...)}`)

**Interfaces:**
- Consumes: `SyncReport` con `proyectosArchivados` y `proyectosReactivados` (de Task 1).

- [ ] **Step 1: Agregar las dos líneas al resumen**

En `components/hucha/SincronizarButton.tsx`, reemplazar el bloque:

```tsx
          <p>Proyectos creados: <strong>{report.proyectosCreados}</strong></p>
          <p>Proyectos actualizados: <strong>{report.proyectosActualizados}</strong></p>
          <p>Managers asignados: <strong>{report.managersAsignados}</strong></p>
          <p>Saltados (sin HUCHA): <strong>{report.saltadosSinHucha}</strong></p>
```

por:

```tsx
          <p>Proyectos creados: <strong>{report.proyectosCreados}</strong></p>
          <p>Proyectos actualizados: <strong>{report.proyectosActualizados}</strong></p>
          <p>Proyectos archivados (perdieron su HUCHA): <strong>{report.proyectosArchivados}</strong></p>
          <p>Proyectos reactivados: <strong>{report.proyectosReactivados}</strong></p>
          <p>Managers asignados: <strong>{report.managersAsignados}</strong></p>
          <p>Saltados (sin HUCHA): <strong>{report.saltadosSinHucha}</strong></p>
```

- [ ] **Step 2: Typecheck**

Run:

```
npx tsc --noEmit
```

Expected: sin errores (exit 0).

- [ ] **Step 3: Build**

Run:

```
npm run build
```

Expected: build exitoso (compila y genera las rutas sin errores).

- [ ] **Step 4: Commit**

```bash
git add components/hucha/SincronizarButton.tsx
git commit -m "feat(hucha): el resumen de sync muestra archivados y reactivados"
```

---

## Self-Review

**Spec coverage:**
- §2.1 archivar no borrar → Task 1 Step 5 (`status = 'archivado'`). ✓
- §2.2 banco no se toca → Task 1 no llama `set_hucha_excel_base` en la rama `Hucha = 0`; test asserts `excel_hucha`/`assigned_total` intactos (Step 1). ✓
- §2.3 reactivación automática → Task 1 Step 6. ✓
- §4 lógica de sync (archivar existente-activo; saltar inexistente/ya-archivado; reactivar) → Task 1 Steps 5-6; casos (a)(b)(c) en el test. ✓
- §4 reporte con `proyectosArchivados`/`proyectosReactivados` → Task 1 Steps 3-4. ✓
- §5 UI con dos líneas nuevas → Task 2. ✓
- §6 testing (baja a 0, vuelve, inexistente) → Task 1 Step 1 (r2, r4, r3). ✓
- §7 fuera de alcance (no bloqueo de consumos, no vista de archivados) → no hay tareas para eso. ✓

**Placeholder scan:** sin TBD/TODO; todo el código está completo. ✓

**Type consistency:** `SyncReport` (Step 3) usa exactamente `proyectosArchivados`/`proyectosReactivados`, iguales a la inicialización (Step 4), al test (Step 1) y a la UI (Task 2). Nombres de columnas (`status`, `excel_hucha`, `assigned_total`) coinciden con las migraciones. ✓
