# Auditoría: filtros, agrupación y detalle del cambio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir `/admin/auditoria` de una tabla plana de 200 filas en una auditoría con rango de fechas, filtros, agrupación plegable y detalle de qué cambió en cada movimiento.

**Architecture:** El servidor acota por rango (la pantalla ya oculta dos tercios del último mes con su `limit(200)`) y el cliente hace filtrado, agrupación y despliegue. La lógica pura —agrupar, comparar snapshots, calcular los límites del rango— vive en `lib/horas/auditoria-types.ts` sin imports de servidor, para probarla sin navegador. El "qué cambió" no se puede reconstruir: hay que empezar a guardarlo, así que una migración añade dos columnas `jsonb` y redefine los dos RPC vivos para rellenarlas dentro de la misma transacción que ya escribe el asiento.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind v4, Supabase/Postgres, Playwright como único runner de tests.

**Spec:** `docs/superpowers/specs/2026-08-05-auditoria-filtros-agrupacion-design.md`

## Global Constraints

- **Gate de verificación del repo: `npx tsc --noEmit` y `npm run build`.** `npm run lint` está roto repo-wide desde Next 16 — no lo uses como señal.
- **Nunca arranques ni pares el dev server.** Lo gestiona el usuario. `playwright.config.ts` no tiene bloque `webServer` a propósito.
- **Los tests de Playwright necesitan el dev server ya levantado en `http://localhost:3000`**, incluso los del proyecto `node-horas` que son funciones puras: `globalSetup` hace login por navegador antes de cualquier proyecto. Si falla ahí, el dev server no está arriba: pídeselo al usuario.
- **Playwright no hace type-check** (transpila con esbuild). Un import inexistente llega a ejecución como `undefined` y revienta con `TypeError: X is not a function`. Los errores de tipos los da `npx tsc --noEmit`.
- **Las migraciones se aplican en el Supabase remoto** vía MCP `apply_migration` (proyecto `msfylcgtlathccmxuheq`) o el SQL editor del dashboard. No hay stack local.
- **Sin identidad visual nueva.** Ni paleta, ni tipografías, ni componentes nuevos. Se reutilizan `NativeSelect`, `Badge`, `cn` y las clases ya usadas en `ReportesView.tsx`.
- **La pantalla es solo para `role === 'admin'`.** No se abre a managers en este plan.
- **Los 661 asientos ya existentes no tienen snapshot y no se pueden reconstruir.** La UI debe decirlo explícitamente, nunca pintar un diff vacío.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `supabase/migrations/0041_horas_auditoria_detalle.sql` (crear) | Columnas `lines_before`/`lines_after`, índices, helper `audit_snapshot_lineas`, redefinición de `guardar_registro` y `anular_registro_diario` |
| `supabase/tests/horas_auditoria_detalle.sql` (crear) | Test SQL de los snapshots en crear / editar / anular / multi-fecha |
| `lib/horas/auditoria-types.ts` (crear) | Tipos + lógica pura: fechas, filtro, agrupación, diff, resumen |
| `lib/horas/auditoria.ts` (crear) | Consulta al servidor con rango, base de fecha y tope de filas |
| `app/(horas)/admin/auditoria/page.tsx` (modificar) | Guard admin, formulario de rango, delega el render |
| `components/horas/AuditoriaView.tsx` (crear) | Toda la interacción: resumen, filtros, agrupación, despliegue, descarga |
| `e2e/horas-auditoria-diff.spec.ts` (crear) | Tests de función pura (proyecto `node-horas`) |
| `e2e/horas-auditoria.spec.ts` (modificar) | E2E de la pantalla |
| `playwright.config.ts` (modificar) | Alta del spec nuevo en `node-horas` y en el `testIgnore` de `chromium-horas` |

---

### Task 1: Migración 0041 — snapshots antes/después

**Files:**
- Create: `supabase/migrations/0041_horas_auditoria_detalle.sql`
- Create: `supabase/tests/horas_auditoria_detalle.sql`
- Reference: `supabase/migrations/0039_horas_registro_julio_libertad.sql` (definición viva de `guardar_registro`), `supabase/migrations/0017_horas_auditoria.sql:133-157` (definición viva de `anular_registro_diario`)

**Interfaces:**
- Produces: columnas `time_log_audit.lines_before` y `time_log_audit.lines_after` (`jsonb`, nullable). Cada una es un array de objetos con estas claves exactas, que Task 2 tipa como `AuditSnapshotLine`: `project` (text), `area` (text), `department` (text), `etapa` (text), `hours` (number), `description` (text).
- Produces: función `public.audit_snapshot_lineas(p_log_id uuid) returns jsonb`.

- [ ] **Step 1: Crear el archivo copiando la definición viva de `guardar_registro`**

Crea `supabase/migrations/0041_horas_auditoria_detalle.sql`. Empieza copiando **verbatim** el cuerpo entero de `create or replace function public.guardar_registro(...)` desde `supabase/migrations/0039_horas_registro_julio_libertad.sql` (líneas 14 a 195, incluido el `end $function$;`). No reescribas la función de memoria: es la definición viva y cualquier diferencia sería una regresión silenciosa en las validaciones de fecha, área, etapa y duplicados.

Sobre esa copia se aplican los cambios de los pasos 3 y 4. Antes va la cabecera y el DDL del paso 2.

- [ ] **Step 2: Cabecera, columnas, índices y helper**

Al principio del archivo, **antes** de la función copiada:

```sql
-- ============================================================
-- 0041 HORAS: detalle del cambio en la auditoría (antes/después)
-- ------------------------------------------------------------
-- time_log_audit decía QUE algo pasó, no QUÉ cambió: tras una edición no había
-- forma de saber qué línea se tocó. Se añaden dos snapshots jsonb que se rellenan
-- dentro de los RPC, en la misma transacción que ya escribe el asiento.
--
-- Los snapshots guardan NOMBRES ya resueltos (área, etapa), no ids, por la misma
-- razón por la que la tabla ya guarda actor_name: el asiento debe leerse igual
-- dentro de un año aunque se renombre un área. Si un área se renombra, los
-- asientos viejos muestran el nombre viejo — que es lo correcto en una auditoría.
--
-- Los asientos anteriores a esta migración se quedan con ambas columnas a NULL:
-- las líneas viejas se borraron al editar y no hay nada que reconstruir. La UI
-- distingue ese caso (before y after ambos null) y lo rotula.
--
-- Cambios sobre la definición viva de guardar_registro (0039):
--   * declaraciones v_before / v_after
--   * snapshot del "antes" justo antes del delete de las líneas del ancla
--   * snapshot del "después" tras fijar total_hours de cada log
--   * el insert de auditoría pasa a llevar lines_before / lines_after
-- El resto (validaciones, dedup, split por fecha, ventana de julio) = 0039 sin tocar.
-- ============================================================

alter table public.time_log_audit
  add column if not exists lines_before jsonb,
  add column if not exists lines_after  jsonb;

comment on column public.time_log_audit.lines_before is
  'Líneas del registro ANTES del cambio (nombres resueltos). NULL en crear y en asientos previos a 0041.';
comment on column public.time_log_audit.lines_after is
  'Líneas del registro DESPUÉS del cambio (nombres resueltos). NULL en anular y en asientos previos a 0041.';

-- Índices para lo que la pantalla nueva sí consulta: rango por fecha del registro
-- y "qué ha tocado esta persona" en orden cronológico.
create index if not exists time_log_audit_entry_date_idx on public.time_log_audit(entry_date);
create index if not exists time_log_audit_actor_idx      on public.time_log_audit(actor_id, at desc);

-- Snapshot de las líneas vivas de un log, con área y etapa resueltas a nombre.
-- Orden estable (proyecto, luego descripción) para que dos snapshots del mismo
-- contenido se comparen sin ruido de ordenación.
--
-- SECURITY INVOKER a propósito: se llama desde dentro de los RPC, que son SECURITY
-- DEFINER, así que ahí ya corre con los privilegios del owner. Dejarla invoker evita
-- crear un atajo para leer líneas de cualquier registro; el revoke de abajo cierra
-- la puerta a llamarla suelta desde PostgREST.
create or replace function public.audit_snapshot_lineas(p_log_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'project',     l.project,
        'area',        coalesce(a.name, '—'),
        'department',  coalesce(l.department, '—'),
        'etapa',       coalesce(e.name, '—'),
        'hours',       l.hours,
        'description', coalesce(l.description, '')
      )
      order by l.project, coalesce(l.description, '')
    ),
    '[]'::jsonb
  )
  from public.time_log_lines l
  left join public.areas  a on a.id = l.area_id
  left join public.etapas e on e.id = l.etapa_id
  where l.log_id = p_log_id;
$$;

revoke all on function public.audit_snapshot_lineas(uuid) from public;
```

- [ ] **Step 3: Añadir los snapshots a `guardar_registro`**

Sobre la copia de la función, tres ediciones puntuales.

**(a)** En el bloque `declare`, después de `v_total numeric(6,2);`, añade:

```sql
  v_before           jsonb;          -- snapshot del ancla ANTES de borrar sus líneas (0041)
  v_after            jsonb;          -- snapshot del log recién escrito (0041)
```

**(b)** El bloque que hoy dice (está justo antes del `foreach v_date in array v_dates loop`):

```sql
  if p_anchor_log_id is not null then
    if v_anchor.entry_date = any(v_dates) then
      v_anchor_date := v_anchor.entry_date;
    else
      v_anchor_date := v_dates[1];
    end if;
    delete from public.time_log_lines where log_id = v_anchor.id;
  end if;
```

pasa a ser:

