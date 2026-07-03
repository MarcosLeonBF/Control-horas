# Descripciones por departamento + descripción libre — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La descripción al registrar horas es texto libre en proyectos normales y un desplegable por departamento (dinámico) en el proyecto "Departamento".

**Architecture:** Nueva tabla `departamento_descripciones` (calcada de `departamento_etapas`). El motor `guardar_registro` valida la descripción contra el departamento en "Departamento" y no la restringe (solo no-vacía) en proyectos cliente. Se elimina `position_descripciones` y la gestión global de descripciones; las descripciones se administran dentro de cada departamento (acordeón en Catálogos).

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), Supabase (Postgres, RLS, RPC SECURITY DEFINER), TypeScript, Base UI / shadcn, lucide.

## Global Constraints

- Proyecto Supabase `msfylcgtlathccmxuheq`. Se trabaja **directo sobre producción** (sin usuarios reales). Migraciones vía `apply_migration` + archivo en `supabase/migrations/`. Tests SQL vía `execute_sql`.
- Git: rama local `master` que trackea `origin/main`. Commits en español (estilo `feat(...)`/`refactor(...)`). Push con `git push origin HEAD:main`.
- Cerrar cada commit con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- UI en español, shadcn/Base UI, paleta de marca ya existente. Sin `any` en TS.
- Los registros en prod están en blanco (no hay descripciones viejas que migrar).
- Numeración de migraciones: la última es `0024`; la nueva es `0025`.

---

### Task 1: Migración 0025 — modelo + motor

**Files:**
- Create: `supabase/migrations/0025_horas_descripcion_por_departamento.sql`
- Create: `supabase/tests/horas_rpc_descripcion_departamento.sql`
- Modify: `supabase/tests/horas_rpc_campos_por_posicion.sql`
- Modify: `supabase/tests/horas_rpc_guardar.sql`

**Interfaces:**
- Produces: tabla `public.departamento_descripciones(id, departamento_id, descripcion_id, created_at)`; función `public.guardar_registro(uuid, jsonb)` con validación de descripción por departamento; se elimina `public.position_descripciones`.

- [ ] **Step 1: Escribir el test que falla** — `supabase/tests/horas_rpc_descripcion_departamento.sql`. Siembra una descripción para un departamento del admin, y prueba: Departamento con esa descripción → OK; Departamento con descripción inexistente → rechazada; proyecto cliente con texto libre arbitrario → OK; descripción vacía → rechazada. Limpia lo que crea.

