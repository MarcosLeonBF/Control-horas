# HUCHA Plan 3a — Sincronización desde el Excel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un admin sincronice proyectos y presupuestos HUCHA desde el Excel `Presupuestos Hucha.xlsx` (solo lectura) hacia la base, asignando managers por nombre, con un resumen del resultado.

**Architecture:** Tres unidades separadas: un lector Graph (`lib/hucha/excel.ts`), la lógica pura de sync (`lib/hucha/sync.ts`, recibe el cliente admin de Supabase) y una Server Action + pantalla admin. El Excel es la **base** del presupuesto (`hucha_banks.excel_hucha`), fundida en `assigned_total` con un delta; las ampliaciones/consumos del ledger siguen igual encima. Patrón espeja `lib/graph/client.ts` (lector del banco de horas).

**Tech Stack:** Next 16 (Server Actions), Supabase (Postgres, RLS, RPC), Microsoft Graph, Playwright.

**Spec:** [`../specs/2026-06-26-hucha-plan3a-sync-excel-design.md`](../specs/2026-06-26-hucha-plan3a-sync-excel-design.md) · **PDF:** `Especificaciones App de presupuestos.pdf` (§5 base externa, §8 ampliación, §4.2 admin, §16 read-only)

## Global Constraints

- **Excel = solo lectura.** El sync NUNCA escribe al Excel. Solo se sincronizan proyectos con `Hucha > 0`; los de `Hucha = 0` se saltan.
- **Moneda EUR.** El `Hucha` del Excel es el presupuesto base en euros.
- **Modelo:** `assigned_total = excel_hucha + ampliaciones`; `remaining = assigned_total − consumed_total`. El Excel base entra como delta directo, NO como movimiento.
- **Migraciones** a producción vía MCP `apply_migration` (project_id `msfylcgtlathccmxuheq`), numeración desde `0011_`. Copia del SQL en `supabase/migrations/`. Tests SQL en `supabase/tests/` vía MCP `execute_sql`.
- **Dev server lo gestiona el usuario.** Playwright **sin** bloque `webServer`. Nunca arrancar/parar el server.
- **Next 16:** middleware es `proxy.ts` (NUNCA crear `middleware.ts`). `searchParams`/`params` son Promise.
- **Estética:** paleta de marca + shadcn (tokens en `app/globals.css`). Dinero con `.tabular-money` y `formatEUR` (`lib/hucha/format.ts`).
- **Credenciales** Azure/SharePoint en `.env.local` (`AZURE_*`, `SHAREPOINT_HUCHA_FILE_URL`). El cliente admin usa `SUPABASE_SERVICE_ROLE_KEY`.
- Commits en español, terminando con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `supabase/migrations/0011_hucha_excel_base.sql` — columna `excel_hucha`, unique en `projects.name`, función `set_hucha_excel_base`.
- `supabase/tests/hucha_excel_base.sql` — test de la base + delta + estado.
- `lib/hucha/sync.ts` — interfaces (`ExcelProyecto`, `HuchaExcelData`, `SyncReport`) + `aplicarSync(data, db)` (lógica pura, sin imports `@/`).
- `lib/hucha/excel.ts` — `fetchHuchaExcel()` (lector Graph).
- `app/(hucha)/presupuestos/sincronizar/page.tsx` — pantalla admin.
- `app/(hucha)/presupuestos/sincronizar/actions.ts` — Server Action `sincronizarHucha()`.
- `components/hucha/SincronizarButton.tsx` — botón + resumen.
- `e2e/hucha-sync.spec.ts` — test de `aplicarSync` con fixtures (lógica, sin browser).
- `e2e/hucha-sync-ui.spec.ts` — E2E happy-path de la pantalla (sesión admin).

---

## Task 1: Modelo — base del Excel en el banco

**Files:**
- Create: `supabase/migrations/0011_hucha_excel_base.sql`
- Test: `supabase/tests/hucha_excel_base.sql`

