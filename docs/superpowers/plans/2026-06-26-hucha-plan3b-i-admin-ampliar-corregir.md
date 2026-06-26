# HUCHA Plan 3b-i — Admin (ampliar + corregir/anular) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar al admin, desde el detalle del proyecto HUCHA, las operaciones de **ampliar** presupuesto (valor agregado) y **anular** movimientos (corregir), sobre el ledger existente.

**Architecture:** Reutiliza la RPC `registrar_movimiento_hucha` (ya soporta `ampliacion` y `anulacion`, admin-only interno). Se cierra un hueco de doble-anulación en la RPC, y se agregan controles **solo-admin** en la pantalla de detalle `/presupuestos/[id]` (form de ampliar + botones de anular en el historial), vía Server Actions.

**Tech Stack:** Next 16 (Server Components + Server Actions), Supabase (Postgres, RLS, RPC), Playwright.

**Spec:** [`../specs/2026-06-26-hucha-plan3b-i-admin-ampliar-corregir-design.md`](../specs/2026-06-26-hucha-plan3b-i-admin-ampliar-corregir-design.md) · **PDF:** `Especificaciones App de presupuestos.pdf` (§8, §4.2, §9, §7)

## Global Constraints

- **Moneda EUR.** Usar `formatEUR` de `lib/hucha/format.ts`. Montos con `.tabular-money`.
- **Ledger inmutable:** las correcciones son anulaciones (asientos de reversión), no edición. La ampliación sube `assigned_total`, deja `excel_hucha` intacto.
- **Solo admin** puede ampliar/anular (la RPC ya lo exige; la UI renderiza los controles solo si `role === 'admin'` — defensa en profundidad).
- **Migraciones** a producción vía MCP `apply_migration` (project_id `msfylcgtlathccmxuheq`), numeración desde `0012_`. Copia en `supabase/migrations/`. Tests SQL en `supabase/tests/` vía MCP `execute_sql` (impersonar rol con `set_config('request.jwt.claims', …, true)`).
- **Dev server lo gestiona el usuario.** Playwright **sin** `webServer`. Nunca arrancar/parar el server.
- **Next 16:** middleware es `proxy.ts` (NUNCA crear `middleware.ts`). `params` es Promise.
- **Estética:** paleta de marca + shadcn; Tailwind v4 canónico (`text-(--var)`, no `text-[var(--var)]`).
- Commits en español, terminando con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `supabase/migrations/0012_hucha_anulacion_dedup_guard.sql` — RPC con guard de doble-anulación.
- `supabase/tests/hucha_anulacion_dedup.sql` — test del guard.
- `app/(hucha)/presupuestos/[id]/actions.ts` — (existe; tiene `registrarConsumo`) agregar `ampliarPresupuesto` y `anularMovimiento`.
- `app/(hucha)/presupuestos/[id]/AmpliarForm.tsx` — form admin de ampliación (client).
- `components/hucha/AnularButton.tsx` — botón de anular (client).
- `components/hucha/MovementsTable.tsx` — (modificar) columna de acciones admin.
- `lib/hucha/types.ts` — (modificar) `corrects_movement_id` en `HuchaMovementRow`.
- `lib/hucha/queries.ts` — (modificar) `getMovements` trae `corrects_movement_id`.
- `app/(hucha)/presupuestos/[id]/page.tsx` — (modificar) rol + AmpliarForm admin + props admin a MovementsTable.
- `e2e/hucha-admin-ampliar.spec.ts`, `e2e/hucha-admin-anular.spec.ts` — E2E sesión admin.

---

## Task 1: Guard de doble-anulación en la RPC

**Files:**
- Create: `supabase/migrations/0012_hucha_anulacion_dedup_guard.sql`
- Test: `supabase/tests/hucha_anulacion_dedup.sql`

**Interfaces:**
- Consumes: `hucha_movements`, `hucha_banks`, `profiles`, `compute_hucha_status`.
- Produces: `registrar_movimiento_hucha(...)` actualizada — en `anulacion`, rechaza si el movimiento objetivo ya tiene una anulación que lo corrige.

- [ ] **Step 1: Escribir la migración** (copia íntegra de la RPC de `0003b` + el nuevo guard)