```sql
-- Descripción por departamento (0025). En "Departamento" la descripción debe pertenecer
-- al departamento; en proyecto cliente es texto libre (solo no-vacía).
do $$
declare
  v_admin      uuid := '1de8f167-ca74-49eb-a2b7-3273b63e8c2b';
  v_intern     uuid;
  v_dep_id     uuid;
  v_dep_name   text;
  v_desc_id    uuid;
  v_desc_name  text := '__desc_test_dep__';
  v_etapa      uuid;
  v_op         uuid;
  v_op_area    uuid;
  v_op_desc    text := '__texto_libre_cliente__';
  v_etapa_op   uuid;
  v_log        uuid;
  ok           bool;
begin
  select id into v_intern from public.areas where is_internal = true;
  -- Un departamento de la posición del admin (para pasar la validación de departamento).
  select dep.id, dep.name into v_dep_id, v_dep_name
    from public.position_departamentos pd
    join public.departamentos dep on dep.id = pd.departamento_id
    where pd.position_id = (select position_id from public.profiles where id = v_admin)
    limit 1;
  select pe.etapa_id into v_etapa
    from public.position_etapas pe
    where pe.position_id = (select position_id from public.profiles where id = v_admin) limit 1;
  if v_intern is null or v_dep_id is null then
    raise exception 'precondición: falta área interna o departamento en la posición del admin';
  end if;

  -- Sembrar una descripción y ligarla al departamento.
  insert into public.descripciones(name) values (v_desc_name)
    on conflict (name) do nothing;
  select id into v_desc_id from public.descripciones where name = v_desc_name;
  insert into public.departamento_descripciones(departamento_id, descripcion_id)
    values (v_dep_id, v_desc_id) on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);
  delete from public.time_logs where user_id = v_admin and entry_date = current_date;

  -- Departamento con descripción del departamento → OK
  v_log := public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date',current_date,'project','Departamento','area_id',v_intern,'department',v_dep_name,'etapa_id',v_etapa,'hours',1,'description',v_desc_name)
  ));
  if v_log is null then raise exception 'Departamento con descripción del depto debería aceptarse'; end if;
  delete from public.time_logs where id = v_log;

  -- Departamento con descripción inexistente → rechazada
  ok := true;
  begin perform public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date',current_date,'project','Departamento','area_id',v_intern,'department',v_dep_name,'etapa_id',v_etapa,'hours',1,'description','__no_existe_en_depto__')
  )); ok := false; exception when others then null; end;
  if not ok then raise exception 'Departamento con descripción ajena no fue rechazada'; end if;

  -- Proyecto cliente con texto libre → OK (operativo configurado)
  select p.id into v_op
  from public.profiles p
  join public.user_areas ua on ua.user_id = p.id
  where p.role='operativo' and p.status='activo'
    and exists (select 1 from public.position_etapas pe where pe.position_id = p.position_id)
  limit 1;
  if v_op is not null then
    select ua.area_id into v_op_area from public.user_areas ua
      where ua.user_id = v_op and ua.area_id <> v_intern limit 1;
    select pe.etapa_id into v_etapa_op from public.position_etapas pe
      where pe.position_id = (select position_id from public.profiles where id=v_op) limit 1;
    perform set_config('request.jwt.claims', json_build_object('sub', v_op::text, 'role','authenticated')::text, true);
    delete from public.time_logs where user_id = v_op and entry_date = current_date;
    v_log := public.guardar_registro(null, jsonb_build_array(
      jsonb_build_object('entry_date',current_date,'project','Cliente Z','area_id',v_op_area,'department','Clientes','etapa_id',v_etapa_op,'hours',1,'description',v_op_desc)
    ));
    if v_log is null then raise exception 'cliente con texto libre debería aceptarse'; end if;
    delete from public.time_logs where id = v_log;

    -- descripción vacía → rechazada
    ok := true;
    begin perform public.guardar_registro(null, jsonb_build_array(
      jsonb_build_object('entry_date',current_date,'project','Cliente Z','area_id',v_op_area,'department','Clientes','etapa_id',v_etapa_op,'hours',1,'description','')
    )); ok := false; exception when others then null; end;
    if not ok then raise exception 'descripción vacía no fue rechazada'; end if;
  end if;

  -- limpieza de la siembra
  delete from public.departamento_descripciones where departamento_id = v_dep_id and descripcion_id = v_desc_id;
  delete from public.descripciones where id = v_desc_id;
  raise notice 'OK rpc descripción por departamento';
end $$;
```

- [ ] **Step 2: Correr el test → debe FALLAR (rojo)**

Run: `execute_sql` con el contenido del Step 1.
Expected: error `relation "public.departamento_descripciones" does not exist` (la tabla aún no existe). Es el rojo esperado (feature ausente).

- [ ] **Step 3: Escribir la migración** — `supabase/migrations/0025_horas_descripcion_por_departamento.sql`: (a) crea `departamento_descripciones`; (b) `create or replace` de `guardar_registro` idéntica a 0024 salvo la validación de descripción; (c) `drop table position_descripciones`.

Cuerpo de la función = copiar 0024 y, dentro del bucle por línea:
- **Eliminar** el bloque:
```sql
    if not exists (
      select 1 from public.profiles pr
      join public.position_descripciones pd on pd.position_id = pr.position_id
      join public.descripciones d on d.id = pd.descripcion_id
      where pr.id = v_owner and d.name = btrim(v_line->>'description')
    ) then
      raise exception 'descripción no permitida para la posición del usuario';
    end if;
```
- **Dentro** de la rama `if btrim(v_line->>'project') = 'Departamento' then`, tras la validación de departamento, **agregar**:
```sql
      -- Descripción ∈ descripciones del departamento de la línea.
      if not exists (
        select 1
        from public.departamentos dep
        join public.departamento_descripciones dd on dd.departamento_id = dep.id
        join public.descripciones d on d.id = dd.descripcion_id
        where dep.name = btrim(v_line->>'department')
          and d.name = btrim(v_line->>'description')
      ) then
        raise exception 'descripción no permitida para el departamento';
      end if;
```
- En proyecto cliente: **sin** validación de descripción (la no-vacía ya se valida antes en el bucle).

