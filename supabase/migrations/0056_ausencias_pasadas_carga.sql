-- ============================================================
-- 0056 VACACIONES: carga a mano de ausencias pasadas
-- ------------------------------------------------------------
-- Petición (2026-10-06): dos personas salen en "días sin registrar" con días en los que no
-- estaban. No es un error del cálculo: son ausencias que ya pasaron y que nunca llegaron a la
-- plataforma (el flujo de Julián no las mandó, o las mandó tarde y se descartaron como
-- `ya_terminada`, como el 02/10 de Estefanía).
--
--   - Arturo Rodríguez:         16, 17 y 18/09/2026 (una ausencia de tres días).
--   - Estefanía García:         11/09/2026 y 02/10/2026 (dos ausencias de un día).
--
-- No se anula ningún registro: se dan de alta como ausencias YA CERRADAS en `vacaciones`
-- (desde/hasta), igual que si hubieran llegado su activar y su desactivar. Así esos días se
-- saltan como festivos suyos en dias-sin-registrar (ausenciasPorPersona) y no se toca nada
-- más. `eventos` lleva el periodo, como lo habría mandado el flujo.
--
-- La persona se resuelve por slack_id, como al leer. Aquí se parte del EMAIL (único y fijo)
-- y se comprueba que su slack_id sigue siendo el de la 0051: si alguien lo cambió, aborta en
-- vez de cargar la ausencia a otra persona.
--
-- Aborta también si la persona tiene algún registro no anulado en uno de esos días (entonces
-- el día no le salía pendiente y algo no cuadra) o si ya tiene otra ausencia que se solape.
-- Si la misma ausencia ya está cargada (mismo desde y hasta), la cuenta y sigue: re-ejecutarla
-- no hace nada.
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
      ('arturo.it@bastidafarina.com',        'U07CSUCR02Y', date '2026-09-16', date '2026-09-18'),  -- Arturo Rodríguez
      ('garcia.estefania@bastidafarina.com', 'U096AGWQJN4', date '2026-09-11', date '2026-09-11'),  -- Estefanía García
      ('garcia.estefania@bastidafarina.com', 'U096AGWQJN4', date '2026-10-02', date '2026-10-02')   -- Estefanía García
    ) as t(email, slack_id, desde, hasta)
  loop
    v_total := v_total + 1;

    select count(*) into v_n from public.profiles where lower(email) = r.email;
    if v_n <> 1 then
      raise exception 'Migración 0056: % perfiles con el email % (se esperaba 1)', v_n, r.email;
    end if;

    select id, slack_id, full_name into v_id, v_slack, v_nombre
      from public.profiles where lower(email) = r.email;

    if v_slack is distinct from r.slack_id then
      raise exception 'Migración 0056: % tiene el ID de Slack % y se esperaba %; no se carga',
        v_nombre, coalesce(v_slack, '(ninguno)'), r.slack_id;
    end if;

    select count(*) into v_n from public.time_logs
      where user_id = v_id and status <> 'anulado' and entry_date between r.desde and r.hasta;
    if v_n > 0 then
      raise exception 'Migración 0056: % tiene % registro(s) entre % y %; esos días no le salían pendientes',
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
      raise exception 'Migración 0056: % ya tiene una ausencia que se solapa con % – %; no se carga',
        v_nombre, r.desde, r.hasta;
    end if;

    insert into public.vacaciones (slack_id, desde, hasta, eventos)
    values (r.slack_id, r.desde, r.hasta,
            jsonb_build_array(jsonb_build_object('inicio', r.desde::text, 'fin', r.hasta::text, 'tipo', 'ausencia')));
    v_cargadas := v_cargadas + 1;
  end loop;

  if v_total <> 3 or v_cargadas + v_ya <> 3 then
    raise exception 'Migración 0056: se esperaban 3 ausencias y salen % (cargadas %, ya estaban %)',
      v_total, v_cargadas, v_ya;
  end if;

  raise notice 'Migración 0056: % ausencias cargadas, % ya estaban', v_cargadas, v_ya;
end $$;