```sql
-- 0012_hucha_anulacion_dedup_guard.sql — impedir anular dos veces el mismo movimiento
create or replace function public.registrar_movimiento_hucha(
  p_project_id uuid,
  p_type text,
  p_amount numeric,
  p_description text default null,
  p_reference text default null,
  p_reason text default null,
  p_entry_date date default current_date,
  p_corrects_movement_id uuid default null
) returns public.hucha_movements
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_active text;
  v_name   text;
  v_bank   public.hucha_banks;
  v_signed numeric(14,2);
  v_before numeric(14,2);
  v_after  numeric(14,2);
  v_new_assigned numeric(14,2);
  v_new_consumed numeric(14,2);
  v_orig   public.hucha_movements;
  v_mov    public.hucha_movements;
begin
  select role, status, full_name into v_role, v_active, v_name
    from public.profiles where id = v_uid;
  if v_role is null then raise exception 'no autorizado: usuario sin perfil'; end if;
  if v_active <> 'activo' then raise exception 'no autorizado: usuario inactivo'; end if;

  if p_amount is null or p_amount <= 0 then raise exception 'monto inválido: debe ser > 0'; end if;
  if p_entry_date > current_date then raise exception 'fecha inválida: no puede ser futura'; end if;

  select * into v_bank from public.hucha_banks
    where project_id = p_project_id for update;
  if v_bank.id is null then raise exception 'el proyecto no tiene banco HUCHA'; end if;

  if p_type = 'consumo' then
    if v_role <> 'admin' and not exists (
        select 1 from public.project_assignments
        where project_id = p_project_id and user_id = v_uid)
    then raise exception 'no autorizado: sin asignación al proyecto'; end if;
    if coalesce(btrim(p_description),'') = '' then raise exception 'descripción obligatoria'; end if;
    v_signed := -p_amount;
    v_new_assigned := v_bank.assigned_total;
    v_new_consumed := v_bank.consumed_total + p_amount;

  elsif p_type = 'ampliacion' then
    if v_role <> 'admin' then raise exception 'no autorizado: solo admin amplía'; end if;
    if coalesce(btrim(p_reason),'') = '' then raise exception 'motivo obligatorio'; end if;
    v_signed := p_amount;
    v_new_assigned := v_bank.assigned_total + p_amount;
    v_new_consumed := v_bank.consumed_total;

  elsif p_type = 'anulacion' then
    if v_role <> 'admin' then raise exception 'no autorizado: solo admin anula'; end if;
    if p_corrects_movement_id is null then raise exception 'anulacion requiere movimiento a revertir'; end if;
    select * into v_orig from public.hucha_movements
      where id = p_corrects_movement_id and bank_id = v_bank.id;
    if v_orig.id is null then raise exception 'movimiento a anular no encontrado'; end if;
    if v_orig.type = 'anulacion' then
      raise exception 'no se puede anular una anulación';
    end if;
    -- NUEVO: impedir doble anulación del mismo movimiento.
    if exists (select 1 from public.hucha_movements
               where corrects_movement_id = p_corrects_movement_id and type = 'anulacion') then
      raise exception 'el movimiento ya fue anulado';
    end if;
    v_signed := -v_orig.amount;
    if v_orig.type = 'consumo' then
      v_new_assigned := v_bank.assigned_total;
      v_new_consumed := v_bank.consumed_total + v_orig.amount;
    else
      v_new_assigned := v_bank.assigned_total - v_orig.amount;
      v_new_consumed := v_bank.consumed_total;
    end if;

  else
    raise exception 'tipo de movimiento no soportado: %', p_type;
  end if;

  v_before := v_bank.remaining;
  v_after  := v_new_assigned - v_new_consumed;

  insert into public.hucha_movements (
    bank_id, type, amount, balance_before, balance_after,
    description, reference, reason, actor_id, actor_name,
    entry_date, corrects_movement_id)
  values (
    v_bank.id, p_type, v_signed, v_before, v_after,
    p_description, p_reference, p_reason, v_uid, coalesce(v_name,''),
    p_entry_date, p_corrects_movement_id)
  returning * into v_mov;

  update public.hucha_banks set
    assigned_total = v_new_assigned,
    consumed_total = v_new_consumed,
    remaining      = v_after,
    status         = public.compute_hucha_status(v_new_assigned, v_new_consumed),
    updated_at     = now()
  where id = v_bank.id;

  return v_mov;
end $$;

grant execute on function public.registrar_movimiento_hucha(uuid,text,numeric,text,text,text,date,uuid) to authenticated;
```