```sql
  if p_anchor_log_id is not null then
    if v_anchor.entry_date = any(v_dates) then
      v_anchor_date := v_anchor.entry_date;
    else
      v_anchor_date := v_dates[1];
    end if;
    -- El "antes" se toma AQUÍ: el delete de la línea siguiente es destructivo y
    -- después ya no hay nada que fotografiar.
    v_before := public.audit_snapshot_lineas(v_anchor.id);
    delete from public.time_log_lines where log_id = v_anchor.id;
  end if;
```

**(c)** El `update` del total y el insert de auditoría que hoy dicen:

```sql
    update public.time_logs set total_hours = v_total where id = v_log_id;

    insert into public.time_log_audit(log_id, action, actor_id, actor_name, subject_name, entry_date, total_hours)
    values (
      v_log_id,
      case when (p_anchor_log_id is not null and v_log_id = v_anchor.id) then 'editar' else 'crear' end,
      v_uid,
      (select full_name from public.profiles where id = v_uid),
      (select full_name from public.profiles where id = v_owner),
      v_date,
      v_total
    );
```

pasan a:

```sql
    update public.time_logs set total_hours = v_total where id = v_log_id;

    v_after := public.audit_snapshot_lineas(v_log_id);

    insert into public.time_log_audit(log_id, action, actor_id, actor_name, subject_name, entry_date, total_hours, lines_before, lines_after)
    values (
      v_log_id,
      case when (p_anchor_log_id is not null and v_log_id = v_anchor.id) then 'editar' else 'crear' end,
      v_uid,
      (select full_name from public.profiles where id = v_uid),
      (select full_name from public.profiles where id = v_owner),
      v_date,
      v_total,
      -- En un guardado multi-fecha solo el ancla es una edición: las demás fechas
      -- son logs nuevos y no tienen un "antes".
      case when (p_anchor_log_id is not null and v_log_id = v_anchor.id) then v_before else null end,
      v_after
    );
```

- [ ] **Step 4: Redefinir `anular_registro_diario` con el snapshot**

Al final del archivo, después de `guardar_registro`, añade la función completa. Es la definición viva de `0017:133-157` con el snapshot añadido:

```sql
-- anular_registro_diario (= 0017) + snapshot del "antes" (0041).
create or replace function public.anular_registro_diario(p_log_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_log    public.time_logs;
  v_before jsonb;
begin
  select role into v_role from public.profiles where id = v_uid;
  if v_role is null then raise exception 'no autorizado'; end if;

  select * into v_log from public.time_logs where id = p_log_id for update;
  if v_log.id is null then raise exception 'registro no encontrado'; end if;
  if v_log.user_id <> v_uid and v_role <> 'admin' then raise exception 'no autorizado: registro de otro usuario'; end if;
  if v_role <> 'admin' and v_log.entry_date < current_date - 7 then
    raise exception 'fuera de rango: solo admin puede anular registros de más de 7 días';
  end if;

  -- Las líneas no se borran al anular (el registro queda marcado), pero el snapshot
  -- se toma igualmente: deja constancia de qué se estaba anulando aunque el registro
  -- se edite o se purgue después.
  v_before := public.audit_snapshot_lineas(p_log_id);

  update public.time_logs set status = 'anulado', updated_by = v_uid, updated_at = now() where id = p_log_id;

  insert into public.time_log_audit(log_id, action, actor_id, actor_name, subject_name, entry_date, total_hours, lines_before, lines_after)
  values (p_log_id, 'anular', v_uid,
    (select full_name from public.profiles where id = v_uid),
    (select full_name from public.profiles where id = v_log.user_id),
    v_log.entry_date, v_log.total_hours, v_before, null);
end $$;
```

- [ ] **Step 5: Escribir el test SQL**

Crea `supabase/tests/horas_auditoria_detalle.sql`:

```sql
-- Snapshots antes/después de la auditoría (migración 0041).
-- Sigue el patrón de horas_rpc_anular.sql: se hace pasar por un operativo activo
-- vía request.jwt.claims, opera con los RPC reales y limpia lo que crea.

do $$
declare
  v_op uuid; v_area uuid; v_etapa uuid; v_log uuid;
  v_before jsonb; v_after jsonb;
begin
  select id into v_op from public.profiles where role='operativo' and status='activo' limit 1;
  if v_op is null then raise notice 'SKIP: no hay operativo'; return; end if;
  select id into v_area from public.areas where name='CRM';
  select id into v_etapa from public.etapas where name='Setup';
  perform set_config('request.jwt.claims', json_build_object('sub', v_op::text,'role','authenticated')::text, true);

  -- CREAR: sin "antes", con "después".
  v_log := public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date',current_date,'project','C','area_id',v_area,
                       'department','Clientes','etapa_id',v_etapa,'hours',2,'description','uno')));
  select lines_before, lines_after into v_before, v_after
    from public.time_log_audit where log_id=v_log and action='crear';
  if v_before is not null then raise exception 'crear no debe traer lines_before'; end if;
  if jsonb_array_length(v_after) <> 1 then raise exception 'crear: lines_after debe traer 1 linea'; end if;
  if (v_after->0->>'hours')::numeric <> 2 then raise exception 'crear: horas mal en el snapshot'; end if;
  if (v_after->0->>'area') <> 'CRM' then raise exception 'crear: el area debe venir resuelta a nombre'; end if;
  if (v_after->0->>'etapa') <> 'Setup' then raise exception 'crear: la etapa debe venir resuelta a nombre'; end if;

  -- EDITAR: "antes" = lo viejo, "después" = lo nuevo.
  perform public.guardar_registro(v_log, jsonb_build_array(
    jsonb_build_object('entry_date',current_date,'project','C','area_id',v_area,
                       'department','Clientes','etapa_id',v_etapa,'hours',5,'description','uno')));
  select lines_before, lines_after into v_before, v_after
    from public.time_log_audit where log_id=v_log and action='editar';
  if (v_before->0->>'hours')::numeric <> 2 then raise exception 'editar: lines_before debe traer las horas viejas'; end if;
  if (v_after->0->>'hours')::numeric <> 5 then raise exception 'editar: lines_after debe traer las horas nuevas'; end if;

  -- ANULAR: "antes" = lo vivo, "después" = null.
  perform public.anular_registro_diario(v_log);
  select lines_before, lines_after into v_before, v_after
    from public.time_log_audit where log_id=v_log and action='anular';
  if (v_before->0->>'hours')::numeric <> 5 then raise exception 'anular: lines_before debe traer lo vivo'; end if;
  if v_after is not null then raise exception 'anular: lines_after debe ser null'; end if;

  delete from public.time_log_audit where log_id = v_log;
  delete from public.time_logs where id = v_log;
  raise notice 'OK auditoria detalle: crear/editar/anular';
end $$;

-- Multi-fecha: al editar añadiendo una segunda fecha, solo el ancla es 'editar' y
-- lleva "antes"; la fecha nueva es un log nuevo, y un 'crear' no tiene pasado.
do $$
declare
  v_op uuid; v_area uuid; v_etapa uuid; v_log uuid; v_otro uuid; v_before jsonb;
begin
  select id into v_op from public.profiles where role='operativo' and status='activo' limit 1;
  if v_op is null then raise notice 'SKIP: no hay operativo'; return; end if;
  select id into v_area from public.areas where name='CRM';
  select id into v_etapa from public.etapas where name='Setup';
  perform set_config('request.jwt.claims', json_build_object('sub', v_op::text,'role','authenticated')::text, true);

  v_log := public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date',current_date,'project','C','area_id',v_area,
                       'department','Clientes','etapa_id',v_etapa,'hours',3,'description','ancla')));

  perform public.guardar_registro(v_log, jsonb_build_array(
    jsonb_build_object('entry_date',current_date,'project','C','area_id',v_area,
                       'department','Clientes','etapa_id',v_etapa,'hours',3,'description','ancla'),
    jsonb_build_object('entry_date',current_date - 1,'project','C','area_id',v_area,
                       'department','Clientes','etapa_id',v_etapa,'hours',4,'description','nueva')));

  select id into v_otro from public.time_logs
    where user_id = v_op and entry_date = current_date - 1 and id <> v_log
    order by created_at desc limit 1;
  if v_otro is null then raise exception 'multi-fecha: no se creó el log de la segunda fecha'; end if;

  select lines_before into v_before from public.time_log_audit where log_id = v_log and action = 'editar';
  if v_before is null then raise exception 'multi-fecha: el ancla debe traer lines_before'; end if;

  select lines_before into v_before from public.time_log_audit where log_id = v_otro and action = 'crear';
  if v_before is not null then raise exception 'multi-fecha: la fecha nueva no debe traer lines_before'; end if;

  delete from public.time_log_audit where log_id in (v_log, v_otro);
  delete from public.time_logs where id in (v_log, v_otro);
  raise notice 'OK auditoria detalle: multi-fecha';
end $$;
```

- [ ] **Step 6: Aplicar la migración y correr el test**

Aplica `supabase/migrations/0041_horas_auditoria_detalle.sql` en el Supabase remoto (MCP `apply_migration`, proyecto `msfylcgtlathccmxuheq`, o el SQL editor del dashboard).

Después ejecuta el contenido de `supabase/tests/horas_auditoria_detalle.sql` (MCP `execute_sql` o el editor).

Expected: dos `NOTICE` — `OK auditoria detalle: crear/editar/anular` y `OK auditoria detalle: multi-fecha`. Cualquier `exception` es un fallo real: no lo silencies, arregla la migración y vuelve a aplicarla.

- [ ] **Step 7: Comprobar que los asientos viejos quedaron intactos**

Run (MCP `execute_sql`):

```sql
select count(*) as total,
       count(*) filter (where lines_before is null and lines_after is null) as sin_detalle
from public.time_log_audit;
```