**Interfaces:**
- Consumes: `public.hucha_banks`, `public.projects`, `public.compute_hucha_status`.
- Produces: columna `hucha_banks.excel_hucha numeric(14,2) not null default 0`; unique `projects_name_key` en `projects(name)`; función `public.set_hucha_excel_base(p_bank_id uuid, p_hucha numeric) returns void` que funde la nueva base como delta en `assigned_total`/`remaining`/`status`.

- [ ] **Step 1: Escribir la migración**

```sql
-- 0011_hucha_excel_base.sql — base del Excel en el banco HUCHA
alter table public.hucha_banks add column if not exists excel_hucha numeric(14,2) not null default 0;

-- Permite upsert de proyectos por nombre (la tabla projects es exclusiva de HUCHA).
create unique index if not exists projects_name_key on public.projects(name);

-- Aplica la base del Excel como delta sobre el asignado (no crea movimiento).
-- Invariante: assigned_total = excel_hucha + ampliaciones ; remaining = assigned_total - consumed_total.
create or replace function public.set_hucha_excel_base(p_bank_id uuid, p_hucha numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_bank         public.hucha_banks;
  v_delta        numeric(14,2);
  v_new_assigned numeric(14,2);
begin
  select * into v_bank from public.hucha_banks where id = p_bank_id for update;
  if v_bank.id is null then raise exception 'banco no encontrado'; end if;
  v_delta := coalesce(p_hucha,0) - v_bank.excel_hucha;
  if v_delta = 0 then return; end if;
  v_new_assigned := v_bank.assigned_total + v_delta;
  update public.hucha_banks set
    excel_hucha    = coalesce(p_hucha,0),
    assigned_total = v_new_assigned,
    remaining      = v_new_assigned - v_bank.consumed_total,
    status         = public.compute_hucha_status(v_new_assigned, v_bank.consumed_total),
    updated_at     = now()
  where id = p_bank_id;
end $$;

grant execute on function public.set_hucha_excel_base(uuid, numeric) to authenticated, service_role;
```

- [ ] **Step 2: Aplicar la migración** vía MCP `apply_migration` (name `0011_hucha_excel_base`). Guardar copia en `supabase/migrations/0011_hucha_excel_base.sql`.

- [ ] **Step 3: Escribir el test SQL** (`supabase/tests/hucha_excel_base.sql`)

```sql
do $$
declare v_proj uuid; v_bank uuid;
begin
  insert into public.projects(name) values ('Sync Test 3a') returning id into v_proj;
  select id into v_bank from public.hucha_banks where project_id = v_proj;

  -- base inicial 1000 -> disponible
  perform public.set_hucha_excel_base(v_bank, 1000);
  if (select assigned_total from public.hucha_banks where id=v_bank) <> 1000 then raise exception 'assigned != 1000'; end if;
  if (select remaining from public.hucha_banks where id=v_bank) <> 1000 then raise exception 'remaining != 1000'; end if;
  if (select status from public.hucha_banks where id=v_bank) <> 'disponible' then raise exception 'status != disponible'; end if;

  -- simular consumo previo (cache) y re-sincronizar la base a 1500 -> delta +500
  update public.hucha_banks set consumed_total = 200, remaining = assigned_total - 200,
    status = public.compute_hucha_status(assigned_total, 200) where id = v_bank;
  perform public.set_hucha_excel_base(v_bank, 1500);
  if (select assigned_total from public.hucha_banks where id=v_bank) <> 1500 then raise exception 'assigned != 1500'; end if;
  if (select remaining from public.hucha_banks where id=v_bank) <> 1300 then raise exception 'remaining != 1300'; end if;

  -- re-sync al mismo valor no cambia nada (delta 0)
  perform public.set_hucha_excel_base(v_bank, 1500);
  if (select remaining from public.hucha_banks where id=v_bank) <> 1300 then raise exception 'delta 0 alteró saldo'; end if;

  delete from public.projects where id = v_proj;  -- cascade borra banco
  raise notice 'OK hucha excel base';
end $$;
```

