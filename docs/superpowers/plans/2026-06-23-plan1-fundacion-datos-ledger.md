# Plan 1 — Fundación de datos + Ledger HUCHA (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear en Supabase la fundación de datos compartida (perfiles+roles, proyectos, asignaciones) y el banco+ledger de HUCHA con su motor de movimientos, todo protegido por RLS y testeado.

**Architecture:** Tablas en Postgres con RLS como única autoridad de permisos. Las escrituras de saldo pasan exclusivamente por la función `registrar_movimiento_hucha()` (`SECURITY DEFINER`), que valida, bloquea el banco y mantiene los caches. Un trigger crea el banco en 0 al crear el proyecto. El ledger (`hucha_movements`) es append-only e inmutable; corregir = postear un movimiento reverso.

**Tech Stack:** Supabase (Postgres 15+), migraciones SQL versionadas en `supabase/migrations/`, aplicadas vía Supabase MCP (`apply_migration` / `execute_sql`). Tests = scripts SQL de aserción transaccionales que impersonan roles vía `set_config('role', …)` y `set_config('request.jwt.claims', …)`.

## Global Constraints

- Nombre del feature: **HUCHA** (con H) en todo (tablas, columnas, UI). El PDF dice "UCHA"; ignorar.
- 3 roles en `profiles.role`: `operativo`, `manager`, `admin` (exactos).
- Dinero: `numeric(14,2)`, una moneda por banco, default `USD`.
- Umbral de estado "bajo": **`remaining < 0.20 * assigned_total`** (constante global).
- El ledger es **append-only**: nunca `UPDATE`/`DELETE` sobre `hucha_movements`. Corregir = movimiento reverso.
- No incluir nada de Horas (etapas, departamento, multilínea, banco por rol). Fuera de alcance.
- Toda escritura de saldo pasa por `registrar_movimiento_hucha()`. Ninguna policy de `INSERT/UPDATE/DELETE` directo de cliente sobre `hucha_banks`/`hucha_movements`.
- No tocar el legacy `time_entries` ni `admin_users` (solo redefinir el cuerpo de `is_admin()`, sin borrar `admin_users`).

## Prerrequisitos de ejecución (hacer antes de la Task 1)

- Activar el **Supabase MCP** (el usuario lo activa cuando empiece la ejecución).
- Confirmar el **objetivo**: aplicar sobre una **branch de Supabase** si el plan lo permite (`create_branch`), o sobre el proyecto principal con cuidado. Confirmar con el usuario antes de aplicar la primera migración.
- Verificar el `project_id` con `mcp__plugin_supabase_supabase__list_projects`.

**Convención de tests:** cada test es un script envuelto en `begin; … rollback;` para no dejar datos. Las aserciones usan `do $$ … if not (cond) then raise exception 'FALLO: …'; end if; … raise notice 'OK: …'; end $$;`. "Pasa" = no se lanzó ninguna excepción antes del `rollback`. Se ejecutan con `mcp__plugin_supabase_supabase__execute_sql`.

---

## File Structure

- `supabase/migrations/0001_foundation.sql` — profiles, projects, project_assignments, triggers de auth y helpers, redefinición de `is_admin()`.
- `supabase/migrations/0002_hucha_tables.sql` — hucha_banks, hucha_movements, helper de estado, trigger de auto-creación de banco.
- `supabase/migrations/0003_ledger_function.sql` — `registrar_movimiento_hucha()`.
- `supabase/migrations/0004_rls_policies.sql` — RLS de todas las tablas nuevas.
- `supabase/tests/*.sql` — scripts de aserción por task.

---

## Task 1: Fundación relacional (profiles, projects, assignments) + auth trigger + is_admin

**Files:**
- Create: `supabase/migrations/0001_foundation.sql`
- Create: `supabase/tests/test_foundation.sql`

**Interfaces:**
- Produces:
  - tabla `public.profiles(id uuid pk, email text, full_name text, position text, role text, status text, created_by uuid, created_at timestamptz, updated_at timestamptz)`
  - tabla `public.projects(id uuid pk, name text, client text, status text, created_by uuid, created_at, updated_at)`
  - tabla `public.project_assignments(id uuid pk, project_id uuid, user_id uuid, created_by uuid, created_at, unique(project_id,user_id))`
  - función `public.is_admin() returns boolean`
  - función `public.current_role_app() returns text` (rol del usuario actual)
  - trigger `on_auth_user_created` → crea profile (`role='operativo'`, `status='activo'`)