Expected: `sin_detalle` = los 661 asientos previos (± los que se creen mientras tanto). Confirma que la migración no inventó snapshots donde no los hay.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0041_horas_auditoria_detalle.sql supabase/tests/horas_auditoria_detalle.sql
git commit -m "feat(auditoria): guardar el antes y el despues de cada movimiento"
```

---

### Task 2: Lógica pura — `lib/horas/auditoria-types.ts`

**Files:**
- Create: `lib/horas/auditoria-types.ts`
- Create: `e2e/horas-auditoria-diff.spec.ts`
- Modify: `playwright.config.ts:17` y `:24`

**Interfaces:**
- Consumes: `formatFechaISO` y `mesCorto` de `lib/horas/format.ts`; las claves del snapshot que produce Task 1.
- Produces (lo usan Tasks 3, 4 y 5): tipos `AuditAction`, `AuditSnapshotLine`, `AuditEntry`, `AuditDateBase`, `AuditGroupBy`, `AuditGroup`, `AuditFiltros`, `AuditOpcion`, `AuditResumen`, `DiffMark`, `DiffLine`; constantes `AUDIT_ACTIONS`, `AUDIT_ACTION_LABELS`, `AUDIT_GROUP_LABELS`, `AUDIT_GROUP_ORDER`; funciones `diaMadrid`, `inicioDiaMadridUTC`, `addDiasISO`, `diaDe`, `actorKey`, `filtrar`, `agrupar`, `claveLinea`, `diffLineas`, `tieneDetalle`, `totalDe`, `opcionesDe`, `resumir`.

- [ ] **Step 1: Dar de alta el spec nuevo en Playwright**

En `playwright.config.ts`, el proyecto `node-horas` (línea 17) pasa a:

```ts
      testMatch: ['**/horas-alertas.spec.ts', '**/horas-carry.spec.ts', '**/horas-reportes-mes.spec.ts', '**/horas-auditoria-diff.spec.ts'],
```

Y en el `testIgnore` del proyecto `chromium-horas` (línea 24) añade `'**/horas-auditoria-diff.spec.ts'` al array.

**Las dos altas son obligatorias.** `chromium-horas` captura `**/horas-*.spec.ts`, así que sin la exclusión el test de funciones puras correría además en navegador, con la sesión de un operativo, y fallaría por motivos que no tienen nada que ver con lo que prueba. Es el mismo doble alta que ya tiene `horas-reportes-mes.spec.ts`.

- [ ] **Step 2: Escribir los tests que fallan**

Crea `e2e/horas-auditoria-diff.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import type { AuditEntry, AuditSnapshotLine } from '../lib/horas/auditoria-types'
import {
  addDiasISO, agrupar, claveLinea, diaMadrid, diffLineas, filtrar,
  inicioDiaMadridUTC, opcionesDe, resumir, tieneDetalle, totalDe,
} from '../lib/horas/auditoria-types'

// Línea de snapshot mínima: los tests van cambiando lo que a cada uno le importa.
const linea = (p: Partial<AuditSnapshotLine> = {}): AuditSnapshotLine => ({
  project: 'Vancubic', area: 'CRM', department: 'Clientes', etapa: 'Setup',
  hours: 2, description: 'motivo', ...p,
})

const asiento = (p: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 'a1', action: 'editar', actorId: 'u1', actorName: 'Marcos Ruiz',
  subjectName: 'Ana López', entryDate: '2026-08-03', totalHours: 8,
  at: '2026-08-04T10:12:00.000Z', before: null, after: null, ...p,
})

// --- Fechas ---------------------------------------------------------------

test('diaMadrid usa el dia del reloj de Madrid, no el de UTC', () => {
  // 23:30 UTC del 4 de agosto son las 01:30 del 5 en Madrid (verano, UTC+2).
  expect(diaMadrid('2026-08-04T23:30:00.000Z')).toBe('2026-08-05')
})

test('diaMadrid en invierno desplaza una sola hora', () => {
  // 23:30 UTC del 4 de enero son las 00:30 del 5 en Madrid (invierno, UTC+1).
  expect(diaMadrid('2026-01-04T23:30:00.000Z')).toBe('2026-01-05')
})

test('inicioDiaMadridUTC en verano cae a las 22:00 del dia anterior', () => {
  expect(inicioDiaMadridUTC('2026-08-05')).toBe('2026-08-04T22:00:00.000Z')
})

test('inicioDiaMadridUTC en invierno cae a las 23:00 del dia anterior', () => {
  expect(inicioDiaMadridUTC('2026-01-05')).toBe('2026-01-04T23:00:00.000Z')
})

test('addDiasISO suma y cruza el fin de mes', () => {
  expect(addDiasISO('2026-08-31', 1)).toBe('2026-09-01')
  expect(addDiasISO('2026-01-01', -1)).toBe('2025-12-31')
})

// --- Filtro ---------------------------------------------------------------

test('filtrar sin nada puesto devuelve todo', () => {
  const entries = [asiento({ id: 'a' }), asiento({ id: 'b', action: 'crear' })]
  expect(filtrar(entries, { acciones: [], actorKey: '', subjectKey: '' })).toHaveLength(2)
})

test('filtrar por accion deja solo las marcadas', () => {
  const entries = [
    asiento({ id: 'a', action: 'crear' }),
    asiento({ id: 'b', action: 'editar' }),
    asiento({ id: 'c', action: 'anular' }),
  ]
  const res = filtrar(entries, { acciones: ['editar', 'anular'], actorKey: '', subjectKey: '' })
  expect(res.map((e) => e.id)).toEqual(['b', 'c'])
})

test('filtrar por actor y por sujeto son filtros distintos', () => {
  const entries = [
    asiento({ id: 'a', actorId: 'u1', subjectName: 'Ana López' }),
    asiento({ id: 'b', actorId: 'u2', subjectName: 'Ana López' }),
  ]
  expect(filtrar(entries, { acciones: [], actorKey: 'u1', subjectKey: '' }).map((e) => e.id)).toEqual(['a'])
  expect(filtrar(entries, { acciones: [], actorKey: '', subjectKey: 'Ana López' }).map((e) => e.id)).toEqual(['a', 'b'])
})

// --- Agrupación -----------------------------------------------------------

test('agrupar por actor cuenta movimientos y acciones', () => {
  const entries = [
    asiento({ id: 'a', actorId: 'u1', action: 'editar', totalHours: 8 }),
    asiento({ id: 'b', actorId: 'u1', action: 'anular', totalHours: 2 }),
    asiento({ id: 'c', actorId: 'u2', action: 'crear', totalHours: 5 }),
  ]
  const grupos = agrupar(entries, 'actor', 'at')
  expect(grupos).toHaveLength(2)
  expect(grupos[0].key).toBe('u1')
  expect(grupos[0].entries).toHaveLength(2)
  expect(grupos[0].counts).toEqual({ crear: 0, editar: 1, anular: 1 })
  expect(grupos[0].hours).toBe(10)
})

test('agrupar por actor no funde a dos homonimos con id distinto', () => {
  const entries = [
    asiento({ id: 'a', actorId: 'u1', actorName: 'Ana López' }),
    asiento({ id: 'b', actorId: 'u2', actorName: 'Ana López' }),
  ]
  expect(agrupar(entries, 'actor', 'at')).toHaveLength(2)
})

test('agrupar por actor sin id cae al nombre como identidad', () => {
  const entries = [
    asiento({ id: 'a', actorId: null, actorName: 'Sistema' }),
    asiento({ id: 'b', actorId: null, actorName: 'Sistema' }),
  ]
  const grupos = agrupar(entries, 'actor', 'at')
  expect(grupos).toHaveLength(1)
  expect(grupos[0].label).toBe('Sistema')
})

test('agrupar ordena por volumen de movimientos', () => {
  const entries = [
    asiento({ id: 'a', actorId: 'u1' }),
    asiento({ id: 'b', actorId: 'u2' }),
    asiento({ id: 'c', actorId: 'u2' }),
  ]
  expect(agrupar(entries, 'actor', 'at').map((g) => g.key)).toEqual(['u2', 'u1'])
})

test('agrupar por dia ordena cronologico descendente, no por volumen', () => {
  const entries = [
    asiento({ id: 'a', at: '2026-08-01T09:00:00.000Z' }),
    asiento({ id: 'b', at: '2026-08-01T10:00:00.000Z' }),
    asiento({ id: 'c', at: '2026-08-03T09:00:00.000Z' }),
  ]
  expect(agrupar(entries, 'date', 'at').map((g) => g.key)).toEqual(['2026-08-03', '2026-08-01'])
})

test('agrupar por dia con base entry_date usa la fecha del registro, no la del movimiento', () => {
  const entries = [asiento({ at: '2026-08-04T10:00:00.000Z', entryDate: '2026-07-15' })]
  expect(agrupar(entries, 'date', 'entry_date')[0].key).toBe('2026-07-15')
})

test('agrupar por mes agrupa las claves YYYY-MM', () => {
  const entries = [
    asiento({ id: 'a', at: '2026-07-02T09:00:00.000Z' }),
    asiento({ id: 'b', at: '2026-07-30T09:00:00.000Z' }),
    asiento({ id: 'c', at: '2026-08-01T09:00:00.000Z' }),
  ]
  const grupos = agrupar(entries, 'month', 'at')
  expect(grupos.map((g) => g.key)).toEqual(['2026-08', '2026-07'])
  expect(grupos[1].entries).toHaveLength(2)
})

test('agrupar conserva el orden de entrada dentro del grupo', () => {
  const entries = [
    asiento({ id: 'nuevo', actorId: 'u1', at: '2026-08-04T10:00:00.000Z' }),
    asiento({ id: 'viejo', actorId: 'u1', at: '2026-08-01T10:00:00.000Z' }),
  ]
  expect(agrupar(entries, 'actor', 'at')[0].entries.map((e) => e.id)).toEqual(['nuevo', 'viejo'])
})

test('agrupar por none no produce grupos', () => {
  expect(agrupar([asiento()], 'none', 'at')).toEqual([])
})