- [ ] **Step 4: Correr el test** vía MCP `execute_sql`. Esperado: sin excepción (`NOTICE: OK hucha excel base`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0011_hucha_excel_base.sql supabase/tests/hucha_excel_base.sql
git commit -m "feat(hucha): base del Excel en el banco (excel_hucha + set_hucha_excel_base)"
```

---

## Task 3: Lector del Excel (Microsoft Graph)

**Files:**
- Create: `lib/hucha/excel.ts`
- Verify: ejecución manual contra el Excel real (no test automatizado — depende de SharePoint).

**Interfaces:**
- Consumes: tipos `ExcelProyecto`, `HuchaExcelData` de `lib/hucha/sync.ts` (ya creado en Task 2).
- Produces: `fetchHuchaExcel(): Promise<HuchaExcelData>` — lee `ProyectosHucha_1` (Proyecto, Hucha) y el manager de `Clientes_Proyectos`.

- [ ] **Step 1: Escribir `lib/hucha/excel.ts`**

```ts
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
```

- [ ] **Step 2: Verificación manual contra el Excel real**

Crear un archivo temporal `scripts/_verify-hucha-excel.mjs` que importe nada (replica mínima): NO necesario si se prueba vía la Server Action en Task 4. Para validar el lector aislado, ejecutar este chequeo en el scratchpad (no se commitea): reusar el patrón ya probado de inspección que devolvió `proyectos: 233`, `con Hucha>0: 1 (Impladent=2500)`, manager "Pilar". Confirmar que `fetchHuchaExcel()` devuelve ≥1 proyecto y que existe `{ proyecto: 'Impladent', hucha: 2500 }` y `managerPorProyecto.get('Impladent') === 'Pilar'`.

> Si el dev server tiene las credenciales Azure cargadas, la verificación real ocurre en la E2E de Task 4 (la Server Action llama a `fetchHuchaExcel`). Documentar el resultado de la verificación en el reporte.

- [ ] **Step 3: Commit**

```bash
git add lib/hucha/excel.ts
git commit -m "feat(hucha): lector del Excel de presupuestos vía Microsoft Graph"
```

---

## Task 2: Lógica de sincronización (`aplicarSync`)

**Files:**
- Create: `lib/hucha/sync.ts`
- Test: `e2e/hucha-sync.spec.ts`

**Interfaces:**
- Consumes: cliente `SupabaseClient` (service_role), RPC `set_hucha_excel_base`.
- Produces: `aplicarSync(data: HuchaExcelData, db: SupabaseClient): Promise<SyncReport>`; tipos `ExcelProyecto`, `HuchaExcelData`, `SyncReport`. **`sync.ts` NO importa nada con alias `@/`** (solo el tipo de `@supabase/supabase-js`), para que la E2E lo importe por ruta relativa.

- [ ] **Step 1: Escribir `lib/hucha/sync.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ExcelProyecto { proyecto: string; hucha: number }
export interface HuchaExcelData { proyectos: ExcelProyecto[]; managerPorProyecto: Map<string, string> }
export interface SyncReport {
  proyectosCreados: number
  proyectosActualizados: number
  managersAsignados: number
  managersNoEncontrados: { proyecto: string; manager: string }[]
  saltadosSinHucha: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function aplicarSync(data: HuchaExcelData, db: SupabaseClient<any>): Promise<SyncReport> {
  const report: SyncReport = {
    proyectosCreados: 0, proyectosActualizados: 0, managersAsignados: 0,
    managersNoEncontrados: [], saltadosSinHucha: 0,
  }

  // Cargar perfiles una vez para matchear manager por nombre (case-insensitive).
  const { data: profiles } = await db.from('profiles').select('id, full_name')
  const perfilPorNombre = new Map<string, string[]>()
  for (const p of profiles ?? []) {
    const key = String(p.full_name ?? '').trim().toLowerCase()
    if (!key) continue
    perfilPorNombre.set(key, [...(perfilPorNombre.get(key) ?? []), p.id])
  }

  for (const { proyecto, hucha } of data.proyectos) {
    if (!(hucha > 0)) { report.saltadosSinHucha++; continue }

    // Upsert proyecto por nombre.
    const { data: existing } = await db.from('projects').select('id').eq('name', proyecto).maybeSingle()
    let projectId: string
    if (existing) { projectId = existing.id; report.proyectosActualizados++ }
    else {
      const { data: created, error } = await db.from('projects').insert({ name: proyecto }).select('id').single()
      if (error) throw new Error(`crear proyecto "${proyecto}": ${error.message}`)
      projectId = created.id; report.proyectosCreados++
    }

    // Banco (el trigger lo crea) y base del Excel.
    const { data: bank, error: be } = await db.from('hucha_banks').select('id').eq('project_id', projectId).single()
    if (be) throw new Error(`banco de "${proyecto}": ${be.message}`)
    const { error: re } = await db.rpc('set_hucha_excel_base', { p_bank_id: bank.id, p_hucha: hucha })
    if (re) throw new Error(`set base "${proyecto}": ${re.message}`)

    // Asignación de manager por nombre.
    const mgr = (data.managerPorProyecto.get(proyecto) ?? '').trim()
    if (mgr) {
      const ids = perfilPorNombre.get(mgr.toLowerCase()) ?? []
      if (ids.length === 1) {
        const { data: ya } = await db.from('project_assignments')
          .select('id').eq('project_id', projectId).eq('user_id', ids[0]).maybeSingle()
        if (!ya) await db.from('project_assignments').insert({ project_id: projectId, user_id: ids[0] })
        report.managersAsignados++
      } else {
        report.managersNoEncontrados.push({ proyecto, manager: mgr })
      }
    }
  }
  return report
}
```

- [ ] **Step 2: Escribir el test** (`e2e/hucha-sync.spec.ts`) — corre la lógica con fixtures, sin browser

```ts
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { aplicarSync, type HuchaExcelData } from '../lib/hucha/sync'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

test('aplicarSync crea proyectos con base, asigna manager y reporta no-matcheados', async () => {
  // Sembrar un perfil manager que matchee por nombre.
  const email = `e2e-sync-mgr-${Date.now()}@hucha.test`
  const { data: created } = await db.auth.admin.createUser({
    email, password: 'E2e-Sync-Pass-123', email_confirm: true,
    user_metadata: { full_name: 'Pilar Sync E2E' },
  })
  const mgrId = created!.user!.id
  await db.from('profiles').update({ role: 'manager', status: 'activo', full_name: 'Pilar Sync E2E' }).eq('id', mgrId)

  const data: HuchaExcelData = {
    proyectos: [
      { proyecto: 'Sync E2E Asignado', hucha: 1000 },
      { proyecto: 'Sync E2E SinManager', hucha: 500 },
      { proyecto: 'Sync E2E SinHucha', hucha: 0 },
    ],
    managerPorProyecto: new Map([
      ['Sync E2E Asignado', 'Pilar Sync E2E'],
      ['Sync E2E SinManager', 'Nombre Inexistente'],
    ]),
  }

  const report = await aplicarSync(data, db)

  expect(report.proyectosCreados).toBe(2)
  expect(report.saltadosSinHucha).toBe(1)
  expect(report.managersAsignados).toBe(1)
  expect(report.managersNoEncontrados).toEqual([{ proyecto: 'Sync E2E SinManager', manager: 'Nombre Inexistente' }])

  // Verificar la base del banco del asignado.
  const { data: proj } = await db.from('projects').select('id').eq('name', 'Sync E2E Asignado').single()
  const { data: bank } = await db.from('hucha_banks').select('excel_hucha, assigned_total, remaining, status').eq('project_id', proj!.id).single()
  expect(Number(bank!.excel_hucha)).toBe(1000)
  expect(Number(bank!.assigned_total)).toBe(1000)
  expect(bank!.status).toBe('disponible')

  // Verificar la asignación.
  const { data: asig } = await db.from('project_assignments').select('id').eq('project_id', proj!.id).eq('user_id', mgrId)
  expect(asig!.length).toBe(1)

  // Limpieza.
  await db.from('projects').delete().like('name', 'Sync E2E%')
  await db.auth.admin.deleteUser(mgrId)
})
```

- [ ] **Step 3: Asegurar que el test corre bajo un proyecto Playwright sin browser**

En `playwright.config.ts`, agregar un proyecto `node-hucha` sin `storageState` con `testMatch: ['**/hucha-sync.spec.ts']`, y añadir `'**/hucha-sync.spec.ts'` al `testIgnore` del proyecto `chromium` (para que no corra dos veces). No tocar los demás proyectos.

- [ ] **Step 4: Correr el test** (dev server del usuario corriendo): `npx playwright test hucha-sync --project=node-hucha`. Esperado: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/hucha/sync.ts e2e/hucha-sync.spec.ts playwright.config.ts
git commit -m "feat(hucha): lógica de sincronización aplicarSync con test de fixtures"
```

---

## Task 4: Server Action + pantalla admin de sincronización

**Files:**
- Create: `app/(hucha)/presupuestos/sincronizar/actions.ts`, `app/(hucha)/presupuestos/sincronizar/page.tsx`, `components/hucha/SincronizarButton.tsx`
- Modify: `components/hucha/HuchaNav.tsx` (link admin)
- Test: `e2e/hucha-sync-ui.spec.ts`

**Interfaces:**
- Consumes: `aplicarSync` (Task 2), `fetchHuchaExcel` (Task 3), `createAdminClient` (`@/lib/supabase/admin`), `createClient` (`@/lib/supabase/server`).
- Produces: Server Action `sincronizarHucha(): Promise<{ ok: true; report: SyncReport } | { ok: false; error: string }>`; pantalla admin con botón + resumen.

- [ ] **Step 1: `app/(hucha)/presupuestos/sincronizar/actions.ts`**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchHuchaExcel } from '@/lib/hucha/excel'
import { aplicarSync, type SyncReport } from '@/lib/hucha/sync'

export async function sincronizarHucha(): Promise<{ ok: true; report: SyncReport } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado.' }
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') return { ok: false, error: 'Solo un administrador puede sincronizar.' }

  try {
    const data = await fetchHuchaExcel()
    const report = await aplicarSync(data, createAdminClient())
    revalidatePath('/presupuestos')
    return { ok: true, report }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error desconocido en la sincronización.' }
  }
}
```

- [ ] **Step 2: `components/hucha/SincronizarButton.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { sincronizarHucha } from '@/app/(hucha)/presupuestos/sincronizar/actions'
import type { SyncReport } from '@/lib/hucha/sync'