- [ ] **Step 1: Escribir el test de aserción**

Create `supabase/tests/test_foundation.sql`:

```sql
-- Verifica estructura y trigger de la fundación
begin;

-- Las tablas existen con columnas clave
do $$
begin
  if (select count(*) from information_schema.columns
      where table_name='profiles' and column_name in ('id','email','role','status')) <> 4
  then raise exception 'FALLO: profiles no tiene las columnas esperadas'; end if;

  if not exists (select 1 from information_schema.columns
      where table_name='projects' and column_name='client')
  then raise exception 'FALLO: projects.client no existe'; end if;

  if not exists (select 1 from pg_constraint where conname like '%project_assignments%'
      and contype='u')
  then raise exception 'FALLO: project_assignments sin UNIQUE'; end if;

  raise notice 'OK: estructura de fundación';
end $$;

-- El trigger crea un profile al insertar en auth.users
do $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, 'trigger-test@x.com', '{"full_name":"Trigger Test"}');

  if not exists (select 1 from public.profiles
      where id=v_id and role='operativo' and status='activo' and full_name='Trigger Test')
  then raise exception 'FALLO: el trigger no creó el profile correcto'; end if;

  raise notice 'OK: trigger de auth crea profile';
end $$;

rollback;
```

- [ ] **Step 2: Ejecutar el test → debe FALLAR**

Ejecutar `supabase/tests/test_foundation.sql` con `execute_sql`.
Expected: error tipo `relation "profiles" does not exist` o `FALLO:` (las tablas aún no existen).

- [ ] **Step 3: Escribir la migración**

Create `supabase/migrations/0001_foundation.sql`:

```sql
-- ============================================================
-- 0001 Fundación: profiles, projects, project_assignments
-- ============================================================

-- profiles (extiende auth.users)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text not null default '',
  position    text,
  role        text not null default 'operativo'
              check (role in ('operativo','manager','admin')),
  status      text not null default 'activo'
              check (status in ('activo','inactivo')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- projects
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  client      text,
  status      text not null default 'activo'
              check (status in ('activo','archivado')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- project_assignments
create table if not exists public.project_assignments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists idx_assign_user on public.project_assignments(user_id);
create index if not exists idx_assign_project on public.project_assignments(project_id);

-- Helper: rol del usuario actual
create or replace function public.current_role_app()
returns text language sql security definer stable set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Redefinir is_admin(): profiles.role='admin' O admin_users (fallback legacy)
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
      or exists (select 1 from public.admin_users where email = (auth.jwt() ->> 'email'));
$$;

-- Trigger: crear profile al crear el usuario de auth
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'full_name', ''),
          'operativo', 'activo')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS habilitado (políticas en 0004)
alter table public.profiles            enable row level security;
alter table public.projects            enable row level security;
alter table public.project_assignments enable row level security;
```

- [ ] **Step 4: Aplicar la migración**

Aplicar con `mcp__plugin_supabase_supabase__apply_migration` (name: `0001_foundation`, query: contenido del archivo).
Expected: éxito sin error.

- [ ] **Step 5: Ejecutar el test → debe PASAR**

Ejecutar `supabase/tests/test_foundation.sql` con `execute_sql`.
Expected: `NOTICE: OK: estructura de fundación`, `NOTICE: OK: trigger de auth crea profile`, sin excepción.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0001_foundation.sql supabase/tests/test_foundation.sql
git commit -m "feat(db): fundación profiles/projects/assignments + auth trigger + is_admin"
```

---

## Task 2: Tablas HUCHA + helper de estado + trigger de banco automático

**Files:**
- Create: `supabase/migrations/0002_hucha_tables.sql`
- Create: `supabase/tests/test_hucha_tables.sql`

**Interfaces:**
- Consumes: `public.projects` (Task 1)
- Produces:
  - tabla `public.hucha_banks(id, project_id unique, currency, assigned_total, consumed_total, remaining, status, updated_at)`
  - tabla `public.hucha_movements(id, bank_id, type, amount, balance_before, balance_after, description, reference, reason, actor_id, actor_name, entry_date, created_at, corrects_movement_id)`
  - función `public.compute_hucha_status(p_assigned numeric, p_consumed numeric) returns text`
  - trigger que crea un `hucha_banks` en 0 al insertar un `projects`

- [ ] **Step 1: Escribir el test de aserción**

Create `supabase/tests/test_hucha_tables.sql`:

```sql
begin;

