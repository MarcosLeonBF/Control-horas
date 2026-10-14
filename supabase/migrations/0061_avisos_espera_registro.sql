-- 0061 · Los avisos de un registro esperan 5 minutos
-- (spec docs/superpowers/specs/2026-10-14-avisos-espera-registro-design.md).
--
-- Al guardar en /registrar la app ya no arma los avisos: anota aquí una espera con los
-- registros del guardado. Una edición de un registro que todavía espera se suma a su espera
-- y la reinicia. Cada minuto, la tarea avisos-revisar (pg_cron) mira si hay esperas vencidas
-- o reintentos de la bandeja y, solo entonces, llama a la app (pg_net), que arma los avisos
-- con cómo quedaron los registros y despacha la bandeja.
--
-- La clave de la llamada es CRON_SECRET, copiada en Vault con el nombre avisos_cron_secret
-- (se carga desde el panel de Supabase, no va en git). Sin ella la app responde 401 y no se
-- procesa nada hasta cargarla; el cron diario de Vercel sigue de red.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
create extension if not exists pg_net with schema extensions;

create table public.avisos_por_revisar (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade, -- dueño de los registros
  log_ids       uuid[] not null check (cardinality(log_ids) > 0),
  es_alta       boolean not null,        -- solo un alta manda pulso
  vence_at      timestamptz not null,    -- se reinicia con cada edición que se suma
  estado        text not null default 'pendiente'
                check (estado in ('pendiente', 'procesando', 'hecha', 'fallida')),
  intentos      integer not null default 0,
  reclamado_at  timestamptz,
  ultimo_error  text,
  created_at    timestamptz not null default now()
);
-- La tarea de cada minuto y la reserva buscan pendientes vencidas; sumarse busca pendientes.
create index avisos_por_revisar_pendientes on public.avisos_por_revisar (vence_at) where estado = 'pendiente';
create index avisos_por_revisar_user_id on public.avisos_por_revisar (user_id);

-- Anota la espera de un guardado. Si es una edición (p_ancla) de un registro que está en una
-- espera pendiente, se suma a ella (sin repetidos) y la reinicia; si no, crea una nueva. Una
-- espera que ya se está procesando no se toca: la edición crea la suya.
create or replace function public.avisos_esperar_guardado(
  p_user_id uuid, p_log_ids uuid[], p_ancla uuid, p_es_alta boolean, p_espera interval
) returns uuid
language plpgsql set search_path = public as $$
declare
  v_id uuid;
begin
  if p_ancla is not null then
    update public.avisos_por_revisar r
       set log_ids  = array(select distinct x from unnest(r.log_ids || p_log_ids) x),
           vence_at = now() + p_espera
     where r.id = (select id from public.avisos_por_revisar
                    where estado = 'pendiente' and log_ids @> array[p_ancla]
                    order by created_at
                    limit 1
                    for update)
    returning r.id into v_id;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.avisos_por_revisar (user_id, log_ids, es_alta, vence_at)
  values (p_user_id, array(select distinct x from unnest(p_log_ids) x), p_es_alta, now() + p_espera)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.avisos_esperar_guardado(uuid, uuid[], uuid, boolean, interval) from public, anon, authenticated;
grant execute on function public.avisos_esperar_guardado(uuid, uuid[], uuid, boolean, interval) to service_role;

-- Reserva atómica de las esperas vencidas: dos llamadas a la vez nunca toman la misma.
-- Recupera las que quedaron 'procesando' más de 10 min (una función cortada a medias).
create or replace function public.avisos_reclamar_revisiones(p_limite integer default 20)
returns setof public.avisos_por_revisar
language sql set search_path = public as $$
  update public.avisos_por_revisar r
     set estado = 'procesando', intentos = r.intentos + 1, reclamado_at = now()
   where r.id in (
     select id from public.avisos_por_revisar
      where (estado = 'pendiente' and vence_at <= now())
         or (estado = 'procesando' and reclamado_at < now() - interval '10 minutes')
      order by vence_at
      limit p_limite
      for update skip locked)
  returning r.*;
$$;
revoke all on function public.avisos_reclamar_revisiones(integer) from public, anon, authenticated;
grant execute on function public.avisos_reclamar_revisiones(integer) to service_role;

-- RLS: lectura solo para admin, como avisos_salientes; escribe el servidor con service role.
alter table public.avisos_por_revisar enable row level security;
create policy avisos_por_revisar_admin_select on public.avisos_por_revisar
  for select to authenticated using ((select public.is_admin()));

-- El reloj: cada minuto, y solo si hay algo vencido, llama a la app. pg_net no espera la
-- respuesta; la app contesta enseguida y trabaja después.
select cron.schedule('avisos-revisar', '* * * * *', $job$
  select net.http_post(
    url := 'https://control-horas-theta.vercel.app/api/avisos/revisar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'avisos_cron_secret'), '')),
    timeout_milliseconds := 10000)
  where exists (
          select 1 from public.avisos_por_revisar
           where (estado = 'pendiente' and vence_at <= now())
              or (estado = 'procesando' and reclamado_at < now() - interval '10 minutes'))
     or exists (
          select 1 from public.avisos_salientes
           where (estado = 'pendiente' and proximo_intento <= now())
              or (estado = 'enviando' and reclamado_at < now() - interval '10 minutes'));
$job$);

-- Limpieza diaria: cron.job_run_details no se limpia sola y con una tarea por minuto crece
-- ~1.440 filas al día. Las esperas cerradas tampoco hacen falta pasado un mes.
select cron.schedule('avisos-limpieza', '15 4 * * *', $job$
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  delete from public.avisos_por_revisar where estado in ('hecha', 'fallida') and created_at < now() - interval '30 days';
$job$);