export default function SincronizarButton() {
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<SyncReport | null>(null)

  async function onSync() {
    setLoading(true)
    const res = await sincronizarHucha()
    setLoading(false)
    if (!res.ok) { toast.error(res.error); return }
    setReport(res.report)
    toast.success('Sincronización completada')
  }

  return (
    <div className="space-y-4">
      <button onClick={onSync} disabled={loading} className="rounded bg-brand px-4 py-2 text-white">
        {loading ? 'Sincronizando…' : 'Sincronizar con Excel'}
      </button>

      {report && (
        <div className="rounded-lg border border-border p-4 text-sm">
          <p>Proyectos creados: <strong>{report.proyectosCreados}</strong></p>
          <p>Proyectos actualizados: <strong>{report.proyectosActualizados}</strong></p>
          <p>Managers asignados: <strong>{report.managersAsignados}</strong></p>
          <p>Saltados (sin HUCHA): <strong>{report.saltadosSinHucha}</strong></p>
          {report.managersNoEncontrados.length > 0 && (
            <div className="mt-2">
              <p className="text-(--excedido)">Managers no encontrados ({report.managersNoEncontrados.length}):</p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {report.managersNoEncontrados.map((m, i) => <li key={i}>{m.proyecto} — “{m.manager}”</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: `app/(hucha)/presupuestos/sincronizar/page.tsx`** (gate admin)

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SincronizarButton from '@/components/hucha/SincronizarButton'

export default async function SincronizarPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/presupuestos')

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl">Sincronizar presupuestos</h1>
      <p className="text-muted-foreground">Trae proyectos y presupuestos HUCHA desde el Excel. Solo lectura: nunca escribe al Excel.</p>
      <SincronizarButton />
    </div>
  )
}
```

- [ ] **Step 4: Agregar el link admin en `components/hucha/HuchaNav.tsx`**

Leer el archivo y, siguiendo el patrón existente, añadir un enlace a `/presupuestos/sincronizar` visible **solo si el rol es `admin`**. (El componente ya recibe el rol o el displayName; si no recibe el rol, pasarlo desde el layout `app/(hucha)/presupuestos/layout.tsx` que ya consulta `profile.role`.)

- [ ] **Step 5: `e2e/hucha-sync-ui.spec.ts`** (sesión admin de HUCHA)

```ts
import { test, expect } from '@playwright/test'

test('un admin abre la pantalla de sincronización y ve el botón', async ({ page }) => {
  await page.goto('/presupuestos/sincronizar')
  await expect(page.getByRole('heading', { name: /sincronizar presupuestos/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /sincronizar con excel/i })).toBeVisible()
})
```

> Esta E2E necesita una sesión **admin de HUCHA**. Si no existe un storageState admin para el proyecto `chromium` (HUCHA usa `manager.json`), agregar en `global-setup.ts` un login del admin HUCHA y un proyecto Playwright `chromium-hucha-admin` con `testMatch: ['**/hucha-sync-ui.spec.ts']`, y excluir ese spec del proyecto `chromium`. Reusar el admin sembrado o promover el manager del fixture a admin para esta corrida. Mantener intactos los demás proyectos. (El manager del fixture HUCHA NO es admin, así que la opción más simple es sembrar un admin HUCHA dedicado en el seed y loguearlo.)

- [ ] **Step 6: Correr la E2E** (dev server del usuario, con credenciales Azure cargadas): `npx playwright test hucha-sync-ui --project=chromium-hucha-admin`. Esperado: PASS. Si el botón dispara la sync real, también confirma que `fetchHuchaExcel` funciona contra el Excel real (Task 2). Si las credenciales Azure no están cargadas en el server, el botón mostraría error pero la pantalla/botón igual se ven (la E2E solo verifica que se renderizan).

- [ ] **Step 7: Commit**

```bash
git add "app/(hucha)/presupuestos/sincronizar" components/hucha/SincronizarButton.tsx components/hucha/HuchaNav.tsx app/\(hucha\)/presupuestos/layout.tsx e2e/hucha-sync-ui.spec.ts e2e/global-setup.ts e2e/global-teardown.ts playwright.config.ts
git commit -m "feat(hucha): pantalla admin de sincronización con Excel + resumen"
```

---

## Cierre del Plan 3a

- [ ] **Review de rama completa** verificando trazabilidad con el spec y el PDF de HUCHA.
- [ ] **Sincronización real:** con el admin, correr la sync contra el Excel real y confirmar que aparece el proyecto con `Hucha>0` (hoy "Impladent", 2500 €) en "Mis proyectos" del manager asignado (si "Pilar" existe como usuario; si no, queda en el reporte de no-matcheados).
- [ ] **Actualizar** `docs/superpowers/REGISTRO-DECISIONES-Y-ESTADO.md` con "HUCHA Plan 3a — Sincronización — completado".

> **No incluido (Plan 3b):** ampliar/corregir presupuestos desde la UI admin, dashboard global, descargas Excel/CSV, desactivación de proyectos que pierden su HUCHA, sync programado (cron).