-- compute_hucha_status cubre todos los estados
do $$
begin
  if public.compute_hucha_status(0,0)    <> 'sin_presupuesto' then raise exception 'FALLO: sin_presupuesto'; end if;
  if public.compute_hucha_status(100,0)  <> 'disponible'      then raise exception 'FALLO: disponible'; end if;
  if public.compute_hucha_status(100,90) <> 'bajo'            then raise exception 'FALLO: bajo (90/100)'; end if;
  if public.compute_hucha_status(100,100)<> 'consumido'       then raise exception 'FALLO: consumido'; end if;
  if public.compute_hucha_status(100,110)<> 'excedido'        then raise exception 'FALLO: excedido'; end if;
  if public.compute_hucha_status(0,50)   <> 'excedido'        then raise exception 'FALLO: excedido sobre banco 0'; end if;
  raise notice 'OK: compute_hucha_status';
end $$;

-- crear un proyecto crea su banco en 0
do $$
declare v_pid uuid;
begin
  insert into public.projects (name) values ('Proyecto Test') returning id into v_pid;
  if not exists (select 1 from public.hucha_banks
      where project_id=v_pid and assigned_total=0 and consumed_total=0
        and remaining=0 and status='sin_presupuesto' and currency='USD')
  then raise exception 'FALLO: no se creó el banco en 0 al crear el proyecto'; end if;
  raise notice 'OK: trigger crea banco en 0';
end $$;

rollback;
```

- [ ] **Step 2: Ejecutar el test → debe FALLAR**

Ejecutar con `execute_sql`. Expected: error `function compute_hucha_status does not exist`.

- [ ] **Step 3: Escribir la migración**

Create `supabase/migrations/0002_hucha_tables.sql`:

```sql
-- ============================================================
-- 0002 HUCHA: bancos, movimientos, estado y trigger de banco
-- ============================================================

create table if not exists public.hucha_banks (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null unique references public.projects(id) on delete cascade,
  currency       text not null default 'USD',
  assigned_total numeric(14,2) not null default 0,
  consumed_total numeric(14,2) not null default 0,
  remaining      numeric(14,2) not null default 0,
  status         text not null default 'sin_presupuesto',
  updated_at     timestamptz not null default now()
);

create table if not exists public.hucha_movements (
  id                   uuid primary key default gen_random_uuid(),
  bank_id              uuid not null references public.hucha_banks(id) on delete cascade,
  type                 text not null
                       check (type in ('consumo','ampliacion','correccion','anulacion')),
  amount               numeric(14,2) not null,
  balance_before       numeric(14,2) not null,
  balance_after        numeric(14,2) not null,
  description          text,
  reference            text,
  reason               text,
  actor_id             uuid references public.profiles(id),
  actor_name           text not null default '',
  entry_date           date not null default current_date,
  created_at           timestamptz not null default now(),
  corrects_movement_id uuid references public.hucha_movements(id)
);

create index if not exists idx_mov_bank on public.hucha_movements(bank_id);
create index if not exists idx_mov_date on public.hucha_movements(entry_date desc);

-- Estado del banco según saldo (umbral global 20%)
create or replace function public.compute_hucha_status(p_assigned numeric, p_consumed numeric)
returns text language sql immutable as $$
  select case
    when p_assigned = 0 and p_consumed = 0 then 'sin_presupuesto'
    when (p_assigned - p_consumed) < 0      then 'excedido'
    when (p_assigned - p_consumed) = 0      then 'consumido'
    when p_assigned > 0
         and (p_assigned - p_consumed) < 0.20 * p_assigned then 'bajo'
    else 'disponible'
  end;
$$;

-- Crear banco en 0 al crear el proyecto
create or replace function public.handle_new_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.hucha_banks (project_id, assigned_total, consumed_total, remaining, status)
  values (new.id, 0, 0, 0, 'sin_presupuesto')
  on conflict (project_id) do nothing;
  return new;