// --- Diff -----------------------------------------------------------------

test('diffLineas marca una linea anadida', () => {
  const res = diffLineas([], [linea({ project: 'Vancubic' })])
  expect(res).toHaveLength(1)
  expect(res[0].mark).toBe('+')
  expect(res[0].hoursBefore).toBeNull()
  expect(res[0].hoursAfter).toBe(2)
})

test('diffLineas marca una linea eliminada', () => {
  const res = diffLineas([linea({ project: 'Vancubic' })], [])
  expect(res[0].mark).toBe('-')
  expect(res[0].hoursBefore).toBe(2)
  expect(res[0].hoursAfter).toBeNull()
})

test('diffLineas marca el cambio de horas de una misma linea', () => {
  const res = diffLineas([linea({ hours: 3 })], [linea({ hours: 4.5 })])
  expect(res).toHaveLength(1)
  expect(res[0].mark).toBe('~')
  expect(res[0].hoursBefore).toBe(3)
  expect(res[0].hoursAfter).toBe(4.5)
})

test('diffLineas deja sin marca lo que no cambio', () => {
  const res = diffLineas([linea()], [linea()])
  expect(res[0].mark).toBe('=')
})

// La descripción entra en la clave a propósito: en una auditoría un motivo
// reescrito es un cambio que debe verse entero, no un matiz de la misma línea.
test('diffLineas trata el motivo reescrito como par eliminada + anadida', () => {
  const res = diffLineas([linea({ description: 'viejo' })], [linea({ description: 'nuevo' })])
  expect(res.map((r) => r.mark)).toEqual(['+', '-'])
})

test('diffLineas ordena cambios, anadidas, eliminadas y por ultimo lo intacto', () => {
  const before = [
    linea({ project: 'Intacto' }),
    linea({ project: 'Cambia', hours: 1 }),
    linea({ project: 'Se va' }),
  ]
  const after = [
    linea({ project: 'Intacto' }),
    linea({ project: 'Cambia', hours: 9 }),
    linea({ project: 'Llega' }),
  ]
  expect(diffLineas(before, after).map((r) => r.mark)).toEqual(['~', '+', '-', '='])
})

test('diffLineas con snapshot ausente en un lado trata el otro entero', () => {
  expect(diffLineas(null, [linea()]).map((r) => r.mark)).toEqual(['+'])
  expect(diffLineas([linea()], null).map((r) => r.mark)).toEqual(['-'])
})

test('claveLinea distingue por proyecto, area, departamento, etapa y motivo', () => {
  expect(claveLinea(linea())).toBe(claveLinea(linea({ hours: 99 })))
  expect(claveLinea(linea())).not.toBe(claveLinea(linea({ etapa: 'Otra' })))
})

test('tieneDetalle es falso solo cuando faltan los dos snapshots', () => {
  expect(tieneDetalle(asiento({ before: null, after: null }))).toBe(false)
  expect(tieneDetalle(asiento({ before: null, after: [] }))).toBe(true)
  expect(tieneDetalle(asiento({ before: [], after: null }))).toBe(true)
})

test('totalDe suma las horas del snapshot y respeta el null', () => {
  expect(totalDe([linea({ hours: 2 }), linea({ hours: 3.5, project: 'Otro' })])).toBe(5.5)
  expect(totalDe(null)).toBeNull()
})

// --- Opciones y resumen ---------------------------------------------------

test('opcionesDe deduplica y ordena alfabeticamente', () => {
  const entries = [
    asiento({ id: 'a', actorId: 'u2', actorName: 'Zoe', subjectName: 'Ana López' }),
    asiento({ id: 'b', actorId: 'u1', actorName: 'Ana López', subjectName: 'Ana López' }),
    asiento({ id: 'c', actorId: 'u1', actorName: 'Ana López', subjectName: 'Beto' }),
  ]
  const { actores, sujetos } = opcionesDe(entries)
  expect(actores.map((o) => o.label)).toEqual(['Ana López', 'Zoe'])
  expect(sujetos.map((o) => o.label)).toEqual(['Ana López', 'Beto'])
})

test('resumir cuenta movimientos, ediciones, anulaciones y personas', () => {
  const entries = [
    asiento({ id: 'a', actorId: 'u1', action: 'crear' }),
    asiento({ id: 'b', actorId: 'u1', action: 'editar' }),
    asiento({ id: 'c', actorId: 'u2', action: 'anular' }),
  ]
  expect(resumir(entries)).toEqual({ movimientos: 3, ediciones: 1, anulaciones: 1, personas: 2 })
})
```

- [ ] **Step 3: Correr los tests para verificar que fallan**

Run: `npx playwright test --project=node-horas horas-auditoria-diff`
Expected: FAIL. Playwright no hace type-check, así que el error será de ejecución —`TypeError: diffLineas is not a function` o un error de resolución del módulo `../lib/horas/auditoria-types`—, no un error de tipos.

- [ ] **Step 4: Escribir `lib/horas/auditoria-types.ts`**

```ts
// Tipos y lógica pura de /admin/auditoria: fechas, filtro, agrupación y diff de
// snapshots. SIN imports de servidor, para poder probarlo con el proyecto
// `node-horas` de Playwright (mismo reparto que lib/horas/reportes-types.ts).
import { formatFechaISO, mesCorto } from '@/lib/horas/format'

export type AuditAction = 'crear' | 'editar' | 'anular'

export const AUDIT_ACTIONS: AuditAction[] = ['crear', 'editar', 'anular']

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  crear: 'Creación',
  editar: 'Edición',
  anular: 'Anulación',
}

// Una línea dentro de un snapshot. Los nombres vienen ya resueltos desde el RPC
// (migración 0041): el asiento es autocontenido y no depende de que el área o la
// etapa sigan existiendo.
export interface AuditSnapshotLine {
  project: string
  area: string
  department: string
  etapa: string
  hours: number
  description: string
}

export interface AuditEntry {
  id: string
  action: AuditAction
  actorId: string | null
  actorName: string
  subjectName: string
  entryDate: string | null // día de trabajo afectado (ISO)
  totalHours: number | null
  at: string               // instante del movimiento (ISO con zona)
  before: AuditSnapshotLine[] | null
  after: AuditSnapshotLine[] | null
}

// Sobre qué fecha se acota el rango y se agrupa por Día/Mes: el instante del
// movimiento, o el día de trabajo del registro afectado.
export type AuditDateBase = 'at' | 'entry_date'

export type AuditGroupBy = 'none' | 'actor' | 'subject' | 'action' | 'date' | 'month'

export const AUDIT_GROUP_LABELS: Record<AuditGroupBy, string> = {
  none: 'Ninguno',
  actor: 'Quien edita',
  subject: 'Usuario afectado',
  action: 'Acción',
  date: 'Día',
  month: 'Mes',
}

export const AUDIT_GROUP_ORDER: AuditGroupBy[] = ['none', 'actor', 'subject', 'action', 'date', 'month']

// --- Fechas ---------------------------------------------------------------

// 'en-CA' formatea como 'YYYY-MM-DD', que es justo la clave ISO que queremos.
const DIA_MADRID = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
})

// El día (ISO) al que pertenece un instante según el reloj de Madrid. `at` es un
// timestamptz: quedarse con los 10 primeros caracteres del ISO daría el día en UTC,
// y un movimiento de la 01:00 de Madrid aparecería como del día anterior.
export function diaMadrid(iso: string): string {
  return DIA_MADRID.format(new Date(iso))
}

const PARTES_MADRID = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Madrid', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})

// Offset de Madrid, en minutos, en un instante dado (+120 en verano, +60 en invierno).
function offsetMadrid(d: Date): number {
  const p = Object.fromEntries(
    PARTES_MADRID.formatToParts(d).map((x) => [x.type, x.value]),
  ) as Record<string, string>
  const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return (comoUTC - d.getTime()) / 60000
}

// Instante UTC (ISO) en que empieza en Madrid el día ISO dado. Acota el rango sobre
// `at`: comparar un timestamptz contra 'YYYY-MM-DD' pelado lo tomaría como medianoche
// UTC y en verano se comería las dos primeras horas del día.
export function inicioDiaMadridUTC(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const tentativo = Date.UTC(y, m - 1, d)
  // Dos pasadas: la primera usa el offset del instante tentativo; la segunda lo
  // recalcula sobre el resultado, por si el cruce cae justo en un cambio de hora.
  let ms = tentativo - offsetMadrid(new Date(tentativo)) * 60000
  ms = tentativo - offsetMadrid(new Date(ms)) * 60000
  return new Date(ms).toISOString()
}

// Suma días a una fecha ISO ('2026-08-31', 1 → '2026-09-01').
export function addDiasISO(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10)
}

// El día del asiento según la base elegida.
export function diaDe(entry: AuditEntry, base: AuditDateBase): string {
  return base === 'entry_date' ? (entry.entryDate ?? '') : diaMadrid(entry.at)
}

// --- Filtro ---------------------------------------------------------------

// Identidad del actor: el id cuando lo hay (dos personas pueden llamarse igual) y
// el nombre como respaldo, porque actor_id es nullable (perfil borrado).
export function actorKey(entry: AuditEntry): string {
  return entry.actorId ?? `nombre:${entry.actorName}`
}

export interface AuditFiltros {
  acciones: AuditAction[] // vacío = todas
  actorKey: string        // '' = todos
  subjectKey: string      // '' = todos
}

export function filtrar(entries: AuditEntry[], f: AuditFiltros): AuditEntry[] {
  return entries.filter(
    (e) =>
      (f.acciones.length === 0 || f.acciones.includes(e.action)) &&
      (!f.actorKey || actorKey(e) === f.actorKey) &&
      (!f.subjectKey || e.subjectName === f.subjectKey),
  )
}

// --- Agrupación -----------------------------------------------------------

