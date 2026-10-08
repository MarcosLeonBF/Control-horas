-- ============================================================
-- 0058 VACACIONES: carga a mano de ausencias pasadas (Cecilia Dulcich)
-- ------------------------------------------------------------
-- Petición (2026-10-08), lo mismo que la 0056: días en los que no estaba y que le salen
-- pendientes en "días sin registrar" porque su ausencia nunca llegó a la plataforma.
--
--   - Cecilia Dulcich: 24–25/09/2026 (evento B&F) y 30/09–02/10/2026 (tres días).
--
-- Se dan de alta como ausencias YA CERRADAS en `vacaciones`; no se anula ningún registro.
-- Mismas comprobaciones que la 0056: persona por email con el slack_id de la 0051, sin
-- registros no anulados esos días, sin otra ausencia que se solape; idempotente.
-- ============================================================

do $$
declare
  r          record;
  v_n        int;
  v_id       uuid;
  v_slack    text;
  v_nombre   text;
  v_cargadas int := 0;
  v_ya       int := 0;
  v_total    int := 0;
begin
  for r in
    select * from (values
      ('cecilia@bastidafarina.com', 'U09BXSAGJGK', date '2026-09-24', date '2026-09-25'),  -- Cecilia Dulcich
      ('cecilia@bastidafarina.com', 'U09BXSAGJGK', date '2026-09-30', date '2026-10-02')   -- Cecilia Dulcich
    ) as t(email, slack_id, desde, hasta)
  loop
    v_total := v_total + 1;

    select count(*) into v_n from public.profiles where lower(email) = r.email;
    if v_n <> 1 then
      raise exception 'Migración 0058: % perfiles con el email % (se esperaba 1)', v_n, r.email;
    end if;

    select id, slack_id, full_name into v_id, v_slack, v_nombre
      from public.profiles where lower(email) = r.email;

    if v_slack is distinct from r.slack_id then
      raise exception 'Migración 0058: % tiene el ID de Slack % y se esperaba %; no se carga',
        v_nombre, coalesce(v_slack, '(ninguno)'), r.slack_id;
    end if;

    select count(*) into v_n from public.time_logs
      where user_id = v_id and status <> 'anulado' and entry_date between r.desde and r.hasta;
    if v_n > 0 then
      raise exception 'Migración 0058: % tiene % registro(s) entre % y %; esos días no le salían pendientes',
        v_nombre, v_n, r.desde, r.hasta;
    end if;

    if exists (select 1 from public.vacaciones
                where slack_id = r.slack_id and desde = r.desde and hasta = r.hasta) then
      v_ya := v_ya + 1;
      continue;
    end if;

    -- Otra ausencia que se solape (una abierta cuenta hasta hoy).
    if exists (select 1 from public.vacaciones
                where slack_id = r.slack_id and desde <= r.hasta and coalesce(hasta, current_date) >= r.desde) then
      raise exception 'Migración 0058: % ya tiene una ausencia que se solapa con % – %; no se carga',
        v_nombre, r.desde, r.hasta;
    end if;

    insert into public.vacaciones (slack_id, desde, hasta, eventos)
    values (r.slack_id, r.desde, r.hasta,
            jsonb_build_array(jsonb_build_object('inicio', r.desde::text, 'fin', r.hasta::text, 'tipo', 'ausencia')));
    v_cargadas := v_cargadas + 1;
  end loop;

  if v_total <> 2 or v_cargadas + v_ya <> 2 then
    raise exception 'Migración 0058: se esperaban 2 ausencias y salen % (cargadas %, ya estaban %)',
      v_total, v_cargadas, v_ya;
  end if;

  raise notice 'Migración 0058: % ausencias cargadas, % ya estaban', v_cargadas, v_ya;
end $$;