- [ ] **Step 2: Aplicar la migración** vía MCP `apply_migration` (name `0012_hucha_anulacion_dedup_guard`). Guardar copia en `supabase/migrations/0012_hucha_anulacion_dedup_guard.sql`.

- [ ] **Step 3: Escribir el test SQL** (`supabase/tests/hucha_anulacion_dedup.sql`) — impersona al admin Marcos

```sql
do $$
declare v_admin uuid := '1de8f167-ca74-49eb-a2b7-3273b63e8c2b'; v_proj uuid; v_consumo uuid; ok bool;
begin
  insert into public.projects(name) values ('Anular Dedup Test') returning id into v_proj;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);

  perform public.registrar_movimiento_hucha(v_proj, 'ampliacion', 1000, null, null, 'fondeo', current_date, null);
  select id into v_consumo from public.registrar_movimiento_hucha(v_proj, 'consumo', 200, 'gasto', null, null, current_date, null);

  -- primera anulación: OK, restaura el restante
  perform public.registrar_movimiento_hucha(v_proj, 'anulacion', 200, null, null, null, current_date, v_consumo);
  if (select remaining from public.hucha_banks where project_id = v_proj) <> 1000 then
    raise exception 'la anulación no restauró el restante';
  end if;

  -- segunda anulación del mismo consumo: rechazada
  ok := true;
  begin perform public.registrar_movimiento_hucha(v_proj, 'anulacion', 200, null, null, null, current_date, v_consumo); ok := false;
  exception when others then null; end;
  if not ok then raise exception 'la doble anulación no fue rechazada'; end if;

  delete from public.projects where id = v_proj;  -- cascade borra banco + movimientos
  raise notice 'OK anulacion dedup';
end $$;
```