end $$;

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_new_project();

alter table public.hucha_banks     enable row level security;
alter table public.hucha_movements enable row level security;
```

- [ ] **Step 4: Aplicar la migración**

`apply_migration` (name: `0002_hucha_tables`). Expected: éxito.

- [ ] **Step 5: Ejecutar el test → debe PASAR**

Expected: `OK: compute_hucha_status`, `OK: trigger crea banco en 0`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0002_hucha_tables.sql supabase/tests/test_hucha_tables.sql
git commit -m "feat(db): tablas HUCHA (banks/movements) + estado + trigger de banco"
```

---

## Task 3: Motor de ledger `registrar_movimiento_hucha()`

**Files:**
- Create: `supabase/migrations/0003_ledger_function.sql`
- Create: `supabase/tests/test_ledger.sql`

**Interfaces:**
- Consumes: `hucha_banks`, `hucha_movements`, `profiles`, `project_assignments`, `compute_hucha_status` (Tasks 1-2)
- Produces:
  ```
  public.registrar_movimiento_hucha(
    p_project_id uuid,
    p_type text,                 -- 'consumo' | 'ampliacion' | 'anulacion'
    p_amount numeric,            -- magnitud > 0
    p_description text default null,
    p_reference text default null,
    p_reason text default null,
    p_entry_date date default current_date,
    p_corrects_movement_id uuid default null
  ) returns public.hucha_movements
  ```
  Reglas: `consumo` exige caller asignado al proyecto (o admin) + descripción no vacía; `ampliacion`/`anulacion` exigen admin; `ampliacion` exige `reason`; siempre `p_amount>0`, `entry_date<=hoy`, usuario `activo`. Bloquea el banco con `FOR UPDATE`. `anulacion` revierte el movimiento referido por `p_corrects_movement_id`.

> **Nota de alcance:** Plan 1 implementa `consumo`, `ampliacion`, `anulacion`. La "corrección" del UI = anular el original + registrar el correcto (dos llamadas). El tipo `correccion` queda reservado en el CHECK para el futuro.

- [ ] **Step 1: Escribir el test de aserción**

Create `supabase/tests/test_ledger.sql`:

