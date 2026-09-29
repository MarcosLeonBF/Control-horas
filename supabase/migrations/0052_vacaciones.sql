-- ============================================================
-- 0052 VACACIONES: las que manda Airtable (flujo de Julián)
-- ------------------------------------------------------------
-- Las vacaciones se gestionan en Airtable. Julián las manda a
-- POST /api/avisos/v1/vacaciones, una fila de Airtable por envío, y aquí se guardan por
-- su id de Airtable: si la misma fila vuelve a llegar (cambio de fechas, cancelación),
-- se actualiza. Sirven para no mandar recordatorios de "días sin registrar" a quien está
-- de vacaciones y para marcarlo en los avisos y en el panel de usuarios.
--
-- La persona se busca al LEER (por slack_id y, si no, por email), no se guarda un
-- profile_id: de la lista de Slack, la mayoría no tiene perfil en la plataforma, y sus
-- vacaciones tienen que empezar a contar solas el día que se les dé de alta. Quien lea esta
-- tabla tiene que resolver la persona con resolverPersona (lib/avisos/vacaciones.ts) y
-- tratar un conflicto como "no cuenta": así una fila nunca acaba en otra persona aunque
-- cambien los perfiles.
--
-- Borrar una fila en Airtable no manda nada: para anular unas vacaciones hay que
-- mandarlas con estado 'cancelada'.
-- ============================================================

create table if not exists public.vacaciones (
  airtable_id text primary key,
  -- Los mismos formatos que valida la ruta (lib/avisos/vacaciones.ts); esto es la red.
  slack_id    text check (slack_id is null or slack_id ~ '^[UW][A-Z0-9]{8,}$'),
  email       text check (email is null or email = lower(email)),
  desde       date not null,
  hasta       date not null,
  estado      text not null check (estado in ('aprobada', 'cancelada')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint vacaciones_identifica check (slack_id is not null or email is not null),
  constraint vacaciones_orden      check (hasta >= desde),
  -- Tope de 90 días por periodo, los dos extremos incluidos: una errata tipo 2062 dejaría
  -- a alguien sin recordatorios durante años.
  constraint vacaciones_tope       check (hasta - desde < 90)
);

comment on table public.vacaciones is
  'Vacaciones recibidas desde Airtable (POST /api/avisos/v1/vacaciones), una fila por fila de Airtable. Solo cuentan las de estado aprobada. La persona se resuelve al leer por slack_id y, si no, por email.';

-- Sin índices extra: son decenas de filas al año y se leen enteras o por rango de fechas.

-- RLS: la escribe solo el servidor (service role, desde la ruta). Lectura para admin, por
-- si se consulta desde el panel con la sesión del usuario.
alter table public.vacaciones enable row level security;

drop policy if exists vacaciones_admin_select on public.vacaciones;
create policy vacaciones_admin_select on public.vacaciones
  for select to authenticated using ((select public.is_admin()));
