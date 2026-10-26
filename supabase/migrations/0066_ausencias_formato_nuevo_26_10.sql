-- ============================================================
-- 0066 VACACIONES: lo que dejó el cambio de formato del 26/10
-- ------------------------------------------------------------
-- 1) Arturo Rodríguez, vacaciones 26–27/10. Su envío de las 06:01 del 26/10 llegó ya en el
--    formato nuevo (sin accion) y se rechazó con un 400. Se carga como lo habría guardado la
--    entrada: del 26 al 27/10, con su fecha fin ya puesta. Mismas comprobaciones que la
--    0064: persona por email con su slack_id, sin registros esos días, sin solape;
--    idempotente.
-- 2) Las 3 ausencias de un día del 23/10 (Marcos Leon, Andreu Jimenez y U0BGFCY0J2K, sin
--    usuario) se activaron sin que llegara nunca el desactivar: seguían de vacaciones. Se
--    cierran en su fecha fin, el 23/10 (lo mismo que el botón «Desactivar en su Fecha fin»).
-- ============================================================

do $$
declare
  v_n      int;
  v_id     uuid;
  v_slack  text;
  v_nombre text;
begin
  -- 1) Arturo Rodríguez, 26–27/10.
  select count(*) into v_n from public.profiles where lower(email) = 'arturo.it@bastidafarina.com';
  if v_n <> 1 then
    raise exception 'Migración 0066: % perfiles con el email de Arturo (se esperaba 1)', v_n;
  end if;
  select id, slack_id, full_name into v_id, v_slack, v_nombre
    from public.profiles where lower(email) = 'arturo.it@bastidafarina.com';
  if v_slack is distinct from 'U07CSUCR02Y' then
    raise exception 'Migración 0066: % tiene el ID de Slack % y se esperaba U07CSUCR02Y; no se carga',
      v_nombre, coalesce(v_slack, '(ninguno)');
  end if;

  select count(*) into v_n from public.time_logs
    where user_id = v_id and status <> 'anulado' and entry_date between date '2026-10-26' and date '2026-10-27';
  if v_n > 0 then
    raise exception 'Migración 0066: % tiene % registro(s) el 26–27/10; no se carga', v_nombre, v_n;
  end if;

  if exists (select 1 from public.vacaciones
              where slack_id = 'U07CSUCR02Y' and desde = date '2026-10-26' and hasta = date '2026-10-27') then
    raise notice 'Migración 0066: la ausencia de % ya estaba', v_nombre;
  elsif exists (select 1 from public.vacaciones
                 where slack_id = 'U07CSUCR02Y' and desde <= date '2026-10-27'
                   and coalesce(hasta, current_date) >= date '2026-10-26') then
    raise exception 'Migración 0066: % ya tiene una ausencia que se solapa con el 26–27/10; no se carga', v_nombre;
  else
    insert into public.vacaciones (slack_id, desde, hasta, eventos)
    values ('U07CSUCR02Y', date '2026-10-26', date '2026-10-27',
            jsonb_build_array(jsonb_build_object('inicio', '2026-10-26', 'fin', '2026-10-27')));
    raise notice 'Migración 0066: cargada la ausencia de % (26–27/10)', v_nombre;
  end if;

  -- 2) Cierre de las 3 abiertas del 23/10.
  update public.vacaciones set hasta = date '2026-10-23', updated_at = now()
    where slack_id in ('U07MF8E7R62', 'U0BKD5CK4PN', 'U0BGFCY0J2K')
      and desde = date '2026-10-23' and hasta is null;
  get diagnostics v_n = row_count;

  if (select count(*) from public.vacaciones
       where slack_id in ('U07MF8E7R62', 'U0BKD5CK4PN', 'U0BGFCY0J2K')
         and desde = date '2026-10-23' and hasta = date '2026-10-23') <> 3 then
    raise exception 'Migración 0066: se esperaban 3 ausencias del 23/10 cerradas ese día';
  end if;
  raise notice 'Migración 0066: % ausencias del 23/10 cerradas ahora (3 en total)', v_n;
end $$;