export interface AuditGroup {
  key: string
  label: string
  entries: AuditEntry[]
  counts: Record<AuditAction, number>
  hours: number // suma de las horas de los registros tocados
}

function claveGrupo(
  e: AuditEntry,
  groupBy: Exclude<AuditGroupBy, 'none'>,
  base: AuditDateBase,
): { key: string; label: string } {
  switch (groupBy) {
    case 'actor':
      return { key: actorKey(e), label: e.actorName || '—' }
    case 'subject':
      // time_log_audit no guarda subject_id: aquí la identidad es el nombre, con el
      // riesgo conocido de fundir homónimos. Anotado en el spec como siguiente paso.
      return { key: e.subjectName || '—', label: e.subjectName || '—' }
    case 'action':
      return { key: e.action, label: AUDIT_ACTION_LABELS[e.action] }
    case 'date': {
      const d = diaDe(e, base)
      return { key: d || '—', label: d ? formatFechaISO(d) : '—' }
    }
    case 'month': {
      const m = diaDe(e, base).slice(0, 7)
      return { key: m || '—', label: m ? mesCorto(m) : '—' }
    }
  }
}

// Agrupa conservando el orden de entrada dentro de cada grupo: la vista pasa los
// asientos ya ordenados cronológicamente, y esa secuencia es lo que se viene a leer.
export function agrupar(entries: AuditEntry[], groupBy: AuditGroupBy, base: AuditDateBase): AuditGroup[] {
  if (groupBy === 'none') return []
  const by = new Map<string, AuditGroup>()
  for (const e of entries) {
    const { key, label } = claveGrupo(e, groupBy, base)
    const g = by.get(key) ?? { key, label, entries: [], counts: { crear: 0, editar: 0, anular: 0 }, hours: 0 }
    g.entries.push(e)
    g.counts[e.action] += 1
    g.hours += e.totalHours ?? 0
    by.set(key, g)
  }
  const grupos = [...by.values()].map((g) => ({ ...g, hours: Math.round(g.hours * 100) / 100 }))
  // Día y Mes van en orden cronológico descendente (la clave es ISO y ordena sola);
  // el resto, por volumen de movimientos.
  return groupBy === 'date' || groupBy === 'month'
    ? grupos.sort((a, b) => b.key.localeCompare(a.key))
    : grupos.sort((a, b) => b.entries.length - a.entries.length || a.label.localeCompare(b.label))
}

// --- Diff -----------------------------------------------------------------

export type DiffMark = '~' | '+' | '-' | '='

export interface DiffLine {
  mark: DiffMark
  line: AuditSnapshotLine    // la versión vigente: la de "después", salvo en '-'
  hoursBefore: number | null // null en '+'
  hoursAfter: number | null  // null en '-'
}

// Identidad de una línea dentro del snapshot. La descripción entra en la clave a
// propósito: en una auditoría, reescribir el motivo es un cambio que debe verse
// entero (sale como par eliminada + añadida), no como un matiz de la misma línea.
export function claveLinea(l: AuditSnapshotLine): string {
  return [l.project, l.area, l.department, l.etapa, l.description].join('|')
}

const PRIORIDAD: Record<DiffMark, number> = { '~': 0, '+': 1, '-': 2, '=': 3 }

// Compara los dos snapshots. Orden: primero lo que cambió, luego lo añadido, lo
// eliminado y por último lo intacto; dentro de cada bloque, por clave, para que dos
// lecturas del mismo asiento salgan siempre iguales.
export function diffLineas(
  before: AuditSnapshotLine[] | null,
  after: AuditSnapshotLine[] | null,
): DiffLine[] {
  const antes = new Map((before ?? []).map((l) => [claveLinea(l), l]))
  const despues = new Map((after ?? []).map((l) => [claveLinea(l), l]))
  const filas: DiffLine[] = []
  for (const [k, l] of despues) {
    const prev = antes.get(k)
    if (!prev) filas.push({ mark: '+', line: l, hoursBefore: null, hoursAfter: l.hours })
    else if (prev.hours !== l.hours) filas.push({ mark: '~', line: l, hoursBefore: prev.hours, hoursAfter: l.hours })
    else filas.push({ mark: '=', line: l, hoursBefore: prev.hours, hoursAfter: l.hours })
  }
  for (const [k, l] of antes) {
    if (!despues.has(k)) filas.push({ mark: '-', line: l, hoursBefore: l.hours, hoursAfter: null })
  }
  return filas.sort(
    (a, b) => PRIORIDAD[a.mark] - PRIORIDAD[b.mark] || claveLinea(a.line).localeCompare(claveLinea(b.line)),
  )
}

// Un asiento anterior a la migración 0041 no guardó snapshots: no hay diff que pintar
// y la pantalla debe decirlo, en vez de mostrar un desglose vacío que se leería como
// "no cambió nada". Un 'crear' nuevo siempre trae `after` y un 'anular' nuevo siempre
// trae `before`, así que la regla no da falsos positivos.
export function tieneDetalle(entry: AuditEntry): boolean {
  return entry.before !== null || entry.after !== null
}

export function totalDe(lines: AuditSnapshotLine[] | null): number | null {
  if (lines === null) return null
  return Math.round(lines.reduce((s, l) => s + l.hours, 0) * 100) / 100
}

// --- Opciones y resumen ---------------------------------------------------

export interface AuditOpcion { key: string; label: string }

// Opciones de los desplegables, derivadas de los asientos del rango: no tiene
// sentido ofrecer a alguien que no aparece en lo que se está mirando.
export function opcionesDe(entries: AuditEntry[]): { actores: AuditOpcion[]; sujetos: AuditOpcion[] } {
  const actores = new Map<string, string>()
  const sujetos = new Map<string, string>()
  for (const e of entries) {
    actores.set(actorKey(e), e.actorName || '—')
    sujetos.set(e.subjectName || '—', e.subjectName || '—')
  }
  const aOpciones = (m: Map<string, string>): AuditOpcion[] =>
    [...m.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  return { actores: aOpciones(actores), sujetos: aOpciones(sujetos) }
}

export interface AuditResumen {
  movimientos: number
  ediciones: number
  anulaciones: number
  personas: number
}

export function resumir(entries: AuditEntry[]): AuditResumen {
  const personas = new Set<string>()
  let ediciones = 0
  let anulaciones = 0
  for (const e of entries) {
    personas.add(actorKey(e))
    if (e.action === 'editar') ediciones += 1
    if (e.action === 'anular') anulaciones += 1
  }
  return { movimientos: entries.length, ediciones, anulaciones, personas: personas.size }
}
```

- [ ] **Step 5: Correr los tests para verificar que pasan**

Run: `npx playwright test --project=node-horas horas-auditoria-diff`
Expected: PASS, los 29 tests del fichero.

Si fallan los de zona horaria, comprueba que la máquina tiene datos de ICU completos (`node -e "console.log(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid'}).format(new Date()))"` debe imprimir una fecha, no lanzar `RangeError`).

- [ ] **Step 6: Verificar el gate del repo**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add lib/horas/auditoria-types.ts e2e/horas-auditoria-diff.spec.ts playwright.config.ts
git commit -m "feat(auditoria): logica pura de filtro, agrupacion y diff"
```

---

### Task 3: Servidor — consulta con rango y página con formulario

**Files:**
- Create: `lib/horas/auditoria.ts`
- Modify: `app/(horas)/admin/auditoria/page.tsx` (reescritura completa)

**Interfaces:**
- Consumes: `AuditEntry`, `AuditDateBase`, `inicioDiaMadridUTC`, `addDiasISO` de Task 2; `createClient` de `@/lib/supabase/server`.
- Produces (lo usa Task 4): `getAuditEntries(from: string, to: string, base: AuditDateBase): Promise<{ entries: AuditEntry[]; truncado: boolean }>` y la constante `AUDIT_MAX_ROWS = 5000`.

Esta task deja la página ya alimentada por el rango, **pero conservando la tabla server-side actual**. La vista interactiva llega en Task 4. Así este trozo es revisable y desplegable por sí solo.

- [ ] **Step 1: Escribir la consulta**

Crea `lib/horas/auditoria.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import type { AuditAction, AuditDateBase, AuditEntry, AuditSnapshotLine } from '@/lib/horas/auditoria-types'
import { addDiasISO, inicioDiaMadridUTC } from '@/lib/horas/auditoria-types'

// Tope duro de filas por carga. A ~660 asientos al mes son unos 7 meses de holgura;
// pasado eso la pantalla lo dice y pide acotar, en vez de truncar en silencio como
// hacía el limit(200) anterior.
export const AUDIT_MAX_ROWS = 5000

// PostgREST devuelve como mucho 1.000 filas por petición: hay que paginar.
const PAGE_SIZE = 1000

interface RawAudit {
  id: string
  action: AuditAction
  actor_id: string | null
  actor_name: string | null
  subject_name: string | null
  entry_date: string | null
  total_hours: number | string | null
  at: string
  lines_before: AuditSnapshotLine[] | null
  lines_after: AuditSnapshotLine[] | null
}

const COLS = 'id, action, actor_id, actor_name, subject_name, entry_date, total_hours, at, lines_before, lines_after'

// Asientos de auditoría del rango, del más reciente al más antiguo.
//
// `base` decide sobre qué columna se acota:
//   - 'at' (por defecto): instante del movimiento. Es un timestamptz, así que los
//     límites se calculan como el inicio del día EN MADRID, no en UTC (ver
//     inicioDiaMadridUTC): si no, en verano se perderían las dos primeras horas.
//     El límite superior es exclusivo sobre el día siguiente, para que `to` entre
//     entero.
//   - 'entry_date': día de trabajo del registro afectado. Es un date pelado y la
//     comparación es directa, sin zonas horarias de por medio.
export async function getAuditEntries(
  from: string,
  to: string,
  base: AuditDateBase,
): Promise<{ entries: AuditEntry[]; truncado: boolean }> {
  const supabase = await createClient()

  // Ojo al orden de las llamadas: en supabase-js, `.order()` devuelve un
  // TransformBuilder que ya NO tiene `.gte()`. Los filtros van primero, el orden
  // después; al revés no compila.
  const pagina = (desde: number, hasta: number) => {
    const q = supabase.from('time_log_audit').select(COLS)
    const acotada =
      base === 'entry_date'
        ? q.gte('entry_date', from).lte('entry_date', to)
        : q.gte('at', inicioDiaMadridUTC(from)).lt('at', inicioDiaMadridUTC(addDiasISO(to, 1)))
    return acotada.order('at', { ascending: false }).range(desde, hasta)
  }

  // Se pide una fila de más que el tope: si aparece, es que el rango no cabe.
  const raw: RawAudit[] = []
  for (let desde = 0; desde <= AUDIT_MAX_ROWS; desde += PAGE_SIZE) {
    const { data } = await pagina(desde, Math.min(desde + PAGE_SIZE - 1, AUDIT_MAX_ROWS))
    const chunk = (data ?? []) as unknown as RawAudit[]
    raw.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
  }

  const truncado = raw.length > AUDIT_MAX_ROWS
  const entries: AuditEntry[] = raw.slice(0, AUDIT_MAX_ROWS).map((r) => ({
    id: r.id,
    action: r.action,
    actorId: r.actor_id,
    actorName: r.actor_name ?? '—',
    subjectName: r.subject_name ?? '—',
    entryDate: r.entry_date,
    totalHours: r.total_hours == null ? null : Number(r.total_hours),
    at: r.at,
    before: r.lines_before,
    after: r.lines_after,
  }))

  return { entries, truncado }
}
```

- [ ] **Step 2: Reescribir la página con el formulario de rango**

Sustituye **todo** `app/(horas)/admin/auditoria/page.tsx` por:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatHoras } from '@/lib/horas/format'
import { getAuditEntries, AUDIT_MAX_ROWS } from '@/lib/horas/auditoria'
import type { AuditDateBase } from '@/lib/horas/auditoria-types'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import NativeSelect from '@/components/ui/native-select'

