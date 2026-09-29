-- ============================================================
-- 0053 AVISOS_ENTRANTES: lo que los flujos le mandan a la plataforma
-- ------------------------------------------------------------
-- La entrada de vacaciones (0052) solo guardaba lo aceptado: un envío rechazado (400, 422)
-- no dejaba rastro de nuestro lado y solo lo veía quien lo mandaba en su n8n. El primer
-- envío de Julián fue justo eso. Aquí se anota cada envío que llega con la clave correcta,
-- aceptado o no, con lo que llegó y lo que se contestó, para verlo en
-- Administración → Avisos → Recibidos.
--
-- Los que llegan sin clave (401) NO se anotan: cualquiera podría llenar la tabla.
-- Guarda los mismos datos que `vacaciones` (nombres, emails, fechas); solo la leen admins.
-- ============================================================

create table if not exists public.avisos_entrantes (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  tipo            text not null,                 -- 'vacaciones' por ahora
  status          smallint not null,             -- lo que se contestó: 200, 400, 422, 500
  error           text,                          -- el motivo, si no fue 200
  airtable_id     text,                          -- el id de la fila, si llegó
  persona_id      uuid references public.profiles(id) on delete set null,
  persona_nombre  text,                          -- a quién correspondía al recibirlo
  cuerpo          jsonb,                         -- el JSON recibido (recortado si era enorme)
  cuerpo_texto    text                           -- lo recibido si no era JSON, o el recorte
);

comment on table public.avisos_entrantes is
  'Cada envío de los flujos a la plataforma (POST /api/avisos/v1/vacaciones) que llegó con la clave correcta, aceptado o rechazado: qué llegó y qué se contestó. Se ve en Administración → Avisos → Recibidos.';

-- La pantalla lee los últimos por fecha.
create index if not exists avisos_entrantes_recientes on public.avisos_entrantes (created_at desc);

-- RLS: escribe solo el servidor (service role, desde la ruta); lee el admin.
alter table public.avisos_entrantes enable row level security;

drop policy if exists avisos_entrantes_admin_select on public.avisos_entrantes;
create policy avisos_entrantes_admin_select on public.avisos_entrantes
  for select to authenticated using ((select public.is_admin()));