- [ ] **Step 4: Correr el test** vía MCP `execute_sql`. Esperado: sin excepción (`NOTICE: OK anulacion dedup`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0012_hucha_anulacion_dedup_guard.sql supabase/tests/hucha_anulacion_dedup.sql
git commit -m "fix(hucha): impedir doble anulación del mismo movimiento en el ledger"
```

---

## Task 2: Ampliar presupuesto (admin)

**Files:**
- Modify: `app/(hucha)/presupuestos/[id]/actions.ts`, `app/(hucha)/presupuestos/[id]/page.tsx`
- Create: `app/(hucha)/presupuestos/[id]/AmpliarForm.tsx`
- Test: `e2e/hucha-admin-ampliar.spec.ts`

**Interfaces:**
- Consumes: RPC `registrar_movimiento_hucha` (tipo `ampliacion`).
- Produces: Server Action `ampliarPresupuesto(projectId: string, input: { monto: number; motivo: string; referencia: string; fecha: string }): Promise<{ ok: true } | { ok: false; error: string }>`; componente `AmpliarForm` (admin).

- [ ] **Step 1: Agregar `ampliarPresupuesto` a `actions.ts`** (debajo de `registrarConsumo`)

```ts
export async function ampliarPresupuesto(
  projectId: string,
  input: { monto: number; motivo: string; referencia: string; fecha: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isFinite(input.monto) || input.monto <= 0) return { ok: false, error: 'El monto debe ser mayor a 0.' }
  if (!input.motivo.trim()) return { ok: false, error: 'El motivo es obligatorio.' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('registrar_movimiento_hucha', {
    p_project_id: projectId,
    p_type: 'ampliacion',
    p_amount: input.monto,
    p_reason: input.motivo.trim(),
    p_reference: input.referencia.trim() || null,
    p_entry_date: input.fecha || undefined,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/presupuestos/${projectId}`)
  revalidatePath('/presupuestos')
  return { ok: true }
}
```

> Nota: `actions.ts` ya importa `createClient` de `@/lib/supabase/server` y `revalidatePath` de `next/cache` (los usa `registrarConsumo`). No re-importar.

- [ ] **Step 2: Crear `AmpliarForm.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ampliarPresupuesto } from './actions'

const today = () => new Date().toISOString().slice(0, 10)

export default function AmpliarForm({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [monto, setMonto] = useState('')
  const [motivo, setMotivo] = useState('')
  const [referencia, setReferencia] = useState('')
  const [fecha, setFecha] = useState(today())
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const res = await ampliarPresupuesto(projectId, { monto: Number(monto), motivo, referencia, fecha })
    setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Presupuesto ampliado')
    setMonto(''); setMotivo(''); setReferencia('')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-3">
      <h3 className="font-display text-base font-semibold">Ampliar presupuesto</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <input aria-label="Monto" type="number" step="0.01" min="0" placeholder="Monto (€)" value={monto}
          onChange={(e) => setMonto(e.target.value)} className="rounded border border-border px-3 py-2" />
        <input aria-label="Fecha" type="date" max={today()} value={fecha}
          onChange={(e) => setFecha(e.target.value)} className="rounded border border-border px-3 py-2" />
        <input aria-label="Motivo" placeholder="Motivo" value={motivo}
          onChange={(e) => setMotivo(e.target.value)} className="rounded border border-border px-3 py-2 sm:col-span-2" />
        <input aria-label="Referencia" placeholder="Referencia (opcional)" value={referencia}
          onChange={(e) => setReferencia(e.target.value)} className="rounded border border-border px-3 py-2 sm:col-span-2" />
      </div>
      <button type="submit" disabled={saving} className="rounded bg-brand px-4 py-2 text-white">
        {saving ? 'Ampliando…' : 'Ampliar'}
      </button>
    </form>
  )
}
```

- [ ] **Step 3: Modificar `page.tsx`** — obtener el rol y renderizar `AmpliarForm` solo para admin

Reemplazar el cuerpo para: (a) crear el server client y leer el rol; (b) renderizar `AmpliarForm` admin-only encima del bloque de tarjetas. Cambios concretos:

```tsx
// imports nuevos arriba:
import { createClient } from '@/lib/supabase/server'
import AmpliarForm from './AmpliarForm'

// dentro de DetallePage, después de obtener movements:
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
const { data: me } = await supabase.from('profiles').select('role').eq('id', user!.id).single()
const isAdmin = me?.role === 'admin'

// en el JSX, justo después del bloque <div className="mb-10"><ConsumoForm .../></div>:
{isAdmin && <div className="mb-10"><AmpliarForm projectId={project.id} /></div>}
```

- [ ] **Step 4: Escribir la E2E** (`e2e/hucha-admin-ampliar.spec.ts`) — sesión admin

```ts
import { test, expect } from '@playwright/test'
import fs from 'node:fs'

const fixture = JSON.parse(fs.readFileSync('e2e/.fixture.json', 'utf8'))

test('un admin amplía el presupuesto y sube el asignado/restante', async ({ page }) => {
  await page.goto(`/presupuestos/${fixture.projectAssignedId}`)
  await expect(page.getByRole('heading', { name: /ampliar presupuesto/i })).toBeVisible()
  await page.getByLabel('Monto').fill('250')
  await page.getByLabel('Motivo').fill('Paquete extra E2E')
  await page.getByRole('button', { name: /^ampliar$/i }).click()
  // el fondeo inicial del fixture es 500; tras ampliar 250 el asignado debe mostrar 750,00
  await expect(page.locator('.tabular-money').filter({ hasText: '750,00' }).first()).toBeVisible()
})
```

- [ ] **Step 5: Wirear la E2E al proyecto admin**

En `playwright.config.ts`, agregar `'**/hucha-admin-*.spec.ts'` al `testMatch` del proyecto `chromium-horas-admin` (reusa la sesión admin) y al `testIgnore` del proyecto `chromium` (HUCHA manager). No tocar los demás proyectos.

- [ ] **Step 6: Correr la E2E** (dev server del usuario): `npx playwright test hucha-admin-ampliar --project=chromium-horas-admin`. Esperado: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/\(hucha\)/presupuestos/\[id\]/actions.ts app/\(hucha\)/presupuestos/\[id\]/AmpliarForm.tsx app/\(hucha\)/presupuestos/\[id\]/page.tsx e2e/hucha-admin-ampliar.spec.ts playwright.config.ts
git commit -m "feat(hucha): ampliar presupuesto desde el detalle (admin)"
```

---

## Task 3: Anular movimiento (admin)

**Files:**
- Modify: `lib/hucha/types.ts`, `lib/hucha/queries.ts`, `components/hucha/MovementsTable.tsx`, `app/(hucha)/presupuestos/[id]/actions.ts`, `app/(hucha)/presupuestos/[id]/page.tsx`
- Create: `components/hucha/AnularButton.tsx`
- Test: `e2e/hucha-admin-anular.spec.ts`

**Interfaces:**
- Consumes: RPC `registrar_movimiento_hucha` (tipo `anulacion`).
- Produces: Server Action `anularMovimiento(projectId: string, movementId: string): Promise<{ ok: true } | { ok: false; error: string }>`; `AnularButton`; `MovementsTable` con props admin.

- [ ] **Step 1: Agregar `corrects_movement_id` al tipo** (`lib/hucha/types.ts`, en `HuchaMovementRow`)

```ts
  entry_date: string
  created_at: string
  corrects_movement_id: string | null
```

- [ ] **Step 2: Traerlo en `getMovements`** (`lib/hucha/queries.ts`)

Cambiar el `.select(...)` de `getMovements` para incluir `corrects_movement_id`:

```ts
    .select('id, type, amount, balance_before, balance_after, description, reference, reason, actor_name, entry_date, created_at, corrects_movement_id')
```

- [ ] **Step 3: Agregar `anularMovimiento` a `actions.ts`**

```ts
export async function anularMovimiento(
  projectId: string, movementId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('registrar_movimiento_hucha', {
    p_project_id: projectId,
    p_type: 'anulacion',
    p_amount: 1, // la RPC deriva el efecto real del movimiento original; sólo cumple la validación > 0
    p_corrects_movement_id: movementId,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/presupuestos/${projectId}`)
  revalidatePath('/presupuestos')
  return { ok: true }
}
```

- [ ] **Step 4: Crear `AnularButton.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { anularMovimiento } from '@/app/(hucha)/presupuestos/[id]/actions'

export default function AnularButton({ projectId, movementId, disabled }: {
  projectId: string; movementId: string; disabled: boolean
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  if (disabled) return <span className="text-xs text-foreground/30">—</span>
  async function onClick() {
    if (!confirm('¿Anular este movimiento? Se registrará una reversión.')) return
    setLoading(true)
    const res = await anularMovimiento(projectId, movementId)
    setLoading(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Movimiento anulado')
    router.refresh()
  }
  return (
    <button onClick={onClick} disabled={loading} className="text-xs text-(--excedido) hover:underline">
      {loading ? 'Anulando…' : 'Anular'}
    </button>
  )
}
```

- [ ] **Step 5: Modificar `MovementsTable.tsx`** para una columna de acciones admin

Agregar props y la columna. La tabla recibe `isAdmin`, `projectId` y `anulledIds` (un `Set<string>` con los ids ya anulados). Cambios:

```tsx
import type { HuchaMovementRow } from '@/lib/hucha/types'
import { formatEUR } from '@/lib/hucha/format'
import AnularButton from '@/components/hucha/AnularButton'

const TYPE_LABELS: Record<HuchaMovementRow['type'], string> = {
  consumo: 'Consumo', ampliacion: 'Ampliación', correccion: 'Corrección', anulacion: 'Anulación',
}

export default function MovementsTable({ movements, isAdmin = false, projectId = '', anulledIds }: {
  movements: HuchaMovementRow[]; isAdmin?: boolean; projectId?: string; anulledIds?: Set<string>
}) {
  if (movements.length === 0) {
    return <p className="text-sm text-foreground/55">Sin movimientos todavía.</p>
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-(--muted-surface) text-left text-xs text-foreground/55">
          <tr>
            <th className="px-4 py-3 font-medium">Fecha</th>
            <th className="px-4 py-3 font-medium">Tipo</th>
            <th className="px-4 py-3 font-medium">Descripción</th>
            <th className="px-4 py-3 font-medium text-right">Importe</th>
            <th className="px-4 py-3 font-medium text-right">Saldo</th>
            <th className="px-4 py-3 font-medium">Por</th>
            {isAdmin && <th className="px-4 py-3 font-medium text-right">Acción</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {movements.map((m) => (
            <tr key={m.id}>
              <td className="px-4 py-3 text-foreground/70">{m.entry_date}</td>
              <td className="px-4 py-3">{TYPE_LABELS[m.type]}</td>
              <td className="px-4 py-3 text-foreground/70">{m.description ?? m.reason ?? '—'}</td>
              <td className={`px-4 py-3 text-right tabular-money ${m.amount < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                {m.amount < 0 ? '' : '+'}{formatEUR(m.amount)}
              </td>
              <td className="px-4 py-3 text-right tabular-money text-foreground/70">{formatEUR(m.balance_after)}</td>
              <td className="px-4 py-3 text-foreground/55">{m.actor_name}</td>
              {isAdmin && (
                <td className="px-4 py-3 text-right">
                  <AnularButton projectId={projectId} movementId={m.id}
                    disabled={m.type === 'anulacion' || (anulledIds?.has(m.id) ?? false)} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 6: Modificar `page.tsx`** para computar `anulledIds` y pasar props admin a `MovementsTable`

```tsx
// computar el set de ids ya anulados (los corrects_movement_id de las filas tipo anulacion):
const anulledIds = new Set(movements.filter((m) => m.type === 'anulacion' && m.corrects_movement_id).map((m) => m.corrects_movement_id as string))

// reemplazar <MovementsTable movements={movements} /> por:
<MovementsTable movements={movements} isAdmin={isAdmin} projectId={project.id} anulledIds={anulledIds} />
```

- [ ] **Step 7: Escribir la E2E** (`e2e/hucha-admin-anular.spec.ts`) — sesión admin, self-contained

```ts
import { test, expect } from '@playwright/test'
import fs from 'node:fs'

const fixture = JSON.parse(fs.readFileSync('e2e/.fixture.json', 'utf8'))

test('un admin anula una ampliación y aparece el asiento de reversión', async ({ page }) => {
  page.on('dialog', (d) => d.accept()) // aceptar el confirm() ANTES de cualquier click
  await page.goto(`/presupuestos/${fixture.projectAssignedId}`)

  // crear una ampliación para luego anularla (self-contained)
  await page.getByLabel('Monto').fill('300')
  await page.getByLabel('Motivo').fill('Para anular E2E')
  await page.getByRole('button', { name: /^ampliar$/i }).click()
  await expect(page.getByText('Para anular E2E')).toBeVisible()

  // anular la fila de esa ampliación
  const fila = page.getByRole('row').filter({ hasText: 'Para anular E2E' })
  await fila.getByRole('button', { name: /anular/i }).click()

  // aparece el asiento de Anulación en el historial
  await expect(page.getByText('Anulación').first()).toBeVisible()
})
```

- [ ] **Step 8: Correr la E2E** (dev server del usuario): `npx playwright test hucha-admin-anular --project=chromium-horas-admin`. Esperado: PASS. (El proyecto ya quedó wireado en Task 2 Step 5 con el glob `hucha-admin-*`.)

- [ ] **Step 9: Commit**

```bash
git add lib/hucha/types.ts lib/hucha/queries.ts components/hucha/MovementsTable.tsx components/hucha/AnularButton.tsx app/\(hucha\)/presupuestos/\[id\]/actions.ts app/\(hucha\)/presupuestos/\[id\]/page.tsx e2e/hucha-admin-anular.spec.ts
git commit -m "feat(hucha): anular movimientos desde el historial (admin)"
```

---

## Cierre del Plan 3b-i

- [ ] **Review de rama completa** verificando trazabilidad con el spec y el PDF (§8, §4.2, §9).
- [ ] **Actualizar** `docs/superpowers/REGISTRO-DECISIONES-Y-ESTADO.md` con "HUCHA Plan 3b-i (admin ampliar/corregir) — completado".

> **No incluido (siguientes sub-proyectos):** 3b-ii dashboard global con filtros; 3b-iii descargas Excel/CSV.