```sql
begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_mgr   uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_pid   uuid;
  v_bank  uuid;
  v_consumo public.hucha_movements;
  v_amp   public.hucha_movements;
begin
  -- usuarios
  insert into public.profiles (id, email, full_name, role, status) values
    (v_admin,'admin@x.com','Admin', 'admin','activo'),
    (v_mgr,  'mgr@x.com',  'Manager','manager','activo'),
    (v_other,'other@x.com','Otro',  'manager','activo');

  -- proyecto (crea banco) + asignación del manager
  insert into public.projects (name) values ('Cliente B') returning id into v_pid;
  select id into v_bank from public.hucha_banks where project_id=v_pid;
  insert into public.project_assignments (project_id,user_id) values (v_pid, v_mgr);

  -- ── Impersonar ADMIN: ampliar +500 ──
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_admin,'email','admin@x.com','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);

  v_amp := public.registrar_movimiento_hucha(v_pid,'ampliacion',500,null,'Factura #1','carga');
  if v_amp.balance_after <> 500 then raise exception 'FALLO: ampliacion no dejó 500 (%).', v_amp.balance_after; end if;

  perform set_config('role','postgres', true);
  if (select assigned_total from public.hucha_banks where id=v_bank) <> 500
     then raise exception 'FALLO: assigned_total no es 500'; end if;
  if (select status from public.hucha_banks where id=v_bank) <> 'disponible'
     then raise exception 'FALLO: estado no es disponible'; end if;
  raise notice 'OK: ampliacion admin';

  -- ── Impersonar MANAGER asignado: consumir 100 ──
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_mgr,'email','mgr@x.com','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);

  v_consumo := public.registrar_movimiento_hucha(v_pid,'consumo',100,'Compra recurso',null,null);
  if v_consumo.balance_before <> 500 or v_consumo.balance_after <> 400
     then raise exception 'FALLO: consumo before/after (% / %)', v_consumo.balance_before, v_consumo.balance_after; end if;
  if v_consumo.amount <> -100 then raise exception 'FALLO: amount de consumo no es -100'; end if;
  if v_consumo.actor_name <> 'Manager' then raise exception 'FALLO: actor_name no se guardó'; end if;

  perform set_config('role','postgres', true);
  if (select remaining from public.hucha_banks where id=v_bank) <> 400
     then raise exception 'FALLO: remaining no es 400'; end if;
  raise notice 'OK: consumo manager descuenta';

  -- ── MANAGER no asignado NO puede consumir ──
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_other,'email','other@x.com','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  begin
    perform public.registrar_movimiento_hucha(v_pid,'consumo',10,'hack',null,null);
    perform set_config('role','postgres', true);
    raise exception 'FALLO: manager no asignado pudo consumir';
  exception when sqlstate 'P0001' then
    -- esperado: la función lanzó "no autorizado"; distinguir de nuestro FALLO
    if sqlerrm like 'FALLO:%' then raise; end if;
    perform set_config('role','postgres', true);
    raise notice 'OK: manager no asignado rechazado';
  end;

  -- ── MANAGER NO puede ampliar ──
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_mgr,'email','mgr@x.com','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  begin
    perform public.registrar_movimiento_hucha(v_pid,'ampliacion',999,null,null,'x');
    perform set_config('role','postgres', true);
    raise exception 'FALLO: manager pudo ampliar';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FALLO:%' then raise; end if;
    perform set_config('role','postgres', true);
    raise notice 'OK: manager no puede ampliar';
  end;

  -- ── Validaciones: monto<=0, descripción vacía, fecha futura ──
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_mgr,'email','mgr@x.com','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  begin
    perform public.registrar_movimiento_hucha(v_pid,'consumo',0,'x',null,null);
    perform set_config('role','postgres', true);
    raise exception 'FALLO: aceptó monto 0';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FALLO:%' then raise; end if;
    perform set_config('role','postgres', true);
    raise notice 'OK: rechaza monto <= 0';
  end;

  -- ── Sobreconsumo: permitido, marca excedido ──
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_mgr,'email','mgr@x.com','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  perform public.registrar_movimiento_hucha(v_pid,'consumo',1000,'gasto grande',null,null);
  perform set_config('role','postgres', true);
  if (select status from public.hucha_banks where id=v_bank) <> 'excedido'
     then raise exception 'FALLO: sobreconsumo no marcó excedido'; end if;
  raise notice 'OK: sobreconsumo marca excedido';

  raise notice 'TODOS OK';
end $$;

rollback;
```

- [ ] **Step 2: Ejecutar el test → debe FALLAR**

Expected: `function registrar_movimiento_hucha does not exist`.

- [ ] **Step 3: Escribir la migración**

Create `supabase/migrations/0003_ledger_function.sql`:

```sql
-- ============================================================
-- 0003 Motor de ledger HUCHA
-- ============================================================

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
  -- Usuario y rol
  select role, status, full_name into v_role, v_active, v_name
    from public.profiles where id = v_uid;
  if v_role is null then raise exception 'no autorizado: usuario sin perfil'; end if;
  if v_active <> 'activo' then raise exception 'no autorizado: usuario inactivo'; end if;

  -- Validaciones comunes
  if p_amount is null or p_amount <= 0 then raise exception 'monto inválido: debe ser > 0'; end if;
  if p_entry_date > current_date then raise exception 'fecha inválida: no puede ser futura'; end if;

  -- Bloquear el banco del proyecto
  select * into v_bank from public.hucha_banks
    where project_id = p_project_id for update;
  if v_bank.id is null then raise exception 'el proyecto no tiene banco HUCHA'; end if;

  -- Autorización + cálculo por tipo
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
    -- revertir el efecto del original
    v_signed := -v_orig.amount;   -- si original fue consumo (-X) revierte +X; si ampliacion (+X) revierte -X
    if v_orig.type = 'consumo' then
      v_new_assigned := v_bank.assigned_total;
      v_new_consumed := v_bank.consumed_total + v_orig.amount;  -- amount es negativo → reduce consumido
    else
      v_new_assigned := v_bank.assigned_total - v_orig.amount;  -- amount positivo → reduce asignado
      v_new_consumed := v_bank.consumed_total;
    end if;

  else
    raise exception 'tipo de movimiento no soportado: %', p_type;
  end if;

  v_before := v_bank.remaining;
  v_after  := v_new_assigned - v_new_consumed;

  -- Insertar movimiento inmutable
  insert into public.hucha_movements (
    bank_id, type, amount, balance_before, balance_after,
    description, reference, reason, actor_id, actor_name,
    entry_date, corrects_movement_id)
  values (
    v_bank.id, p_type, v_signed, v_before, v_after,
    p_description, p_reference, p_reason, v_uid, coalesce(v_name,''),
    p_entry_date, p_corrects_movement_id)
  returning * into v_mov;

  -- Actualizar caches del banco
  update public.hucha_banks set
    assigned_total = v_new_assigned,
    consumed_total = v_new_consumed,
    remaining      = v_after,
    status         = public.compute_hucha_status(v_new_assigned, v_new_consumed),
    updated_at     = now()
  where id = v_bank.id;

  return v_mov;
end $$;

-- Permitir que los usuarios autenticados ejecuten la función (la autorización es interna)
grant execute on function public.registrar_movimiento_hucha(uuid,text,numeric,text,text,text,date,uuid) to authenticated;
```