Al final del archivo:
```sql
create table public.departamento_descripciones (
  id uuid primary key default gen_random_uuid(),
  departamento_id uuid not null references public.departamentos(id) on delete cascade,
  descripcion_id  uuid not null references public.descripciones(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (departamento_id, descripcion_id)
);
create index dep_descr_dep_idx    on public.departamento_descripciones(departamento_id);
create index dep_descr_descr_idx  on public.departamento_descripciones(descripcion_id);
alter table public.departamento_descripciones enable row level security;
create policy dep_descr_select on public.departamento_descripciones for select to authenticated using (true);
create policy dep_descr_admin_write on public.departamento_descripciones for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop table if exists public.position_descripciones;
```
> Nota de orden: crear `departamento_descripciones` ANTES del `create or replace function` no es necesario (la función se resuelve en runtime), pero el `drop table position_descripciones` debe ir DESPUÉS del `create or replace` (para que la función ya no la referencie).

- [ ] **Step 4: Aplicar la migración a prod**

Run: `apply_migration(name='0025_horas_descripcion_por_departamento', query=<contenido>)`.
Expected: `{"success": true}`.

- [ ] **Step 5: Correr el test del Step 1 → debe PASAR (verde)**

Run: `execute_sql` con el test.
Expected: `[]` (sin excepción; `raise notice 'OK...'`).

- [ ] **Step 6: Ajustar los tests existentes** que asumían descripción por posición:
  - `horas_rpc_campos_por_posicion.sql`: quitar los sub-casos de "descripción fuera de posición" (admin/operativo). Para las líneas de "Departamento" del admin, usar una descripción **sembrada en su departamento** (o sembrarla al inicio como en el test nuevo). Para líneas cliente, usar texto libre.
  - `horas_rpc_guardar.sql`: las líneas cliente del operativo usan texto libre en `description`; las líneas "Departamento" del admin usan una descripción **de ese departamento** (sembrada al inicio del test) o se cambia el proyecto a cliente. Mantener el resto de aserciones (fechas, duplicados, área, edición, cross-user).

- [ ] **Step 7: Correr ambos tests ajustados → verde**

Run: `execute_sql` de cada uno. Expected: `[]`. Luego re-limpiar auditoría: `delete from public.time_log_audit; delete from public.time_logs;` y verificar `count = 0`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0025_horas_descripcion_por_departamento.sql supabase/tests/horas_rpc_descripcion_departamento.sql supabase/tests/horas_rpc_campos_por_posicion.sql supabase/tests/horas_rpc_guardar.sql
git commit -m "feat(registro): descripción por departamento en el motor + drop position_descripciones"
```

---

### Task 2: Catálogos — backend (acciones + read-model)

**Files:**
- Modify: `app/(horas)/admin/catalogos/actions.ts`
- Modify: `app/(horas)/admin/catalogos/page.tsx`
- Modify: `lib/horas/types.ts` (tipo `DepartamentoRow` gana `descripciones: string[]`)

**Interfaces:**
- Produces: `setDepartamentoDescripcionesNombres(id: string, names: string[]): Promise<Result>`; el read-model de departamentos incluye `descripciones: string[]` (nombres) además de `etapaIds`. Se elimina `setPosicionDescripciones` y las acciones globales `crearDescripcion`/`renombrarDescripcion`/`toggleDescripcion`/`eliminarDescripcion`.

- [ ] **Step 1: Añadir `setDepartamentoDescripcionesNombres`** en `actions.ts`, calcada de `setDepartamentoEtapasNombres` (crea/enlaza descripciones por nombre en `departamento_descripciones`).

```ts
// Sincroniza las descripciones de un departamento a partir de nombres (creando las que no existan).
export async function setDepartamentoDescripcionesNombres(id: string, names: string[]): Promise<Result> {
  const { supabase, error } = await requireAdmin()
  if (error) return { ok: false, error }

  const descIds: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    const { data: existing } = await supabase.from('descripciones').select('id').eq('name', name).maybeSingle()
    if (existing?.id) {
      descIds.push(existing.id as string)
    } else {
      const { data: created, error: cErr } = await supabase.from('descripciones').insert({ name }).select('id').single()
      if (cErr) return { ok: false, error: friendly(cErr) }
      descIds.push(created!.id as string)
    }
  }

  const { error: delErr } = await supabase.from('departamento_descripciones').delete().eq('departamento_id', id)
  if (delErr) return { ok: false, error: friendly(delErr) }
  if (descIds.length) {
    const { error: linkErr } = await supabase.from('departamento_descripciones')
      .insert(descIds.map((descripcion_id) => ({ departamento_id: id, descripcion_id })))
    if (linkErr) return { ok: false, error: friendly(linkErr) }
  }
  return { ok: true }
}
```

- [ ] **Step 2: Eliminar** de `actions.ts`: `setPosicionDescripciones`, y las acciones globales `crearDescripcion`, `renombrarDescripcion`, `toggleDescripcion`, `eliminarDescripcion`. (El bloque `// ── Descripciones ──` se retira; su alta ocurre vía Step 1.)

