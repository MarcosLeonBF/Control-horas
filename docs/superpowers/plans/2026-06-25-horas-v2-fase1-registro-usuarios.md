# Horas v2 · Fase 1 (Registro diario + usuarios) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la Fase 1 de Horas v2: registro diario multilínea (padre + líneas, guardado transaccional), catálogos de áreas/etapas, alta mínima de usuarios y vistas por rol, sobre la fundación compartida con HUCHA.

**Architecture:** Next.js 16 (App Router, Server Components + Server Actions) + Supabase (Postgres, RLS, RPC `security definer`). Strangler fig: Horas v2 vive en el grupo de rutas `app/(horas)/…`; la legacy `app/(app)/…` queda congelada. La lógica de escritura (guardar/anular registro) vive en RPCs transaccionales; la lectura usa el cliente server RLS-scoped. Proyectos se leen del Excel en vivo (Microsoft Graph, ya existente).

**Tech Stack:** Next 16, React Server Components, `@supabase/ssr`, Postgres 17, Playwright (E2E), shadcn/ui, Tailwind v4 (paleta de marca).

**Spec:** [`../specs/2026-06-25-horas-v2-fase1-registro-usuarios-design.md`](../specs/2026-06-25-horas-v2-fase1-registro-usuarios-design.md)

## Global Constraints

- **Middleware Next 16:** la convención es `proxy.ts` (ya existe). **NUNCA** crear `middleware.ts` en la raíz (rompe el build: "Both middleware file and proxy file are detected").
- **Roles:** exactamente 3 en `profiles.role`: `operativo`, `manager`, `admin`. No inventar otros.
- **Dev server:** lo gestiona el usuario. La config de Playwright **no** debe tener bloque `webServer`. Asumir `http://localhost:3000` levantado. Nunca correr `npm run dev`/`start`.
- **Migraciones:** aplicar a producción vía MCP Supabase `apply_migration` (project_id `msfylcgtlathccmxuheq`). Numeración a partir de `0005_`. Guardar copia del SQL en `supabase/migrations/`.
- **Tests SQL:** correr vía MCP `execute_sql` impersonando roles con `set local request.jwt.claims = '{"sub":"<uid>","role":"authenticated"}'`. Guardar scripts en `supabase/tests/`.
- **Estética:** paleta de marca + shadcn/ui (clases y tokens ya en `app/globals.css`). Diseño limpio, corporativo, dinero/horas con `.tabular-money` cuando aplique.
- **Horas:** `numeric`, formatear con hasta 1 decimal (`2`, `1.5`), nunca moneda.
- **Commits frecuentes**, en español, terminando con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

**Migraciones (DB):**
- `supabase/migrations/0005_horas_catalogos.sql` — tablas `areas`, `etapas` + seed + RLS.
- `supabase/migrations/0006_horas_user_areas.sql` — tabla `user_areas` + RLS.
- `supabase/migrations/0007_horas_time_logs.sql` — `time_logs`, `time_log_lines` + índices + RLS.
- `supabase/migrations/0008_horas_rpc_guardar.sql` — RPC `guardar_registro_diario`.
- `supabase/migrations/0009_horas_rpc_anular.sql` — RPC `anular_registro_diario`.
- `supabase/tests/horas_*.sql` — asserts por tabla/RPC.

**App (UI):**
- `lib/horas/types.ts` — tipos compartidos de Horas v2.
- `lib/horas/queries.ts` — lecturas RLS-scoped (catálogos, áreas del usuario, registros).
- `lib/horas/format.ts` — `formatHoras(n)`.
- `app/(horas)/layout.tsx` — gate de sesión + nav + marca.
- `app/(horas)/registrar/page.tsx` + `RegistroForm.tsx` + `actions.ts` — registro diario multilínea.
- `app/(horas)/mis-registros/page.tsx` + componentes — listado + edición/anulación propia.
- `app/(horas)/equipo/page.tsx` — vista read-only para manager/admin.
- `app/(horas)/admin/usuarios/page.tsx` + `UsuarioForm.tsx` + `actions.ts` — alta de usuarios.
- `components/horas/*` — selectores y tabla editable.

**E2E:**
- `e2e/helpers/seed-horas.ts` — seed de usuarios (operativo/manager/admin) + áreas.
- `e2e/horas-*.spec.ts` — specs happy-path.

---

## Task 1: Catálogos `areas` y `etapas`

**Files:**
- Create: `supabase/migrations/0005_horas_catalogos.sql`
- Test: `supabase/tests/horas_catalogos.sql`

**Interfaces:**
- Produces: tablas `public.areas(id uuid, name text, is_internal bool, active bool, created_at, updated_at)` y `public.etapas(id uuid, name text, active bool, created_at, updated_at)`. Áreas semilla incluyen una con `is_internal=true` llamada `Interno`.

- [ ] **Step 1: Escribir la migración**

```sql
-- 0005_horas_catalogos.sql — catálogos de áreas y etapas (Horas v2)
create table public.areas (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  is_internal boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.etapas (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Semilla de áreas (editable). "Interno" es el área del proyecto especial "Departamento".
insert into public.areas (name, is_internal) values
  ('CRM', false), ('SEO', false), ('Paid Media', false), ('Diseño', false),
  ('Automatizaciones', false), ('Contenido', false), ('Estrategia', false),
  ('Interno', true);

-- Semilla de etapas (tomadas del código legacy lib/types.ts; editable).
insert into public.etapas (name) values ('Setup'), ('CRM'), ('Servicios Mensuales');

alter table public.areas  enable row level security;
alter table public.etapas enable row level security;

-- Lectura: cualquier usuario autenticado. Escritura: solo admin.
create policy areas_select  on public.areas  for select to authenticated using (true);
create policy etapas_select on public.etapas for select to authenticated using (true);

create policy areas_admin_write on public.areas for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy etapas_admin_write on public.etapas for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
```

- [ ] **Step 2: Aplicar la migración**

Vía MCP `apply_migration` (name `0005_horas_catalogos`, project_id `msfylcgtlathccmxuheq`). Guardar el mismo SQL en `supabase/migrations/0005_horas_catalogos.sql`.

- [ ] **Step 3: Escribir el test SQL** (`supabase/tests/horas_catalogos.sql`)

```sql
-- Verifica semillas y unicidad
do $$
declare n int;
begin
  select count(*) into n from public.areas where is_internal = true and name = 'Interno';
  if n <> 1 then raise exception 'falta área Interno (n=%)', n; end if;
  select count(*) into n from public.etapas where name in ('Setup','CRM','Servicios Mensuales');
  if n <> 3 then raise exception 'faltan etapas semilla (n=%)', n; end if;
  select count(*) into n from public.areas;
  if n < 8 then raise exception 'faltan áreas semilla (n=%)', n; end if;
  raise notice 'OK catalogos';
end $$;
```