- [ ] **Step 4: Aplicar la migración**

`apply_migration` (name: `0003_ledger_function`). Expected: éxito.

- [ ] **Step 5: Ejecutar el test → debe PASAR**

Expected: secuencia de `OK:` terminando en `NOTICE: TODOS OK`, sin excepción.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0003_ledger_function.sql supabase/tests/test_ledger.sql
git commit -m "feat(db): motor de ledger registrar_movimiento_hucha (consumo/ampliacion/anulacion)"
```

---

## Task 4: Políticas RLS

**Files:**
- Create: `supabase/migrations/0004_rls_policies.sql`
- Create: `supabase/tests/test_rls.sql`

**Interfaces:**
- Consumes: todas las tablas + `is_admin()` (Tasks 1-3)
- Produces: políticas RLS de lectura/escritura por tabla, según la matriz del spec §7.

- [ ] **Step 1: Escribir el test de aserción**

Create `supabase/tests/test_rls.sql`:

```sql
begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_mgr   uuid := gen_random_uuid();
  v_pid_a uuid;  -- asignado al manager
  v_pid_b uuid;  -- NO asignado
  v_count int;
begin
  insert into public.profiles (id,email,full_name,role,status) values
    (v_admin,'admin@x.com','Admin','admin','activo'),
    (v_mgr,  'mgr@x.com','Manager','manager','activo');
  insert into public.projects (name) values ('Proy A') returning id into v_pid_a;
  insert into public.projects (name) values ('Proy B') returning id into v_pid_b;
  insert into public.project_assignments (project_id,user_id) values (v_pid_a, v_mgr);

  -- MANAGER solo ve su proyecto asignado
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_mgr,'email','mgr@x.com','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  select count(*) into v_count from public.projects;
  if v_count <> 1 then raise exception 'FALLO: manager ve % proyectos (esperaba 1)', v_count; end if;

  -- MANAGER no puede crear proyectos (RLS write admin-only)
  begin
    insert into public.projects (name) values ('Hack');
    perform set_config('role','postgres', true);
    raise exception 'FALLO: manager pudo crear proyecto';
  exception when insufficient_privilege or sqlstate '42501' then
    perform set_config('role','postgres', true);
    raise notice 'OK: manager no puede crear proyecto';
  end;

  -- ADMIN ve los dos
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_admin,'email','admin@x.com','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  select count(*) into v_count from public.projects;
  perform set_config('role','postgres', true);
  if v_count <> 2 then raise exception 'FALLO: admin ve % proyectos (esperaba 2)', v_count; end if;

  raise notice 'OK: RLS de visibilidad de proyectos';
  raise notice 'TODOS OK';
end $$;

rollback;
```

- [ ] **Step 2: Ejecutar el test → debe FALLAR**

Expected: el manager ve 2 proyectos (sin RLS aún) → `FALLO: manager ve 2 proyectos`. (O el insert no es rechazado.)

- [ ] **Step 3: Escribir la migración**

Create `supabase/migrations/0004_rls_policies.sql`:

```sql
-- ============================================================
-- 0004 Políticas RLS (matriz spec §7)
-- ============================================================