- [ ] **Step 3: Actualizar el read-model** en `app/(horas)/admin/catalogos/page.tsx`: para cada departamento, adjuntar sus `descripciones` (nombres) leyendo `departamento_descripciones` + `descripciones`. Quitar la lectura de `position_descripciones` y del listado global de descripciones que alimentaba la sección eliminada / la card de posiciones.

- [ ] **Step 4: Actualizar `DepartamentoRow`** en `lib/horas/types.ts` para incluir `descripciones: string[]` (nombres). (Y `PosicionRow` pierde `descripcionIds` en `CatalogosPanel`/read-model — se ajusta en Task 3.)

- [ ] **Step 5: Typecheck**

Run: `node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (ignorar errores stale de `.next/types`). Nota: quedará rojo hasta terminar Task 3 (CatalogosPanel aún referencia lo eliminado). Está bien; se verifica al cierre de Task 3.

- [ ] **Step 6: Commit**

```bash
git add "app/(horas)/admin/catalogos/actions.ts" "app/(horas)/admin/catalogos/page.tsx" lib/horas/types.ts
git commit -m "feat(catalogos): descripciones por departamento (backend) + retirar descripciones por posición"
```

---

### Task 3: Catálogos — UI (acordeón)

**Files:**
- Modify: `components/horas/CatalogosPanel.tsx`

**Sub-skill:** aplicar `frontend-design` para el acordeón (coherente con la sección Posiciones).

**Interfaces:**
- Consumes: `setDepartamentoDescripcionesNombres` (Task 2); `DepartamentoRow.descripciones` (Task 2).

- [ ] **Step 1: Reestructurar `DepartamentosSection` en acordeón**: cada departamento se expande con chevron (patrón de `PosicionesSection`) y muestra dos paneles/cards agrupados: **Etapas** y **Descripciones**, ambos como lista de chips con "escribe y Enter" (reutilizar el patrón de chips que ya existe para etapas de departamento). El de Descripciones guarda con `setDepartamentoDescripcionesNombres`.

- [ ] **Step 2: Quitar la card "Descripciones" de `PosicionesSection`** (y su estado `descripcionSel`, `saveDescripciones`, el prop `descripciones`, y `descripcionIds` de `PosicionRow`). Quedan Áreas / Etapas / Departamentos.

- [ ] **Step 3: Eliminar la `Seccion` global "Descripciones"** del `CatalogosPanel` (la que usaba `crearDescripcion` etc.) y su prop `descripciones` de nivel panel.

- [ ] **Step 4: Typecheck limpio**

Run: `node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Expected: sin errores fuera de `.next/types`.

- [ ] **Step 5: Verificar la UI** (el dev server lo gestiona el usuario; no levantarlo). Pedir al usuario una captura o describir el acordeón esperado; opcional E2E de Catálogos.

- [ ] **Step 6: Commit**

```bash
git add components/horas/CatalogosPanel.tsx
git commit -m "feat(catalogos): acordeón de departamentos con etapas y descripciones"
```

---

### Task 4: Registro — read-model + formulario

**Files:**
- Modify: `lib/horas/queries.ts`
- Modify: `app/(horas)/registrar/page.tsx`
- Modify: `components/horas/RegistroForm.tsx`

**Interfaces:**
- Consumes: `DepartamentoRow.descripciones` (Task 2).
- Produces: `RegistroForm` sin prop `descripciones`; el control de descripción es `<select>` de `departamentos.find(d=>d.name===l.department)?.descripciones` en líneas "Departamento", `<input>` de texto libre en el resto.