const pad = (n: number) => String(n).padStart(2, '0')
const localISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const ACTION_STYLE = {
  crear: 'bg-emerald-50 text-emerald-700',
  editar: 'bg-amber-50 text-amber-700',
  anular: 'bg-rose-50 text-rose-700',
} as const

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; base?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/registrar')

  const hoy = new Date()
  const to = sp.to || localISO(hoy)
  // Por defecto, los últimos 30 días: la ventana que se mira de verdad.
  const from = sp.from || localISO(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 30))
  const base: AuditDateBase = sp.base === 'entry_date' ? 'entry_date' : 'at'

  const { entries, truncado } = await getAuditEntries(from, to, base)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl">Auditoría</h1>
          <p className="text-sm text-muted-foreground">Toda creación, edición o anulación de registros queda trazada.</p>
        </div>
        <form className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Fechas por</span>
            <NativeSelect name="base" defaultValue={base} aria-label="Base de fecha" className="bg-card">
              <option value="at">Cuándo se hizo</option>
              <option value="entry_date">Fecha del registro</option>
            </NativeSelect>
          </label>
          <label className="flex flex-1 flex-col gap-1 sm:flex-none">
            <span className="text-xs text-muted-foreground">Desde</span>
            <input type="date" name="from" defaultValue={from} max={to} className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm sm:w-auto" />
          </label>
          <label className="flex flex-1 flex-col gap-1 sm:flex-none">
            <span className="text-xs text-muted-foreground">Hasta</span>
            <input type="date" name="to" defaultValue={to} className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm sm:w-auto" />
          </label>
          <button type="submit" className="h-9 shrink-0 rounded-lg bg-(--wine) px-4 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Aplicar
          </button>
        </form>
      </header>

      {truncado && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Mostrando los {AUDIT_MAX_ROWS.toLocaleString('es-ES')} movimientos más recientes del rango. Acota las fechas para verlo entero.
        </p>
      )}

      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow className="bg-(--muted-surface) hover:bg-(--muted-surface)">
              <TableHead>Cuándo</TableHead>
              <TableHead>Acción</TableHead>
              <TableHead>Registro (fecha)</TableHead>
              <TableHead>De</TableHead>
              <TableHead>Por</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No hay movimientos en este rango.</TableCell></TableRow>
            )}
            {entries.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="py-3 text-foreground/70">
                  {new Date(r.at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                </TableCell>
                <TableCell className="py-3">
                  <Badge className={`capitalize ${ACTION_STYLE[r.action]}`}>{r.action}</Badge>
                </TableCell>
                <TableCell className="py-3 text-foreground/70">{r.entryDate ?? '—'}</TableCell>
                <TableCell className="py-3 text-foreground/70">{r.subjectName}</TableCell>
                <TableCell className="py-3 text-foreground/70">{r.actorName}</TableCell>
                <TableCell className="py-3 text-right tabular-money">{r.totalHours != null ? formatHoras(r.totalHours) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verificar el gate del repo**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run build`
Expected: build correcto.

- [ ] **Step 4: Comprobar que la pantalla sigue verde**

Run: `npx playwright test --project=chromium-horas-admin horas-auditoria`
Expected: PASS (el test actual solo comprueba el encabezado y la columna "Acción", que siguen ahí).

- [ ] **Step 5: Comprobar el rango a mano**

Con el dev server del usuario levantado, abre `http://localhost:3000/admin/auditoria` y verifica:

1. Por defecto se ven movimientos de los últimos 30 días, **más de 200** (con los datos actuales el último mes tiene ~660).
2. `?from=2026-07-01&to=2026-07-31` acota a julio.
3. `?base=entry_date&from=2026-07-01&to=2026-07-31` cambia el conjunto: ahora salen movimientos hechos en agosto que tocaron registros de julio.

Si la 1 sigue mostrando exactamente 200 filas, el `limit(200)` viejo sobrevivió en algún sitio.

- [ ] **Step 6: Commit**

```bash
git add lib/horas/auditoria.ts "app/(horas)/admin/auditoria/page.tsx"
git commit -m "feat(auditoria): rango de fechas en servidor y fuera el tope de 200"
```

---

### Task 4: Vista cliente — resumen, filtros, agrupación plegable y descarga

**Files:**
- Create: `components/horas/AuditoriaView.tsx`
- Modify: `app/(horas)/admin/auditoria/page.tsx` (la tabla pasa al componente)
- Modify: `e2e/horas-auditoria.spec.ts`

**Interfaces:**
- Consumes: todo lo exportado por `lib/horas/auditoria-types.ts` (Task 2) y `getAuditEntries` (Task 3).
- Produces (lo usa Task 5): el componente `AuditoriaView`, con la función interna `Fila` que Task 5 convierte en desplegable.

- [ ] **Step 1: Escribir el componente**

Crea `components/horas/AuditoriaView.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { ChevronRight, Download, Filter, X } from 'lucide-react'
import type { AuditAction, AuditDateBase, AuditEntry, AuditGroup, AuditGroupBy } from '@/lib/horas/auditoria-types'
import {
  AUDIT_ACTIONS, AUDIT_ACTION_LABELS, AUDIT_GROUP_LABELS, AUDIT_GROUP_ORDER,
  agrupar, filtrar, opcionesDe, resumir,
} from '@/lib/horas/auditoria-types'
import { downloadXlsx, downloadCsv, type ExportRow } from '@/lib/export'
import { formatHoras, formatFechaISO } from '@/lib/horas/format'
import NativeSelect from '@/components/ui/native-select'
import { cn } from '@/lib/utils'

const selectClass =
  'h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring'

// Rejilla compartida por la cabecera de columnas y cada fila, para que no se
// desalineen al plegar y desplegar grupos.
const ROW_GRID = 'grid w-full grid-cols-[1.25rem_8.5rem_6rem_6.5rem_1fr_1fr_4.5rem] items-center gap-3'

const ACTION_STYLE: Record<AuditAction, string> = {
  crear: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  editar: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  anular: 'bg-rose-50 text-rose-700 ring-rose-600/20',
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'brand' | 'wine' | 'muted' }) {
  return (
    <div className="relative">
      <div
        className={cn(
          'absolute left-0 top-1 h-9 w-1 rounded-full',
          accent === 'brand' && 'bg-(--brand)',
          accent === 'wine' && 'bg-(--wine)',
          accent === 'muted' && 'bg-foreground/15',
        )}
      />
      <div className="pl-4">
        <p className="text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="tabular-money mt-1 font-display text-2xl font-semibold tracking-tight">{value}</p>
      </div>
    </div>
  )
}

function AccionBadge({ action }: { action: AuditAction }) {
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', ACTION_STYLE[action])}>
      {AUDIT_ACTION_LABELS[action]}
    </span>
  )
}

const cuando = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })

export default function AuditoriaView({
  entries,
  base,
  from,
  to,
}: {
  entries: AuditEntry[]
  base: AuditDateBase
  from: string
  to: string
}) {
  const [acciones, setAcciones] = useState<AuditAction[]>([])
  const [fActor, setFActor] = useState('')
  const [fSubject, setFSubject] = useState('')
  const [groupBy, setGroupBy] = useState<AuditGroupBy>('none')
  // Grupos desplegados. Al agrupar se empieza con todos plegados: con 18 actores,
  // abrirlos todos de golpe es la misma pared de filas que había antes.
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())

  const opciones = useMemo(() => opcionesDe(entries), [entries])
  const filtradas = useMemo(
    () => filtrar(entries, { acciones, actorKey: fActor, subjectKey: fSubject }),
    [entries, acciones, fActor, fSubject],
  )
  const resumen = useMemo(() => resumir(filtradas), [filtradas])
  const grupos = useMemo(() => agrupar(filtradas, groupBy, base), [filtradas, groupBy, base])

  const hayFiltros = acciones.length > 0 || fActor !== '' || fSubject !== ''
  const todoAbierto = grupos.length > 0 && abiertos.size === grupos.length

  function toggleAccion(a: AuditAction) {
    setAcciones((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]))
  }
  function toggleGrupo(key: string) {
    setAbiertos((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  function limpiar() {
    setAcciones([])
    setFActor('')
    setFSubject('')
  }
  function cambiarAgrupacion(g: AuditGroupBy) {
    setGroupBy(g)
    setAbiertos(new Set())
  }

  function buildExport(): ExportRow[] {
    return filtradas.map((e) => ({
      Cuándo: cuando(e.at),
      Acción: AUDIT_ACTION_LABELS[e.action],
      'Fecha del registro': e.entryDate ?? '',
      'Usuario afectado': e.subjectName,
      'Quien edita': e.actorName,
      Total: e.totalHours ?? '',
    }))
  }
  const exportBase = `auditoria_${from}_${to}`

  return (
    <div className="animate-fade-up space-y-6">
      {/* Resumen */}
      <div className="grid gap-5 rounded-2xl border border-border bg-card px-6 py-5 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Movimientos" value={String(resumen.movimientos)} accent="brand" />
        <Stat label="Ediciones" value={String(resumen.ediciones)} accent="wine" />
        <Stat label="Anulaciones" value={String(resumen.anulaciones)} accent="muted" />
        <Stat label="Personas que editaron" value={String(resumen.personas)} accent="muted" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Filter className="size-4" /> Filtrar
        </span>
        <div className="flex gap-1.5">
          {AUDIT_ACTIONS.map((a) => {
            const activo = acciones.includes(a)
            return (
              <button
                key={a}
                type="button"
                aria-pressed={activo}
                onClick={() => toggleAccion(a)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors',
                  activo ? ACTION_STYLE[a] : 'text-muted-foreground ring-border hover:text-foreground',
                )}
              >
                {AUDIT_ACTION_LABELS[a]}
              </button>
            )
          })}
        </div>
        <NativeSelect aria-label="Filtrar por quien edita" value={fActor} onChange={(e) => setFActor(e.target.value)} className={selectClass}>
          <option value="">Cualquiera edita</option>
          {opciones.actores.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Filtrar por usuario afectado" value={fSubject} onChange={(e) => setFSubject(e.target.value)} className={selectClass}>
          <option value="">Cualquier usuario afectado</option>
          {opciones.sujetos.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </NativeSelect>
        {hayFiltros && (
          <button onClick={limpiar} className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <X className="size-3.5" /> Limpiar
          </button>
        )}
      </div>

      {/* Agrupar por + descarga */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <span className="shrink-0 text-sm text-muted-foreground">Agrupar por</span>
          <div className="flex min-w-0 overflow-x-auto rounded-full border border-border bg-card p-1">
            {AUDIT_GROUP_ORDER.map((g) => (
              <button
                key={g}
                onClick={() => cambiarAgrupacion(g)}
                className={cn(
                  'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                  groupBy === g ? 'bg-(--brand) text-white shadow-sm' : 'text-foreground/55 hover:text-foreground',
                )}
              >
                {AUDIT_GROUP_LABELS[g]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {groupBy !== 'none' && grupos.length > 0 && (
            <button
              onClick={() => setAbiertos(todoAbierto ? new Set() : new Set(grupos.map((g) => g.key)))}
              className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-(--muted-surface) hover:text-foreground"
            >
              {todoAbierto ? 'Plegar todo' : 'Desplegar todo'}
            </button>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span className="text-sm text-muted-foreground">Descargar:</span>
            <button
              onClick={() => void downloadXlsx(`${exportBase}.xlsx`, buildExport(), 'Auditoría')}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-(--muted-surface) hover:text-foreground"
            >
              <Download className="size-3.5" /> Excel
            </button>
            <button
              onClick={() => downloadCsv(`${exportBase}.csv`, buildExport())}
              className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-(--muted-surface) hover:text-foreground"
            >
              CSV
            </button>
          </span>
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <div className="min-w-200">
            <div className={cn(ROW_GRID, 'border-b border-border bg-(--muted-surface) px-5 py-3 text-[0.7rem] uppercase tracking-[0.12em] text-muted-foreground')}>
              <span />
              <span>Cuándo</span>
              <span>Acción</span>
              <span>Registro</span>
              <span>De</span>
              <span>Por</span>
              <span className="text-right">Total</span>
            </div>

            {filtradas.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-muted-foreground">
                No hay movimientos con estos filtros en el rango seleccionado.
              </p>
            ) : groupBy === 'none' ? (
              <ul>
                {filtradas.map((e) => (
                  <li key={e.id} className="border-b border-border/60 last:border-0">
                    <Fila entry={e} />
                  </li>
                ))}
              </ul>
            ) : (
              <ul>
                {grupos.map((g) => (
                  <li key={g.key} className="border-b border-border/60 last:border-0">
                    <CabeceraGrupo grupo={g} abierto={abiertos.has(g.key)} onToggle={() => toggleGrupo(g.key)} />
                    {abiertos.has(g.key) && (
                      <ul className="bg-(--muted-surface)/30">
                        {g.entries.map((e) => (
                          <li key={e.id} className="border-t border-border/40">
                            <Fila entry={e} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CabeceraGrupo({ grupo, abierto, onToggle }: { grupo: AuditGroup; abierto: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={abierto}
      className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-(--muted-surface)/60 focus:outline-none focus-visible:bg-(--muted-surface)/60"
    >
      <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', abierto && 'rotate-90')} aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{grupo.label}</span>
      <span className="shrink-0 text-sm text-muted-foreground">
        {grupo.entries.length} {grupo.entries.length === 1 ? 'movimiento' : 'movimientos'}
      </span>
      <span className="hidden shrink-0 gap-1.5 sm:flex">
        {AUDIT_ACTIONS.filter((a) => grupo.counts[a] > 0).map((a) => (
          <span key={a} className={cn('rounded-full px-2 py-0.5 text-xs ring-1 ring-inset', ACTION_STYLE[a])}>
            {grupo.counts[a]} {AUDIT_ACTION_LABELS[a].toLowerCase()}
          </span>
        ))}
      </span>
      <span className="w-20 shrink-0 text-right tabular-money text-sm font-medium">{formatHoras(grupo.hours)}</span>
    </button>
  )
}

function Fila({ entry }: { entry: AuditEntry }) {
  return (
    <div className={cn(ROW_GRID, 'px-5 py-3 text-sm')}>
      <span />
      <span className="tabular-money text-foreground/70">{cuando(entry.at)}</span>
      <span><AccionBadge action={entry.action} /></span>
      <span className="tabular-money text-foreground/70">{entry.entryDate ? formatFechaISO(entry.entryDate) : '—'}</span>
      <span className="truncate text-foreground/70" title={entry.subjectName}>{entry.subjectName}</span>
      <span className="truncate text-foreground/70" title={entry.actorName}>{entry.actorName}</span>
      <span className="text-right tabular-money">{entry.totalHours != null ? formatHoras(entry.totalHours) : '—'}</span>
    </div>
  )
}
```

- [ ] **Step 2: Conectar la vista a la página**

En `app/(horas)/admin/auditoria/page.tsx`:

Quita los imports que ya no se usan y añade el de la vista. Los imports quedan así:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuditEntries, AUDIT_MAX_ROWS } from '@/lib/horas/auditoria'
import type { AuditDateBase } from '@/lib/horas/auditoria-types'
import NativeSelect from '@/components/ui/native-select'
import AuditoriaView from '@/components/horas/AuditoriaView'
```

Borra también la constante `ACTION_STYLE` y todo el bloque `<div className="overflow-hidden rounded-xl ring-1 ring-foreground/10"> … </Table></div>`, y pon en su lugar:

```tsx
      <AuditoriaView entries={entries} base={base} from={from} to={to} />
```

El `<header>` con el formulario y el aviso de `truncado` se quedan tal cual.

- [ ] **Step 3: Verificar el gate del repo**

Run: `npx tsc --noEmit`
Expected: sin errores. Si sale "declarado pero nunca usado" para `formatHoras`, `Table`, `Badge` o `TableCell`, es que quedó algún import huérfano del paso 2: quítalo.

Run: `npm run build`
Expected: build correcto.

- [ ] **Step 4: Ampliar el E2E**

Sustituye `e2e/horas-auditoria.spec.ts` por:

```ts
import { test, expect } from '@playwright/test'

test('el admin ve la pantalla de auditoría', async ({ page }) => {
  await page.goto('/admin/auditoria')
  await expect(page.getByRole('heading', { name: 'Auditoría' })).toBeVisible()
  await expect(page.getByText('Movimientos', { exact: true })).toBeVisible()
})

test('el filtro de acción acota los movimientos', async ({ page }) => {
  await page.goto('/admin/auditoria')
  const chip = page.getByRole('button', { name: 'Anulación' })
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  // Con solo anulaciones marcadas, no debe quedar ninguna insignia de creación.
  await expect(page.getByText('Creación', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Limpiar' }).click()
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
})

test('agrupar por quien edita mete las filas bajo cabeceras plegables', async ({ page }) => {
  await page.goto('/admin/auditoria')
  await page.getByRole('button', { name: 'Quien edita' }).click()

  // Los grupos arrancan plegados: hay cabeceras, y ninguna desplegada.
  const cabeceras = page.getByRole('button', { expanded: false })
  await expect(cabeceras.first()).toBeVisible()

  await page.getByRole('button', { name: 'Desplegar todo' }).click()
  await expect(page.getByRole('button', { name: 'Plegar todo' })).toBeVisible()
  await expect(page.getByRole('button', { expanded: true }).first()).toBeVisible()
})

test('el rango de fechas viaja en la URL', async ({ page }) => {
  await page.goto('/admin/auditoria?from=2026-07-01&to=2026-07-31')
  await expect(page.locator('input[name="from"]')).toHaveValue('2026-07-01')
  await expect(page.locator('input[name="to"]')).toHaveValue('2026-07-31')
})
```

- [ ] **Step 5: Correr el E2E**

Run: `npx playwright test --project=chromium-horas-admin horas-auditoria.spec.ts`
Expected: PASS, los 4 tests.

Si el test de anulaciones falla porque no hay ninguna en los últimos 30 días, no lo silencies: cambia ese test para navegar a un rango que sí las tenga (`/admin/auditoria?from=2026-07-01&to=2026-08-05`) — en producción hay 6 anulaciones desde el 2026-07-06.

- [ ] **Step 6: Commit**

```bash
git add components/horas/AuditoriaView.tsx "app/(horas)/admin/auditoria/page.tsx" e2e/horas-auditoria.spec.ts
git commit -m "feat(auditoria): resumen, filtros, agrupacion plegable y descarga"
```

---

### Task 5: Detalle del cambio desplegable

**Files:**
- Modify: `components/horas/AuditoriaView.tsx`
- Modify: `e2e/horas-auditoria.spec.ts`

**Interfaces:**
- Consumes: `diffLineas`, `tieneDetalle`, `totalDe`, `DiffLine`, `DiffMark` de Task 2; el componente `Fila` de Task 4.

- [ ] **Step 1: Añadir los imports que faltan**

En `components/horas/AuditoriaView.tsx`, amplía los dos imports de arriba:

```tsx
import type { AuditAction, AuditDateBase, AuditEntry, AuditGroup, AuditGroupBy, DiffLine, DiffMark } from '@/lib/horas/auditoria-types'
import {
  AUDIT_ACTIONS, AUDIT_ACTION_LABELS, AUDIT_GROUP_LABELS, AUDIT_GROUP_ORDER,
  agrupar, diffLineas, filtrar, opcionesDe, resumir, tieneDetalle, totalDe,
} from '@/lib/horas/auditoria-types'
```

- [ ] **Step 2: Convertir `Fila` en desplegable**

Sustituye la función `Fila` del final del archivo por esto:

```tsx
const MARK_STYLE: Record<DiffMark, string> = {
  '+': 'text-emerald-700',
  '-': 'text-rose-700',
  '~': 'text-amber-700',
  '=': 'text-muted-foreground',
}

function Fila({ entry }: { entry: AuditEntry }) {
  const [abierto, setAbierto] = useState(false)
  const hayDetalle = tieneDetalle(entry)

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className={cn(
          ROW_GRID,
          'px-5 py-3 text-left text-sm transition-colors hover:bg-(--muted-surface)/60 focus:outline-none focus-visible:bg-(--muted-surface)/60',
        )}
      >
        <ChevronRight className={cn('size-3.5 text-muted-foreground transition-transform', abierto && 'rotate-90')} aria-hidden />
        <span className="tabular-money text-foreground/70">{cuando(entry.at)}</span>
        <span><AccionBadge action={entry.action} /></span>
        <span className="tabular-money text-foreground/70">{entry.entryDate ? formatFechaISO(entry.entryDate) : '—'}</span>
        <span className="truncate text-foreground/70" title={entry.subjectName}>{entry.subjectName}</span>
        <span className="truncate text-foreground/70" title={entry.actorName}>{entry.actorName}</span>
        <span className="text-right tabular-money">{entry.totalHours != null ? formatHoras(entry.totalHours) : '—'}</span>
      </button>
      {abierto && (hayDetalle ? <Detalle entry={entry} /> : <SinDetalle />)}
    </>
  )
}

// Los asientos anteriores a la migración 0041 no guardaron snapshots y las líneas
// viejas ya no existen: no hay nada que reconstruir. Se dice, en vez de pintar un
// desglose vacío que se leería como "no cambió nada".
function SinDetalle() {
  return (
    <p className="border-t border-border/40 bg-(--muted-surface)/40 px-5 py-4 pl-13 text-xs text-muted-foreground">
      Sin detalle: anterior a la trazabilidad de cambios.
    </p>
  )
}

function Detalle({ entry }: { entry: AuditEntry }) {
  const filas = diffLineas(entry.before, entry.after)
  const antes = totalDe(entry.before)
  const despues = totalDe(entry.after)

  return (
    <div className="border-t border-border/40 bg-(--muted-surface)/40 px-5 py-3 pl-13">
      <p className="mb-2 text-xs text-muted-foreground">
        {antes != null && despues != null ? (
          <>Total <span className="tabular-money font-medium text-foreground/80">{formatHoras(antes)}</span> → <span className="tabular-money font-medium text-foreground/80">{formatHoras(despues)}</span></>
        ) : despues != null ? (
          <>Registro creado con <span className="tabular-money font-medium text-foreground/80">{formatHoras(despues)}</span></>
        ) : (
          <>Registro anulado con <span className="tabular-money font-medium text-foreground/80">{formatHoras(antes ?? 0)}</span></>
        )}
      </p>
      {filas.length === 0 ? (
        <p className="text-xs text-muted-foreground">El registro no tenía líneas.</p>
      ) : (
        <ul className="space-y-1">
          {filas.map((f, i) => <LineaDiff key={`${f.mark}-${i}`} fila={f} />)}
        </ul>
      )}
    </div>
  )
}

function LineaDiff({ fila }: { fila: DiffLine }) {
  const { mark, line, hoursBefore, hoursAfter } = fila
  const detalle = [line.etapa, line.description].filter((p) => p && p !== '—').join(' · ')
  return (
    <li className="grid grid-cols-[1rem_1fr_9rem] items-baseline gap-3 text-xs">
      {/* La marca distingue por forma además de por color: quien no separe verde de
          rojo sigue leyendo el signo. */}
      <span className={cn('font-mono font-semibold', MARK_STYLE[mark])} aria-hidden>{mark}</span>
      <span className="min-w-0">
        <span className={cn('font-medium', mark === '=' ? 'text-muted-foreground' : 'text-foreground/85')}>{line.project}</span>
        {detalle && <span className="text-muted-foreground"> · {detalle}</span>}
      </span>
      <span className={cn('text-right tabular-money', MARK_STYLE[mark])}>
        {mark === '~' ? `${formatHoras(hoursBefore ?? 0)} → ${formatHoras(hoursAfter ?? 0)}` : formatHoras(hoursAfter ?? hoursBefore ?? 0)}
      </span>
    </li>
  )
}
```

Nota: `Fila` ya no ocupa la primera celda con un `<span />` vacío — ahora va el chevron, que es la afordancia de que la fila se abre.

- [ ] **Step 3: Verificar el gate del repo**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run build`
Expected: build correcto.

- [ ] **Step 4: Añadir el E2E del diff**

Añade al final de `e2e/horas-auditoria.spec.ts`:

```ts
test('desplegar un movimiento muestra su detalle', async ({ page }) => {
  await page.goto('/admin/auditoria')
  // La primera fila es el movimiento más reciente: posterior a la migración 0041,
  // así que tiene snapshot y debe mostrar el total en vez del aviso de "sin detalle".
  const fila = page.locator('li > button[aria-expanded="false"]').first()
  await fila.click()
  await expect(page.getByText(/Total .* →|Registro creado con|Registro anulado con/).first()).toBeVisible()
})

test('un movimiento anterior a la trazabilidad lo dice', async ({ page }) => {
  // Julio 2026 es anterior a la migración 0041: ninguno de esos asientos tiene snapshot.
  await page.goto('/admin/auditoria?from=2026-07-06&to=2026-07-10')
  const fila = page.locator('li > button[aria-expanded="false"]').first()
  await fila.click()
  await expect(page.getByText('Sin detalle: anterior a la trazabilidad de cambios').first()).toBeVisible()
})
```

- [ ] **Step 5: Correr el E2E completo**

Run: `npx playwright test --project=chromium-horas-admin horas-auditoria.spec.ts`
Expected: PASS, los 6 tests.

El segundo test depende de que en el rango 06–10 de julio de 2026 haya asientos y de que ninguno tenga snapshot. Si en el futuro esos datos se purgan, el test hay que reapuntarlo a otro rango previo a la migración, no borrarlo.

- [ ] **Step 6: Correr toda la suite de auditoría**

Run: `npx playwright test horas-auditoria`
Expected: PASS — los 29 de `node-horas` (`horas-auditoria-diff`) y los 6 de `chromium-horas-admin` (`horas-auditoria`).

- [ ] **Step 7: Commit**

```bash
git add components/horas/AuditoriaView.tsx e2e/horas-auditoria.spec.ts
git commit -m "feat(auditoria): desplegar cada movimiento para ver que cambio"
```

---

## Comprobación final a mano

Con el dev server del usuario levantado, en `/admin/auditoria`:

- [ ] El rango por defecto trae más de 200 movimientos (antes el tope los cortaba).
- [ ] Cambiar "Fechas por" a *Fecha del registro* y aplicar cambia el conjunto de movimientos.
- [ ] Marcar el chip *Edición* deja solo ediciones, y el resumen de arriba baja en consecuencia.
- [ ] Agrupar por *Quien edita* mete todo bajo cabeceras plegadas con su recuento; "Desplegar todo" las abre.
- [ ] Desplegar un movimiento **nuevo** (creado hoy, editando un registro cualquiera desde `/registrar`) muestra el diff con sus marcas `+ − ~`.
- [ ] Desplegar un movimiento de julio muestra el aviso de "sin detalle".
- [ ] La descarga a Excel respeta los filtros puestos.