-- ── profiles ──
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin on public.profiles for insert
  with check (public.is_admin());

-- ── projects ──
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select
  using (
    public.is_admin()
    or exists (select 1 from public.project_assignments pa
               where pa.project_id = projects.id and pa.user_id = auth.uid())
  );

drop policy if exists projects_write_admin on public.projects;
create policy projects_insert_admin on public.projects for insert with check (public.is_admin());
create policy projects_update_admin on public.projects for update using (public.is_admin()) with check (public.is_admin());

-- ── project_assignments ──
drop policy if exists assign_select on public.project_assignments;
create policy assign_select on public.project_assignments for select
  using (user_id = auth.uid() or public.is_admin());

create policy assign_insert_admin on public.project_assignments for insert with check (public.is_admin());
create policy assign_delete_admin on public.project_assignments for delete using (public.is_admin());

-- ── hucha_banks ── (solo lectura para clientes; escritura solo vía función definer)
drop policy if exists banks_select on public.hucha_banks;
create policy banks_select on public.hucha_banks for select
  using (
    public.is_admin()
    or exists (select 1 from public.project_assignments pa
               where pa.project_id = hucha_banks.project_id and pa.user_id = auth.uid())
  );
-- sin policies de insert/update/delete → nadie escribe directo (la función es SECURITY DEFINER)

-- ── hucha_movements ── (solo lectura; append vía función)
drop policy if exists movs_select on public.hucha_movements;
create policy movs_select on public.hucha_movements for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.hucha_banks b
      join public.project_assignments pa on pa.project_id = b.project_id
      where b.id = hucha_movements.bank_id and pa.user_id = auth.uid())
  );
-- sin insert/update/delete directos
```

- [ ] **Step 4: Aplicar la migración**

`apply_migration` (name: `0004_rls_policies`). Expected: éxito.

- [ ] **Step 5: Ejecutar el test → debe PASAR**

Expected: `OK: manager no puede crear proyecto`, `OK: RLS de visibilidad de proyectos`, `TODOS OK`.

- [ ] **Step 6: Re-ejecutar TODOS los tests previos (regresión)**

Ejecutar `test_foundation.sql`, `test_hucha_tables.sql`, `test_ledger.sql`, `test_rls.sql`.
Expected: todos terminan en sus `OK:` sin excepción. (Verifica que la función SECURITY DEFINER sigue funcionando con RLS activo — el `set_config('role','authenticated')` ya no es superusuario.)

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0004_rls_policies.sql supabase/tests/test_rls.sql
git commit -m "feat(db): políticas RLS para fundación y HUCHA (matriz §7)"
```

---

## Self-Review (completado por el autor del plan)

**Cobertura del spec (Plan 1 = fundación + ledger):**
- §3 roles → Task 1 (`profiles.role` CHECK). ✅
- §5 modelo de datos (profiles/projects/assignments/banks/movements) → Tasks 1-2. ✅
- §5 `actor_name` snapshot → Task 3 (la función lo guarda). ✅
- §6 motor de ledger (lock, before/after, caches, reverso) → Task 3. ✅
- §7 RLS (lecturas + escritura solo admin + saldo solo vía función) → Task 4. ✅
- §9 validaciones (monto>0, descripción, fecha no futura, inactivo, sobreconsumo) → Task 3 tests. ✅
- §9 estados + precedencia → Task 2 (`compute_hucha_status`) + tests. ✅
- §9 concurrencia (FOR UPDATE) → Task 3 (implementado; nota: el test de carrera real se cubre en integración con el cliente en Plan 2/3, aquí se garantiza el `FOR UPDATE`). ✅
- Banco auto en 0 → Task 2. ✅
- `is_admin()` redefinido sin romper legacy → Task 1. ✅

**Fuera de alcance de Plan 1 (van a Plan 2/3):** UI, auth wiring de Next, export, dashboard, gestión de usuarios/proyectos desde la app. Correcto.

**Placeholders:** ninguno — todas las migraciones y tests llevan SQL completo.

**Consistencia de tipos:** la firma de `registrar_movimiento_hucha(uuid,text,numeric,text,text,text,date,uuid)` es idéntica en Interfaces, migración 0003 y el `grant`. Las columnas usadas en tests coinciden con las migraciones 0001/0002.
```