- [ ] **Step 4: Correr el test**

Vía MCP `execute_sql` con el contenido del Step 3. Esperado: `NOTICE: OK catalogos`, sin excepción.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0005_horas_catalogos.sql supabase/tests/horas_catalogos.sql
git commit -m "feat(horas): catálogos areas/etapas con seed y RLS"
```

---

## Task 2: Relación `user_areas`

**Files:**
- Create: `supabase/migrations/0006_horas_user_areas.sql`
- Test: `supabase/tests/horas_user_areas.sql`

**Interfaces:**
- Consumes: `public.areas`, `public.profiles`.
- Produces: `public.user_areas(id uuid, user_id uuid, area_id uuid)` con único `(user_id, area_id)`.

- [ ] **Step 1: Escribir la migración**

```sql
-- 0006_horas_user_areas.sql
create table public.user_areas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  area_id    uuid not null references public.areas(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (user_id, area_id)
);
create index user_areas_user_idx on public.user_areas(user_id);

alter table public.user_areas enable row level security;

-- El usuario ve sus propias áreas; manager/admin ven todas; solo admin escribe.
create policy user_areas_select on public.user_areas for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager','admin'))
);
create policy user_areas_admin_write on public.user_areas for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
```

- [ ] **Step 2: Aplicar la migración** (MCP `apply_migration` name `0006_horas_user_areas`; guardar copia).

- [ ] **Step 3: Escribir el test SQL** (`supabase/tests/horas_user_areas.sql`)

```sql
-- Inserta un área a un usuario admin existente y valida unicidad
do $$
declare v_admin uuid; v_area uuid; n int;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  select id into v_area  from public.areas where name = 'CRM';
  if v_admin is null then raise exception 'no hay admin para el test'; end if;
  insert into public.user_areas(user_id, area_id) values (v_admin, v_area)
    on conflict do nothing;
  select count(*) into n from public.user_areas where user_id = v_admin and area_id = v_area;
  if n <> 1 then raise exception 'esperaba 1 fila user_areas (n=%)', n; end if;
  -- limpieza
  delete from public.user_areas where user_id = v_admin and area_id = v_area;
  raise notice 'OK user_areas';
end $$;
```

- [ ] **Step 4: Correr el test** (MCP `execute_sql`). Esperado: `NOTICE: OK user_areas`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_horas_user_areas.sql supabase/tests/horas_user_areas.sql
git commit -m "feat(horas): relación user_areas con RLS"
```

---

## Task 3: `time_logs` + `time_log_lines`

**Files:**
- Create: `supabase/migrations/0007_horas_time_logs.sql`
- Test: `supabase/tests/horas_time_logs.sql`

**Interfaces:**
- Consumes: `public.profiles`, `public.areas`, `public.etapas`.
- Produces: `public.time_logs(id, user_id, entry_date, total_hours, status, created_by, updated_by, created_at, updated_at)` con `status ∈ {guardado,editado,anulado}`; `public.time_log_lines(id, log_id, project, area_id, department, etapa_id, hours, description, created_by, updated_by, created_at, updated_at)`.

- [ ] **Step 1: Escribir la migración**

```sql
-- 0007_horas_time_logs.sql
create table public.time_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete restrict,
  entry_date  date not null,
  total_hours numeric(6,2) not null default 0,
  status      text not null default 'guardado' check (status in ('guardado','editado','anulado')),
  created_by  uuid references public.profiles(id),
  updated_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index time_logs_user_date_idx on public.time_logs(user_id, entry_date);

create table public.time_log_lines (
  id          uuid primary key default gen_random_uuid(),
  log_id      uuid not null references public.time_logs(id) on delete cascade,
  project     text not null,
  area_id     uuid not null references public.areas(id) on delete restrict,
  department  text not null check (department in ('Clientes','Ventas','Marketing','Todos')),
  etapa_id    uuid not null references public.etapas(id) on delete restrict,
  hours       numeric(5,2) not null check (hours > 0),
  description text not null check (length(btrim(description)) > 0),
  created_by  uuid references public.profiles(id),
  updated_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index time_log_lines_log_idx on public.time_log_lines(log_id);

alter table public.time_logs      enable row level security;
alter table public.time_log_lines enable row level security;

-- Lectura: propios (operativo) o todos (manager/admin). Escritura directa: ninguna (solo vía RPC).
create policy time_logs_select on public.time_logs for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager','admin'))
);
create policy time_log_lines_select on public.time_log_lines for select to authenticated using (
  exists (
    select 1 from public.time_logs tl
    where tl.id = log_id and (
      tl.user_id = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager','admin'))
    )
  )
);
-- (Sin políticas de insert/update/delete: las escrituras pasan por RPC security definer.)
```

- [ ] **Step 2: Aplicar la migración** (MCP `apply_migration` name `0007_horas_time_logs`; guardar copia).

- [ ] **Step 3: Escribir el test SQL** (`supabase/tests/horas_time_logs.sql`)

```sql
-- Valida constraints: horas>0, department válido, status válido, cascade
do $$
declare v_user uuid; v_area uuid; v_etapa uuid; v_log uuid; ok bool;
begin
  select id into v_user from public.profiles where role='admin' limit 1;
  select id into v_area from public.areas where name='CRM';
  select id into v_etapa from public.etapas where name='Setup';

  insert into public.time_logs(user_id, entry_date, total_hours, created_by)
    values (v_user, current_date, 2, v_user) returning id into v_log;
  insert into public.time_log_lines(log_id, project, area_id, department, etapa_id, hours, description, created_by)
    values (v_log, 'Cliente Test', v_area, 'Clientes', v_etapa, 2, 'desc', v_user);

  -- horas<=0 debe fallar
  ok := true;
  begin
    insert into public.time_log_lines(log_id, project, area_id, department, etapa_id, hours, description)
      values (v_log, 'X', v_area, 'Clientes', v_etapa, 0, 'd');
    ok := false;
  exception when check_violation then null; end;
  if not ok then raise exception 'horas<=0 no fue rechazado'; end if;

  -- cascade: borrar el log borra las líneas
  delete from public.time_logs where id = v_log;
  if exists (select 1 from public.time_log_lines where log_id = v_log) then
    raise exception 'cascade no borró líneas';
  end if;
  raise notice 'OK time_logs';
end $$;
```