- [ ] **Step 1: `getCatalogos`** (en `queries.ts`) devuelve, por departamento, `descripciones: string[]` (nombres) además de `etapaIds`. Eliminar `getMyPositionDescripcionIds` (ya no se usa). Leer `departamento_descripciones` + `descripciones` y mapear por departamento (como se hace hoy con `departamento_etapas`).

- [ ] **Step 2: `registrar/page.tsx`**: eliminar `getMyPositionDescripcionIds`/`allowedDescripciones`. Ya no se pasa `descripciones` al `RegistroForm`; los `departamentos` (allowedDepartamentos) ya llevan sus `descripciones`.

- [ ] **Step 3: `RegistroForm`**: reemplazar el control `desc`. Para líneas "Departamento": `<select>` con las descripciones del departamento elegido (`departamentos.find(d => d.name === l.department)?.descripciones ?? []`); vacío → `— Sin descripciones (contacta al admin) —`. Para el resto: `<input type="text">` obligatorio.

```tsx
const isDep = isDepartamento(l.project)
const deptDescs = isDep ? (departamentos.find((d) => d.name === l.department)?.descripciones ?? []) : []
const desc = isDep ? (
  deptDescs.length === 0 ? (
    <select aria-label="Descripción" value="" disabled className={field}>
      <option value="">— Sin descripciones (contacta al admin) —</option>
    </select>
  ) : (
    <select aria-label="Descripción" value={l.description} onChange={(e) => update(i, { description: e.target.value })} className={field}>
      <option value="">— Descripción —</option>
      {deptDescs.map((name) => <option key={name} value={name}>{name}</option>)}
    </select>
  )
) : (
  <input aria-label="Descripción" type="text" value={l.description}
    onChange={(e) => update(i, { description: e.target.value })} placeholder="Descripción…" className={field} />
)
```

- [ ] **Step 4: Limpieza de descripción en transiciones** dentro de `update()`: cuando la línea es "Departamento" y cambia `project` o `department`, si `next.description` no está en las descripciones del departamento nuevo → `next.description = ''`. Al salir de "Departamento", conservar el texto (no limpiar). Quitar el prop `descripciones` y el fallback `__cur_` del componente.

- [ ] **Step 5: Typecheck limpio**

Run: `node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Expected: sin errores fuera de `.next/types`.

- [ ] **Step 6: Verificar** el registro (usuario/E2E): en "Departamento" el desplegable muestra las descripciones del departamento; en proyecto cliente aparece el input libre. Guardar en ambos casos.

- [ ] **Step 7: Commit**

```bash
git add lib/horas/queries.ts "app/(horas)/registrar/page.tsx" components/horas/RegistroForm.tsx
git commit -m "feat(registro): descripción libre en cliente y desplegable por departamento"
```

---

### Task 5: Cierre — verificación y push

- [ ] **Step 1: Typecheck global limpio** (fuera de `.next/types`).
- [ ] **Step 2: Correr los 3 tests SQL** (`horas_rpc_descripcion_departamento`, `horas_rpc_campos_por_posicion`, `horas_rpc_guardar`) → verde. Re-limpiar `time_log_audit`/`time_logs`/`horas_alertas` y verificar `count = 0`.
- [ ] **Step 3: Actualizar** `docs/superpowers/REGISTRO-DECISIONES-Y-ESTADO.md` con una entrada de la feature (descripción por departamento / libre; retiro de position_descripciones).
- [ ] **Step 4: Push**

```bash
git push origin HEAD:main
```

## Self-Review (autor)

- **Cobertura del spec:** modelo (Task 1), motor (Task 1), Catálogos backend (Task 2) + UI acordeón (Task 3), registro (Task 4), pruebas (Task 1/5), retiro de `position_descripciones` (Task 1) y de la sección global (Task 3). ✔
- **Sin placeholders** en los pasos críticos (migración, motor, acciones, formulario con código real). La UI del acordeón se apoya en el patrón ya existente de `PosicionesSection`/chips de etapas (mismo archivo).
- **Consistencia de tipos:** `DepartamentoRow.descripciones: string[]` se define en Task 2 y se consume en Tasks 3/4; `PosicionRow` pierde `descripcionIds` en Tasks 2/3 de forma coherente.
