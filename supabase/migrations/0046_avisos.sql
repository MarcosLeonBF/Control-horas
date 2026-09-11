-- 0046_avisos.sql
-- Avisos automáticos para los flujos de Zapier/n8n (spec 2026-09-10-avisos-webhooks-design).
-- La plataforma emite avisos firmados a un único webhook y guarda cada envío con sus
-- reintentos. Sustituye a horas_alertas (Fase 4, nunca activada), que queda sin uso.

-- Una sola fila: la URL del webhook de los flujos y qué tipos de aviso están activos.
create table public.avisos_config (
  id             boolean primary key default true check (id),
  url            text,
  tipos_activos  text[] not null default '{}',
  updated_by     uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now()
);
insert into public.avisos_config (id) values (true);

-- Bandeja de salida: cada aviso emitido, con su estado de entrega.
create table public.avisos_salientes (
  id               uuid primary key default gen_random_uuid(), -- = id del sobre
  tipo             text not null,
  datos            jsonb not null,
  clave            text unique,               -- deduplicación opcional (NULL no choca)
  prueba           boolean not null default false,
  estado           text not null default 'pendiente'
                   check (estado in ('pendiente','enviando','enviado','fallido','descartado')),
  motivo_descarte  text,
  intentos         integer not null default 0,
  proximo_intento  timestamptz not null default now(),
  reclamado_at     timestamptz,
  ultimo_codigo    integer,
  ultimo_error     text,
  created_at       timestamptz not null default now(),
  enviado_at       timestamptz
);
create index avisos_salientes_cola on public.avisos_salientes (estado, proximo_intento);
create index avisos_salientes_recientes on public.avisos_salientes (created_at desc);

-- Último nivel conocido de cada banco y de cada HUCHA: sin él no se sabe si "empeoró".
create table public.avisos_estado (
  clave       text primary key,   -- 'banco:<proyecto>:<posicion>' | 'banco:<proyecto>:*' | 'hucha:<project_id>'
  nivel       text not null,
  updated_at  timestamptz not null default now()
);

-- Festivos para "días sin registrar". Se cargan por SQL hasta que haya calendario decidido.
create table public.festivos (
  fecha   date primary key,
  nombre  text not null
);

-- Manager directo de cada persona (la escalera de recordatorios avisa a esta persona).
alter table public.profiles
  add column manager_id uuid references public.profiles(id) on delete set null,
  add constraint profiles_manager_no_propio check (manager_id is null or manager_id <> id);

-- Reserva atómica de la cola: dos despachadores a la vez nunca toman la misma fila.
-- Recupera las que quedaron 'enviando' más de 10 min (una función cortada a medias).
create or replace function public.avisos_reclamar(p_limite integer default 25)
returns setof public.avisos_salientes
language sql set search_path = public as $$
  update public.avisos_salientes s
     set estado = 'enviando', intentos = s.intentos + 1, reclamado_at = now()
   where s.id in (
     select id from public.avisos_salientes
      where (estado = 'pendiente' and proximo_intento <= now())
         or (estado = 'enviando' and reclamado_at < now() - interval '10 minutes')
      order by created_at
      limit p_limite
      for update skip locked)
  returning s.*;
$$;
revoke all on function public.avisos_reclamar(integer) from public, anon, authenticated;
grant execute on function public.avisos_reclamar(integer) to service_role;

-- RLS: lectura solo para admin; las escrituras las hace el servidor con service role,
-- salvo avisos_config (la pantalla) y festivos. (select is_admin()) se evalúa una vez.
alter table public.avisos_config    enable row level security;
alter table public.avisos_salientes enable row level security;
alter table public.avisos_estado    enable row level security;
alter table public.festivos         enable row level security;

create policy avisos_config_admin_select on public.avisos_config
  for select to authenticated using ((select public.is_admin()));
create policy avisos_config_admin_update on public.avisos_config
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy avisos_salientes_admin_select on public.avisos_salientes
  for select to authenticated using ((select public.is_admin()));
create policy avisos_estado_admin_select on public.avisos_estado
  for select to authenticated using ((select public.is_admin()));
create policy festivos_select on public.festivos
  for select to authenticated using (true);
create policy festivos_admin_write on public.festivos
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