- [ ] **Step 4: Correr el test** (MCP `execute_sql`). Esperado: `NOTICE: OK time_logs`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0007_horas_time_logs.sql supabase/tests/horas_time_logs.sql
git commit -m "feat(horas): time_logs + time_log_lines con constraints y RLS"
```

---

## Task 4: RPC `guardar_registro_diario` (crear/editar transaccional)

**Files:**
- Create: `supabase/migrations/0008_horas_rpc_guardar.sql`
- Test: `supabase/tests/horas_rpc_guardar.sql`

**Interfaces:**
- Consumes: `time_logs`, `time_log_lines`, `profiles`.
- Produces: función `public.guardar_registro_diario(p_log_id uuid, p_entry_date date, p_lines jsonb) returns uuid`. `p_lines` es un array JSON de objetos `{project, area_id, department, etapa_id, hours, description}`. Devuelve el `id` del `time_logs`. Si `p_log_id` es null, crea; si no, reemplaza las líneas del log existente (edición). Valida permisos, rango de fecha por rol y reglas de líneas.

- [ ] **Step 1: Escribir la migración**

```sql
-- 0008_horas_rpc_guardar.sql
create or replace function public.guardar_registro_diario(
  p_log_id     uuid,
  p_entry_date date,
  p_lines      jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_status text;
  v_log    public.time_logs;
  v_total  numeric(6,2) := 0;
  v_line   jsonb;
  v_count  int := 0;
begin
  select role, status into v_role, v_status from public.profiles where id = v_uid;
  if v_role is null then raise exception 'no autorizado: usuario sin perfil'; end if;
  if v_status <> 'activo' then raise exception 'no autorizado: usuario inactivo'; end if;

  -- Fecha: nunca futura; no-admin limitado a 7 días atrás.
  if p_entry_date > current_date then raise exception 'fecha inválida: no puede ser futura'; end if;
  if v_role <> 'admin' and p_entry_date < current_date - 7 then
    raise exception 'fecha fuera de rango: máximo 7 días atrás';
  end if;

  -- Debe haber al menos una línea.
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'el registro necesita al menos una línea';
  end if;

  -- Sin líneas duplicadas (misma combinación proyecto+área+departamento+etapa).
  if exists (
    select 1 from (
      select e->>'project' p, e->>'area_id' a, e->>'department' d, e->>'etapa_id' et
      from jsonb_array_elements(p_lines) e
      group by 1,2,3,4 having count(*) > 1
    ) dup
  ) then raise exception 'hay líneas duplicadas'; end if;

  -- Crear o localizar el registro padre (solo propio salvo admin).
  if p_log_id is null then
    insert into public.time_logs(user_id, entry_date, status, created_by, updated_by)
      values (v_uid, p_entry_date, 'guardado', v_uid, v_uid) returning * into v_log;
  else
    select * into v_log from public.time_logs where id = p_log_id for update;
    if v_log.id is null then raise exception 'registro no encontrado'; end if;
    if v_log.user_id <> v_uid and v_role <> 'admin' then
      raise exception 'no autorizado: registro de otro usuario';
    end if;
    if v_log.status = 'anulado' then raise exception 'el registro está anulado'; end if;
    update public.time_logs set entry_date = p_entry_date, status = 'editado', updated_by = v_uid, updated_at = now()
      where id = v_log.id;
    delete from public.time_log_lines where log_id = v_log.id;
  end if;

  -- Insertar líneas validando cada una.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce(btrim(v_line->>'project'),'') = '' then raise exception 'línea sin proyecto'; end if;
    if coalesce(btrim(v_line->>'description'),'') = '' then raise exception 'línea sin descripción'; end if;
    if (v_line->>'hours')::numeric <= 0 then raise exception 'horas deben ser > 0'; end if;
    insert into public.time_log_lines(log_id, project, area_id, department, etapa_id, hours, description, created_by, updated_by)
      values (
        v_log.id,
        btrim(v_line->>'project'),
        (v_line->>'area_id')::uuid,
        v_line->>'department',
        (v_line->>'etapa_id')::uuid,
        (v_line->>'hours')::numeric,
        btrim(v_line->>'description'),
        v_uid, v_uid
      );
    v_total := v_total + (v_line->>'hours')::numeric;
    v_count := v_count + 1;
  end loop;

  update public.time_logs set total_hours = v_total where id = v_log.id;
  return v_log.id;
end $$;

grant execute on function public.guardar_registro_diario(uuid, date, jsonb) to authenticated;
```

- [ ] **Step 2: Aplicar la migración** (MCP `apply_migration` name `0008_horas_rpc_guardar`; guardar copia).

- [ ] **Step 3: Escribir el test SQL** (`supabase/tests/horas_rpc_guardar.sql`)

```sql
-- Impersona a un operativo y prueba guardar + validaciones de fecha
do $$
declare v_op uuid; v_area uuid; v_etapa uuid; v_log uuid; v_lines jsonb; ok bool;
begin
  select id into v_op from public.profiles where role='operativo' and status='activo' limit 1;
  if v_op is null then raise notice 'SKIP: no hay operativo activo'; return; end if;
  select id into v_area from public.areas where name='CRM';
  select id into v_etapa from public.etapas where name='Setup';

  perform set_config('request.jwt.claims', json_build_object('sub', v_op::text, 'role','authenticated')::text, true);

  v_lines := jsonb_build_array(
    jsonb_build_object('project','Cliente A','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',2,'description','flujo CRM'),
    jsonb_build_object('project','Cliente B','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1.5,'description','reunión')
  );
  v_log := public.guardar_registro_diario(null, current_date, v_lines);

  if (select total_hours from public.time_logs where id=v_log) <> 3.5 then
    raise exception 'total esperado 3.5';
  end if;
  if (select count(*) from public.time_log_lines where log_id=v_log) <> 2 then
    raise exception 'esperaba 2 líneas';
  end if;

  -- fecha futura rechazada
  ok := true;
  begin perform public.guardar_registro_diario(null, current_date + 1, v_lines); ok := false;
  exception when others then null; end;
  if not ok then raise exception 'fecha futura no fue rechazada'; end if;

  -- fecha > 7 días atrás rechazada para operativo
  ok := true;
  begin perform public.guardar_registro_diario(null, current_date - 10, v_lines); ok := false;
  exception when others then null; end;
  if not ok then raise exception 'fecha vieja no fue rechazada para operativo'; end if;

  -- edición: reemplaza líneas y recalcula total
  perform public.guardar_registro_diario(v_log, current_date,
    jsonb_build_array(jsonb_build_object('project','Cliente A','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',4,'description','corregido')));
  if (select total_hours from public.time_logs where id=v_log) <> 4 then raise exception 'edición no recalculó total'; end if;
  if (select status from public.time_logs where id=v_log) <> 'editado' then raise exception 'edición no marcó estado'; end if;

  -- líneas duplicadas rechazadas
  ok := true;
  begin perform public.guardar_registro_diario(null, current_date,
    jsonb_build_array(
      jsonb_build_object('project','D','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description','x'),
      jsonb_build_object('project','D','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description','y')
    )); ok := false;
  exception when others then null; end;
  if not ok then raise exception 'duplicados no rechazados'; end if;

  delete from public.time_logs where id = v_log;
  raise notice 'OK rpc guardar';
end $$;
```

- [ ] **Step 4: Correr el test** (MCP `execute_sql`). Esperado: `NOTICE: OK rpc guardar` (o `SKIP` si no hay operativo; en ese caso crear uno temporal vía Task 9 luego, pero para este test sembrar un operativo si falta).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0008_horas_rpc_guardar.sql supabase/tests/horas_rpc_guardar.sql
git commit -m "feat(horas): RPC guardar_registro_diario transaccional con validaciones"
```

---

## Task 5: RPC `anular_registro_diario`

**Files:**
- Create: `supabase/migrations/0009_horas_rpc_anular.sql`
- Test: `supabase/tests/horas_rpc_anular.sql`

**Interfaces:**
- Consumes: `time_logs`, `profiles`.
- Produces: función `public.anular_registro_diario(p_log_id uuid) returns void`. Marca el registro como `anulado`. Solo el dueño dentro de la ventana de 7 días o un admin (sin límite).

- [ ] **Step 1: Escribir la migración**

```sql
-- 0009_horas_rpc_anular.sql
create or replace function public.anular_registro_diario(p_log_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
  v_log  public.time_logs;
begin
  select role into v_role from public.profiles where id = v_uid;
  if v_role is null then raise exception 'no autorizado'; end if;

  select * into v_log from public.time_logs where id = p_log_id for update;
  if v_log.id is null then raise exception 'registro no encontrado'; end if;
  if v_log.user_id <> v_uid and v_role <> 'admin' then raise exception 'no autorizado: registro de otro usuario'; end if;
  if v_role <> 'admin' and v_log.entry_date < current_date - 7 then
    raise exception 'fuera de rango: solo admin puede anular registros de más de 7 días';
  end if;

  update public.time_logs set status = 'anulado', updated_by = v_uid, updated_at = now() where id = p_log_id;
end $$;

grant execute on function public.anular_registro_diario(uuid) to authenticated;
```

- [ ] **Step 2: Aplicar la migración** (MCP `apply_migration` name `0009_horas_rpc_anular`; guardar copia).

- [ ] **Step 3: Escribir el test SQL** (`supabase/tests/horas_rpc_anular.sql`)

```sql
do $$
declare v_op uuid; v_area uuid; v_etapa uuid; v_log uuid;
begin
  select id into v_op from public.profiles where role='operativo' and status='activo' limit 1;
  if v_op is null then raise notice 'SKIP: no hay operativo'; return; end if;
  select id into v_area from public.areas where name='CRM';
  select id into v_etapa from public.etapas where name='Setup';
  perform set_config('request.jwt.claims', json_build_object('sub', v_op::text,'role','authenticated')::text, true);
  v_log := public.guardar_registro_diario(null, current_date,
    jsonb_build_array(jsonb_build_object('project','C','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description','d')));
  perform public.anular_registro_diario(v_log);
  if (select status from public.time_logs where id=v_log) <> 'anulado' then raise exception 'no anuló'; end if;
  delete from public.time_logs where id = v_log;
  raise notice 'OK rpc anular';
end $$;
```

- [ ] **Step 4: Correr el test** (MCP `execute_sql`). Esperado: `NOTICE: OK rpc anular`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0009_horas_rpc_anular.sql supabase/tests/horas_rpc_anular.sql
git commit -m "feat(horas): RPC anular_registro_diario con reglas por rol"
```

---

## Task 6: Scaffold del grupo de rutas `(horas)` + librería

**Files:**
- Create: `lib/horas/types.ts`, `lib/horas/format.ts`, `lib/horas/queries.ts`
- Create: `app/(horas)/layout.tsx`, `components/horas/HorasNav.tsx`
- Create: `app/(horas)/registrar/page.tsx` (placeholder mínimo, se completa en Task 7)
- Create: `e2e/helpers/seed-horas.ts`, `e2e/horas-smoke.spec.ts`

**Interfaces:**
- Produces: `formatHoras(n:number):string`; tipos `AreaRow`, `EtapaRow`, `TimeLogWithLines`; queries `getCatalogos()`, `getMyAreas()`, `getMyLogs()`. Layout que exige sesión + perfil activo y muestra `HorasNav`.

- [ ] **Step 1: `lib/horas/format.ts`**

```ts
export function formatHoras(n: number): string {
  const v = Number(n)
  return (v % 1 === 0 ? String(v) : v.toFixed(1)) + 'h'
}
```

- [ ] **Step 2: `lib/horas/types.ts`**

```ts
export type Department = 'Clientes' | 'Ventas' | 'Marketing' | 'Todos'
export type LogStatus = 'guardado' | 'editado' | 'anulado'

export interface AreaRow { id: string; name: string; is_internal: boolean }
export interface EtapaRow { id: string; name: string }

export interface TimeLogLine {
  id: string; project: string; area_id: string; department: Department
  etapa_id: string; hours: number; description: string
}
export interface TimeLogWithLines {
  id: string; user_id: string; entry_date: string; total_hours: number
  status: LogStatus; lines: TimeLogLine[]
}
```

- [ ] **Step 3: `lib/horas/queries.ts`**

```ts
import { createClient } from '@/lib/supabase/server'
import type { AreaRow, EtapaRow } from '@/lib/horas/types'

export async function getCatalogos(): Promise<{ areas: AreaRow[]; etapas: EtapaRow[] }> {
  const supabase = await createClient()
  const [{ data: areas }, { data: etapas }] = await Promise.all([
    supabase.from('areas').select('id,name,is_internal').eq('active', true).order('name'),
    supabase.from('etapas').select('id,name').eq('active', true).order('name'),
  ])
  return { areas: areas ?? [], etapas: etapas ?? [] }
}

export async function getMyAreas(userId: string): Promise<AreaRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('user_areas')
    .select('areas(id,name,is_internal)')
    .eq('user_id', userId)
  return (data ?? []).map((r: { areas: AreaRow }) => r.areas)
}
```

- [ ] **Step 4: `components/horas/HorasNav.tsx`**

```tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function HorasNav({ displayName, role }: { displayName: string; role: string }) {
  const path = usePathname()
  const link = (href: string, label: string) => (
    <Link href={href} className={`text-sm ${path === href ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{label}</Link>
  )
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-6">
          <span className="font-display text-base">Control de Horas</span>
          {link('/registrar', 'Registrar')}
          {link('/mis-registros', 'Mis registros')}
          {(role === 'manager' || role === 'admin') && link('/equipo', 'Equipo')}
          {role === 'admin' && link('/admin/usuarios', 'Usuarios')}
        </div>
        <span className="text-sm text-muted-foreground">{displayName}</span>
      </div>
    </header>
  )
}
```

- [ ] **Step 5: `app/(horas)/layout.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import HorasNav from '@/components/horas/HorasNav'

export default async function HorasLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role, full_name, status').eq('id', user.id).single()
  if (!profile || profile.status !== 'activo') redirect('/login')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <HorasNav displayName={profile.full_name || user.email!} role={profile.role} />
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  )
}
```

- [ ] **Step 6: placeholder `app/(horas)/registrar/page.tsx`**

```tsx
export default function RegistrarPage() {
  return <h1 className="font-display text-2xl">Registrar horas</h1>
}
```

- [ ] **Step 7: `e2e/helpers/seed-horas.ts`** (crea operativo, manager y admin con áreas)

```ts
import { createClient } from '@supabase/supabase-js'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const OPERATIVO = { email: 'e2e-operativo@horas.test', password: 'E2e-Op-Pass-123', full_name: 'Operativo E2E' }

export async function seedHorasFixture() {
  await cleanupHorasFixture()
  const { data: created, error } = await admin.auth.admin.createUser({
    email: OPERATIVO.email, password: OPERATIVO.password, email_confirm: true,
    user_metadata: { full_name: OPERATIVO.full_name },
  })
  if (error) throw error
  const userId = created.user!.id
  await admin.from('profiles').update({ role: 'operativo', status: 'activo' }).eq('id', userId)
  const { data: area } = await admin.from('areas').select('id').eq('name', 'CRM').single()
  await admin.from('user_areas').insert({ user_id: userId, area_id: area!.id })
  return { operativoEmail: OPERATIVO.email, operativoPassword: OPERATIVO.password, userId }
}

export async function cleanupHorasFixture() {
  const { data: list } = await admin.auth.admin.listUsers()
  const u = list?.users.find((x) => x.email === OPERATIVO.email)
  if (u) {
    await admin.from('time_logs').delete().eq('user_id', u.id)
    await admin.from('user_areas').delete().eq('user_id', u.id)
    await admin.auth.admin.deleteUser(u.id)
  }
}
```

- [ ] **Step 8: `e2e/horas-smoke.spec.ts`**

```ts
import { test, expect } from '@playwright/test'

test('un usuario activo accede a /registrar', async ({ page }) => {
  await page.goto('/registrar')
  await expect(page.getByRole('heading', { name: /registrar horas/i })).toBeVisible()
})
```

> El `storageState` de operativo se genera en el `global-setup` (Step 9).

- [ ] **Step 9: Extender `e2e/global-setup.ts`** para sembrar el fixture de Horas y loguear al operativo, guardando `e2e/.auth/operativo.json`. Añadir al `playwright.config.ts` un project `chromium-horas` con `storageState: 'e2e/.auth/operativo.json'` que corra los specs `horas-*.spec.ts`. (Reutiliza el patrón del project HUCHA existente; **no** añadir bloque `webServer`.)

- [ ] **Step 10: Verificar** (con el dev server del usuario corriendo): `npx playwright test horas-smoke --project=chromium-horas`. Esperado: PASS.

- [ ] **Step 11: Commit**

```bash
git add lib/horas app/\(horas\)/layout.tsx app/\(horas\)/registrar/page.tsx components/horas e2e/helpers/seed-horas.ts e2e/horas-smoke.spec.ts e2e/global-setup.ts playwright.config.ts
git commit -m "feat(horas): scaffold grupo (horas), librería, nav y smoke E2E"
```

---

## Task 7: Registro diario multilínea (pantalla + Server Action)

**Files:**
- Create: `app/(horas)/registrar/actions.ts`, `components/horas/RegistroForm.tsx`
- Modify: `app/(horas)/registrar/page.tsx`
- Test: `e2e/horas-registrar.spec.ts`

**Interfaces:**
- Consumes: `guardar_registro_diario` (RPC), `getCatalogos`, `getMyAreas`, proyectos del Excel (`getCachedBancoHoras`).
- Produces: Server Action `guardarRegistro(formState)` que llama a la RPC; componente `RegistroForm` (tabla editable con add/remove líneas, total visible, Departamento condicional).

- [ ] **Step 1: `app/(horas)/registrar/actions.ts`**

```ts
'use server'
import { createClient } from '@/lib/supabase/server'

export interface LineInput {
  project: string; area_id: string; department: string; etapa_id: string; hours: number; description: string
}

export async function guardarRegistro(
  entryDate: string, lines: LineInput[], logId: string | null = null
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!lines.length) return { ok: false, error: 'Agregá al menos una línea.' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('guardar_registro_diario', {
    p_log_id: logId, p_entry_date: entryDate, p_lines: lines,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, id: data as string }
}
```

- [ ] **Step 2: `components/horas/RegistroForm.tsx`** (tabla editable; Departamento auto=Clientes para proyecto de cliente, editable para "Departamento")

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { guardarRegistro, type LineInput } from '@/app/(horas)/registrar/actions'
import { formatHoras } from '@/lib/horas/format'
import type { AreaRow, EtapaRow } from '@/lib/horas/types'

const DEPARTAMENTOS = ['Clientes', 'Ventas', 'Marketing', 'Todos'] as const
const today = () => new Date().toISOString().slice(0, 10)
const emptyLine = (areaId: string): LineInput => ({ project: '', area_id: areaId, department: 'Clientes', etapa_id: '', hours: 0, description: '' })

export default function RegistroForm({ projects, areas, etapas, internalAreaId, initial }: {
  projects: string[]; areas: AreaRow[]; etapas: EtapaRow[]; internalAreaId: string
  initial?: { id: string; entryDate: string; lines: LineInput[] }
}) {
  const router = useRouter()
  const [entryDate, setEntryDate] = useState(initial?.entryDate ?? today())
  const [lines, setLines] = useState<LineInput[]>(initial?.lines ?? [emptyLine(areas[0]?.id ?? '')])
  const [saving, setSaving] = useState(false)

  const total = lines.reduce((s, l) => s + (Number(l.hours) || 0), 0)
  const isDepartamento = (p: string) => p === 'Departamento'

  function update(i: number, patch: Partial<LineInput>) {
    setLines((prev) => prev.map((l, idx) => {
      if (idx !== i) return l
      const next = { ...l, ...patch }
      if (patch.project !== undefined) {
        if (isDepartamento(patch.project)) { next.area_id = internalAreaId }
        else { next.department = 'Clientes'; if (next.area_id === internalAreaId) next.area_id = areas[0]?.id ?? '' }
      }
      return next
    }))
  }

  async function onSave() {
    setSaving(true)
    const res = await guardarRegistro(entryDate, lines, initial?.id ?? null)
    setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success(initial ? 'Registro actualizado' : 'Registro guardado')
    router.push('/mis-registros')
  }

  return (
    <div className="space-y-4">
      <label className="block text-sm">Fecha
        <input type="date" value={entryDate} max={today()} onChange={(e) => setEntryDate(e.target.value)}
          className="ml-2 rounded border border-border px-2 py-1" />
      </label>

      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted-foreground">
          <th>Proyecto</th><th>Área</th><th>Departamento</th><th>Etapa</th><th>Horas</th><th>Descripción</th><th></th>
        </tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                <select aria-label="Proyecto" value={l.project} onChange={(e) => update(i, { project: e.target.value })}>
                  <option value="">— Proyecto —</option>
                  {projects.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </td>
              <td>
                <select aria-label="Área" value={l.area_id} disabled={isDepartamento(l.project)}
                  onChange={(e) => update(i, { area_id: e.target.value })}>
                  {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </td>
              <td>
                <select aria-label="Departamento" value={l.department} disabled={!isDepartamento(l.project)}
                  onChange={(e) => update(i, { department: e.target.value })}>
                  {DEPARTAMENTOS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </td>
              <td>
                <select aria-label="Etapa" value={l.etapa_id} onChange={(e) => update(i, { etapa_id: e.target.value })}>
                  <option value="">— Etapa —</option>
                  {etapas.map((et) => <option key={et.id} value={et.id}>{et.name}</option>)}
                </select>
              </td>
              <td><input aria-label="Horas" type="number" step="0.5" min="0" value={l.hours || ''}
                onChange={(e) => update(i, { hours: Number(e.target.value) })} className="w-16" /></td>
              <td><input aria-label="Descripción" value={l.description}
                onChange={(e) => update(i, { description: e.target.value })} className="w-full" /></td>
              <td><button type="button" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
                disabled={lines.length === 1} aria-label="Eliminar línea">✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setLines((p) => [...p, emptyLine(areas[0]?.id ?? '')])}
          className="text-sm text-brand">+ Añadir línea</button>
        <span className="tabular-money text-sm">Total del día: <strong>{formatHoras(total)}</strong></span>
      </div>

      <button type="button" onClick={onSave} disabled={saving}
        className="rounded bg-brand px-4 py-2 text-white">{saving ? 'Guardando…' : 'Guardar registro'}</button>
    </div>
  )
}
```

- [ ] **Step 3: `app/(horas)/registrar/page.tsx`** (carga catálogos, áreas del usuario, proyectos del Excel)

```tsx
import { createClient } from '@/lib/supabase/server'
import { getCatalogos, getMyAreas } from '@/lib/horas/queries'
import { getCachedBancoHoras } from '@/lib/graph/client'
import RegistroForm from '@/components/horas/RegistroForm'
import type { LineInput } from '@/app/(horas)/registrar/actions'

export default async function RegistrarPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { areas, etapas } = await getCatalogos()
  const myAreas = await getMyAreas(user!.id)
  const internal = areas.find((a) => a.is_internal)!
  // Para el selector: las áreas del usuario + la interna (para proyecto "Departamento")
  const selectableAreas = [...myAreas, internal]

  let projects: string[] = []
  try { projects = (await getCachedBancoHoras()).map((b) => b.project) } catch { /* Excel caído: solo Departamento */ }
  projects = [...projects, 'Departamento']

  // Modo edición: precargar el registro propio (RLS limita el acceso) si no está anulado.
  let initial: { id: string; entryDate: string; lines: LineInput[] } | undefined
  if (edit) {
    const { data: log } = await supabase
      .from('time_logs')
      .select('id, entry_date, status, time_log_lines(project, area_id, department, etapa_id, hours, description)')
      .eq('id', edit).single()
    if (log && log.status !== 'anulado') {
      initial = {
        id: log.id, entryDate: log.entry_date,
        lines: (log.time_log_lines as LineInput[]).map((l) => ({
          project: l.project, area_id: l.area_id, department: l.department,
          etapa_id: l.etapa_id, hours: Number(l.hours), description: l.description,
        })),
      }
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl">{initial ? 'Editar registro' : 'Registrar horas'}</h1>
      <RegistroForm projects={projects} areas={selectableAreas} etapas={etapas} internalAreaId={internal.id} initial={initial} />
    </div>
  )
}
```

- [ ] **Step 4: `e2e/horas-registrar.spec.ts`**

```ts
import { test, expect } from '@playwright/test'

test('registrar dos líneas guarda el día con su total', async ({ page }) => {
  await page.goto('/registrar')
  // línea 1
  await page.getByLabel('Proyecto').first().selectOption({ index: 1 })
  await page.getByLabel('Etapa').first().selectOption({ index: 1 })
  await page.getByLabel('Horas').first().fill('2')
  await page.getByLabel('Descripción').first().fill('Trabajo E2E 1')
  // añadir línea 2
  await page.getByRole('button', { name: /añadir línea/i }).click()
  await page.getByLabel('Proyecto').nth(1).selectOption({ index: 1 })
  await page.getByLabel('Etapa').nth(1).selectOption({ index: 1 })
  await page.getByLabel('Horas').nth(1).fill('1.5')
  await page.getByLabel('Descripción').nth(1).fill('Trabajo E2E 2')

  await expect(page.getByText(/total del día/i)).toContainText('3.5h')
  await page.getByRole('button', { name: /guardar registro/i }).click()
  await expect(page).toHaveURL(/\/mis-registros/)
})

test('proyecto Departamento habilita Departamento y fija Área Interno', async ({ page }) => {
  await page.goto('/registrar')
  await page.getByLabel('Proyecto').first().selectOption('Departamento')
  await expect(page.getByLabel('Departamento').first()).toBeEnabled()
})
```

- [ ] **Step 5: Correr E2E** (dev server del usuario): `npx playwright test horas-registrar --project=chromium-horas`. Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/\(horas\)/registrar components/horas/RegistroForm.tsx e2e/horas-registrar.spec.ts
git commit -m "feat(horas): registro diario multilínea con guardado transaccional"
```

---

## Task 8: Mis registros (listado + edición/anulación propia)

**Files:**
- Create: `app/(horas)/mis-registros/page.tsx`, `app/(horas)/mis-registros/actions.ts`, `components/horas/MisRegistros.tsx`
- Test: `e2e/horas-mis-registros.spec.ts`

**Interfaces:**
- Consumes: lectura RLS de `time_logs`+`time_log_lines`, RPC `anular_registro_diario`.
- Produces: listado de registros propios (fecha, total, estado, líneas) con acción de anular dentro de ventana; Server Action `anularRegistro(id)`.

- [ ] **Step 1: `app/(horas)/mis-registros/actions.ts`**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function anularRegistro(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('anular_registro_diario', { p_log_id: id })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/mis-registros')
  return { ok: true }
}
```

- [ ] **Step 2: `app/(horas)/mis-registros/page.tsx`** (lista los propios; RLS ya limita a `user_id = auth.uid()` para operativo)

```tsx
import { createClient } from '@/lib/supabase/server'
import { formatHoras } from '@/lib/horas/format'
import MisRegistros from '@/components/horas/MisRegistros'

export default async function MisRegistrosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: logs } = await supabase
    .from('time_logs')
    .select('id, entry_date, total_hours, status, time_log_lines(project, hours, description)')
    .eq('user_id', user!.id)
    .order('entry_date', { ascending: false })

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl">Mis registros</h1>
      <MisRegistros logs={(logs ?? []).map((l) => ({ ...l, totalLabel: formatHoras(Number(l.total_hours)) }))} />
    </div>
  )
}
```

- [ ] **Step 3: `components/horas/MisRegistros.tsx`** (muestra cada registro con sus líneas y botón anular)

```tsx
'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { anularRegistro } from '@/app/(horas)/mis-registros/actions'

interface Log {
  id: string; entry_date: string; totalLabel: string; status: string
  time_log_lines: { project: string; hours: number; description: string }[]
}

export default function MisRegistros({ logs }: { logs: Log[] }) {
  const router = useRouter()
  async function onAnular(id: string) {
    const res = await anularRegistro(id)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Registro anulado'); router.refresh()
  }
  if (!logs.length) return <p className="text-muted-foreground">Todavía no registraste horas.</p>
  return (
    <ul className="space-y-3">
      {logs.map((l) => (
        <li key={l.id} className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <span className="font-medium">{l.entry_date} · {l.totalLabel}</span>
            <span className="text-xs text-muted-foreground">{l.status}</span>
          </div>
          <ul className="mt-2 text-sm text-muted-foreground">
            {l.time_log_lines.map((line, i) => <li key={i}>{line.project} — {line.hours}h — {line.description}</li>)}
          </ul>
          {l.status !== 'anulado' && (
            <div className="mt-2 flex gap-3">
              <Link href={`/registrar?edit=${l.id}`} className="text-xs text-brand">Editar</Link>
              <button onClick={() => onAnular(l.id)} className="text-xs text-(--excedido)">Anular</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: `e2e/horas-mis-registros.spec.ts`**

```ts
import { test, expect } from '@playwright/test'

test('un registro guardado aparece en Mis registros y se puede anular', async ({ page }) => {
  // crear uno
  await page.goto('/registrar')
  await page.getByLabel('Proyecto').first().selectOption({ index: 1 })
  await page.getByLabel('Etapa').first().selectOption({ index: 1 })
  await page.getByLabel('Horas').first().fill('3')
  await page.getByLabel('Descripción').first().fill('Para anular')
  await page.getByRole('button', { name: /guardar registro/i }).click()
  await expect(page).toHaveURL(/\/mis-registros/)

  await expect(page.getByText('Para anular').first()).toBeVisible()
  await page.getByRole('button', { name: /anular/i }).first().click()
  await expect(page.getByText('anulado').first()).toBeVisible()
})

test('editar un registro propio actualiza sus horas', async ({ page }) => {
  await page.goto('/registrar')
  await page.getByLabel('Proyecto').first().selectOption({ index: 1 })
  await page.getByLabel('Etapa').first().selectOption({ index: 1 })
  await page.getByLabel('Horas').first().fill('2')
  await page.getByLabel('Descripción').first().fill('Antes de editar')
  await page.getByRole('button', { name: /guardar registro/i }).click()
  await expect(page).toHaveURL(/\/mis-registros/)

  await page.getByRole('link', { name: /editar/i }).first().click()
  await expect(page.getByRole('heading', { name: /editar registro/i })).toBeVisible()
  await page.getByLabel('Horas').first().fill('5')
  await page.getByRole('button', { name: /guardar registro/i }).click()
  await expect(page).toHaveURL(/\/mis-registros/)
  await expect(page.getByText('5h').first()).toBeVisible()
})
```

- [ ] **Step 5: Correr E2E**: `npx playwright test horas-mis-registros --project=chromium-horas`. Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/\(horas\)/mis-registros components/horas/MisRegistros.tsx e2e/horas-mis-registros.spec.ts
git commit -m "feat(horas): mis registros con anulación dentro de la ventana"
```

---

## Task 9: Alta de usuarios (admin)

**Files:**
- Create: `app/(horas)/admin/usuarios/page.tsx`, `app/(horas)/admin/usuarios/actions.ts`, `components/horas/UsuarioForm.tsx`
- Test: `e2e/horas-alta-usuario.spec.ts`

**Interfaces:**
- Consumes: `createAdminClient` (service_role) para crear auth user + profile + user_areas; `getCatalogos` para áreas.
- Produces: Server Action `crearUsuario(input)`; pantalla solo-admin con formulario.

- [ ] **Step 1: `app/(horas)/admin/usuarios/actions.ts`**

```ts
'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export interface NuevoUsuario {
  full_name: string; email: string; password: string; position: string
  role: 'operativo' | 'manager' | 'admin'; areaIds: string[]
}

export async function crearUsuario(input: NuevoUsuario): Promise<{ ok: true } | { ok: false; error: string }> {
  // Verificar que el actor es admin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user!.id).single()
  if (me?.role !== 'admin') return { ok: false, error: 'Solo un administrador puede crear usuarios.' }

  if (!input.full_name.trim() || !input.email.trim() || input.password.length < 8) {
    return { ok: false, error: 'Nombre, correo y contraseña (mín. 8) son obligatorios.' }
  }

  const admin = createAdminClient()
  const { data: created, error } = await admin.auth.admin.createUser({
    email: input.email.trim(), password: input.password, email_confirm: true,
    user_metadata: { full_name: input.full_name.trim() },
  })
  if (error) return { ok: false, error: error.message }
  const id = created.user!.id

  await admin.from('profiles').update({
    full_name: input.full_name.trim(), email: input.email.trim(), position: input.position.trim(),
    role: input.role, status: 'activo', created_by: user!.id,
  }).eq('id', id)

  if (input.areaIds.length) {
    await admin.from('user_areas').insert(input.areaIds.map((area_id) => ({ user_id: id, area_id })))
  }
  return { ok: true }
}
```

- [ ] **Step 2: `components/horas/UsuarioForm.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { crearUsuario, type NuevoUsuario } from '@/app/(horas)/admin/usuarios/actions'
import type { AreaRow } from '@/lib/horas/types'

export default function UsuarioForm({ areas }: { areas: AreaRow[] }) {
  const [f, setF] = useState<NuevoUsuario>({ full_name: '', email: '', password: '', position: '', role: 'operativo', areaIds: [] })
  const [saving, setSaving] = useState(false)
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const res = await crearUsuario(f); setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Usuario creado')
    setF({ full_name: '', email: '', password: '', position: '', role: 'operativo', areaIds: [] })
  }
  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-3">
      <input aria-label="Nombre" placeholder="Nombre" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} className="w-full rounded border border-border px-3 py-2" />
      <input aria-label="Correo" type="email" placeholder="Correo" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="w-full rounded border border-border px-3 py-2" />
      <input aria-label="Contraseña" type="text" placeholder="Contraseña inicial" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="w-full rounded border border-border px-3 py-2" />
      <input aria-label="Posición" placeholder="Posición" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} className="w-full rounded border border-border px-3 py-2" />
      <select aria-label="Rol" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as NuevoUsuario['role'] })} className="w-full rounded border border-border px-3 py-2">
        <option value="operativo">operativo</option><option value="manager">manager</option><option value="admin">admin</option>
      </select>
      <fieldset className="space-y-1"><legend className="text-sm text-muted-foreground">Áreas</legend>
        {areas.filter((a) => !a.is_internal).map((a) => (
          <label key={a.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.areaIds.includes(a.id)}
              onChange={(e) => setF({ ...f, areaIds: e.target.checked ? [...f.areaIds, a.id] : f.areaIds.filter((x) => x !== a.id) })} />
            {a.name}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={saving} className="rounded bg-brand px-4 py-2 text-white">{saving ? 'Creando…' : 'Crear usuario'}</button>
    </form>
  )
}
```

- [ ] **Step 3: `app/(horas)/admin/usuarios/page.tsx`** (gate admin + carga áreas)

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCatalogos } from '@/lib/horas/queries'
import UsuarioForm from '@/components/horas/UsuarioForm'

export default async function UsuariosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user!.id).single()
  if (me?.role !== 'admin') redirect('/registrar')
  const { areas } = await getCatalogos()
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl">Alta de usuarios</h1>
      <UsuarioForm areas={areas} />
    </div>
  )
}
```

- [ ] **Step 4: `e2e/horas-alta-usuario.spec.ts`** (corre con storageState de admin — añadir `e2e/.auth/admin-horas.json` en el global-setup, usando el admin existente `dpo@bastidafarina.com` o uno sembrado)

```ts
import { test, expect } from '@playwright/test'

test('un admin crea un usuario operativo', async ({ page }) => {
  await page.goto('/admin/usuarios')
  const email = `e2e-nuevo-${Date.now()}@horas.test`
  await page.getByLabel('Nombre').fill('Nuevo E2E')
  await page.getByLabel('Correo').fill(email)
  await page.getByLabel('Contraseña').fill('Passw0rd-E2E')
  await page.getByLabel('Posición').fill('Especialista')
  await page.getByRole('button', { name: /crear usuario/i }).click()
  await expect(page.getByText(/usuario creado/i)).toBeVisible()
})
```

> Nota de limpieza: el `global-teardown` debe borrar usuarios cuyo email empiece con `e2e-nuevo-` y `e2e-operativo@horas.test` (extender `cleanupHorasFixture`).

- [ ] **Step 5: Correr E2E** con el project admin. Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/\(horas\)/admin e2e/horas-alta-usuario.spec.ts e2e/global-setup.ts e2e/global-teardown.ts playwright.config.ts
git commit -m "feat(horas): alta mínima de usuarios por admin"
```

---

## Task 10: Vista de equipo (manager/admin, solo lectura)

**Files:**
- Create: `app/(horas)/equipo/page.tsx`
- Test: `e2e/horas-equipo.spec.ts`

**Interfaces:**
- Consumes: lectura RLS de `time_logs` (manager/admin ven todos).
- Produces: pantalla read-only con los registros de todos los usuarios (fecha, usuario, total, estado).

- [ ] **Step 1: `app/(horas)/equipo/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatHoras } from '@/lib/horas/format'

export default async function EquipoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user!.id).single()
  if (me?.role !== 'manager' && me?.role !== 'admin') redirect('/registrar')

  const { data: logs } = await supabase
    .from('time_logs')
    .select('id, entry_date, total_hours, status, profiles!time_logs_user_id_fkey(full_name)')
    .order('entry_date', { ascending: false })
    .limit(200)

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl">Registros del equipo</h1>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted-foreground"><th>Fecha</th><th>Usuario</th><th>Total</th><th>Estado</th></tr></thead>
        <tbody>
          {(logs ?? []).map((l: { id: string; entry_date: string; total_hours: number; status: string; profiles: { full_name: string } | null }) => (
            <tr key={l.id} className="border-t border-border">
              <td>{l.entry_date}</td><td>{l.profiles?.full_name ?? '—'}</td>
              <td className="tabular-money">{formatHoras(Number(l.total_hours))}</td><td>{l.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: `e2e/horas-equipo.spec.ts`** (corre con storageState de manager o admin)

```ts
import { test, expect } from '@playwright/test'

test('manager/admin ve la pantalla de equipo', async ({ page }) => {
  await page.goto('/equipo')
  await expect(page.getByRole('heading', { name: /registros del equipo/i })).toBeVisible()
})
```

> El operativo NO debe acceder: si se desea, añadir un test negativo que verifique el redirect a `/registrar` con el storageState de operativo.

- [ ] **Step 3: Correr E2E**: `npx playwright test horas-equipo --project=chromium-horas-admin`. Esperado: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/\(horas\)/equipo e2e/horas-equipo.spec.ts
git commit -m "feat(horas): vista de equipo read-only para manager/admin"
```

---

## Cierre de la Fase 1

- [ ] **Review de rama completa** (whole-branch) verificando trazabilidad con el spec (§9) y el PDF.
- [ ] **Actualizar** `docs/superpowers/REGISTRO-DECISIONES-Y-ESTADO.md` con el estado "Horas v2 · Fase 1 completada".
- [ ] **Decidir el corte (cutover):** actualizar `app/page.tsx` para redirigir `operativo`/`manager` a `/registrar` (v2) en vez de la legacy `/registrar` del grupo `(app)`. *(Cuando el usuario lo apruebe; coordinar porque toca el ruteo por rol.)*

> **No incluido (fases siguientes):** bancos por área + descuento por línea + movimientos + ampliaciones (Fase 2); panel de usuarios completo + auditoría (Fase 3); alertas Slack (Fase 4); dashboard + descargas (Fase 5).
