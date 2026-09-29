-- ============================================================
-- 0054 AUSENCIAS POR PULSOS: el formato real del flujo de Julián
-- ------------------------------------------------------------
-- La 0052 guardaba una fila de Airtable por envío (id, desde, hasta, estado), pero el flujo
-- de Julián manda otra cosa: una lista de personas, cada una con su slack_id y una acción,
-- `activar` el día que empieza la ausencia (vacaciones, festivo, ausencia…) y `desactivar`
-- el día que termina. Las fechas de `eventos` son un extra. Ver lib/avisos/vacaciones.ts.
--
-- `vacaciones` se rehace (estaba vacía: el primer formato no llegó a guardar nada). Cada
-- fila es una ausencia: desde el día del `activar` hasta el del `desactivar`, los dos
-- incluidos; `hasta` null = sigue fuera. La persona se busca al leer, por slack_id, para que
-- cuente sola el día que se le dé de alta.
-- ============================================================

drop table if exists public.vacaciones;

create table public.vacaciones (
  id          bigint generated always as identity primary key,
  slack_id    text not null check (slack_id ~ '^[UW][A-Z0-9]{8,}$'),
  desde       date not null,                        -- día del activar (Madrid)
  hasta       date,                                 -- día del desactivar; null = sigue fuera
  eventos     jsonb not null default '[]'::jsonb,   -- las fechas que mandó el flujo, de referencia
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint vacaciones_orden check (hasta is null or hasta >= desde)
);

comment on table public.vacaciones is
  'Ausencias (vacaciones, festivos…) que manda el flujo de Julián por pulsos: desde el día del activar hasta el del desactivar, incluidos; hasta null = sigue fuera. La persona se resuelve al leer por slack_id.';

-- Una sola ausencia abierta por persona: dos `activar` a la vez no pueden abrir dos.
create unique index vacaciones_una_abierta on public.vacaciones (slack_id) where hasta is null;

-- RLS: escribe solo el servidor (service role); lee el admin.
alter table public.vacaciones enable row level security;
create policy vacaciones_admin_select on public.vacaciones
  for select to authenticated using ((select public.is_admin()));

-- Recibidos: una línea con lo que pasó en cada envío aceptado (por persona). Las columnas
-- airtable_id, persona_id y persona_nombre eran del primer formato y ya no se escriben; se
-- dejan para no romper el código desplegado mientras se sube el nuevo, y se quitarán
-- después.
alter table public.avisos_entrantes add column if not exists resumen text;
