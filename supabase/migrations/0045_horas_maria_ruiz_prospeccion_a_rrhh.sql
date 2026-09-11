-- ============================================================
-- 0045 HORAS: registros de Maria Ruiz de "Prospección" pasan a "RRHH"
-- ------------------------------------------------------------
-- Petición de negocio (2026-09-11): las horas que Maria Ruiz anotó en el
-- proyecto interno "Departamento" con departamento "Prospección" son de RRHH.
-- Se cambian departamento Y etapa, porque la etapa depende del departamento
-- (departamento_etapas): Prospección → "Gastos Indirectos Captación",
-- RRHH → "Gastos Generales Corporativos". SOLO Maria Ruiz: las líneas de
-- Prospección de otras personas no se tocan.
--
-- Al aplicarla: 41 líneas / 76,00 h, del 2026-07-01 al 2026-09-10, ninguna
-- anulada. En el histórico (horas_historicas) no tiene nada de Prospección.
--
-- FUSIÓN: en 13 de esos registros ya había una línea de RRHH con la misma
-- descripción ("Mejoras departamento"). Moverlas tal cual dejaría dos líneas
-- idénticas en fecha+proyecto+área+departamento+etapa+descripción, que
-- guardar_registro rechaza ("hay líneas duplicadas"): el registro dejaría de
-- poder editarse. En esos casos las horas se suman a la línea de RRHH y la de
-- Prospección se borra. total_hours de cada registro no cambia.
--
-- AUDITORÍA: cada registro tocado recibe un asiento "editar" con antes/después,
-- sin actor (actor_id NULL) y rotulado como migración. No se cambia el estado
-- del registro (guardado/editado) porque no es una edición de la usuaria.
--
-- Todo va en un único bloque: si cualquier comprobación final falla, se lanza
-- excepción y no se aplica nada. Re-ejecutarla no hace nada.
-- ============================================================

do $$
declare
  v_user        uuid;
  v_user_name   text;
  v_etapa_rrhh  uuid;
  v_logs        uuid[];
  v_lineas      int;
  v_horas       numeric;
  v_fusionadas  int;
  v_movidas     int;
  v_asientos    int;
  v_antes       jsonb;          -- log_id → snapshot de sus líneas antes del cambio
  v_maria_h_antes   numeric;
  v_otros_n_antes   int;
  v_otros_h_antes   numeric;
begin
  -- Ids resueltos por nombre; STRICT falla si hay 0 o más de 1.
  select id, full_name into strict v_user, v_user_name
    from public.profiles where full_name = 'Maria Ruiz';

  select de.etapa_id into strict v_etapa_rrhh
    from public.departamento_etapas de
    join public.departamentos d on d.id = de.departamento_id
   where d.name = 'RRHH';

  select array_agg(distinct l.log_id), count(*), sum(l.hours)
    into v_logs, v_lineas, v_horas
    from public.time_log_lines l
    join public.time_logs t on t.id = l.log_id
   where t.user_id = v_user
     and l.project = 'Departamento'
     and l.department = 'Prospección';

  if v_logs is null then
    raise notice '0045: Maria Ruiz no tiene líneas de Prospección; nada que hacer';
    return;
  end if;

  -- Líneas base para las comprobaciones finales.
  select sum(l.hours) into v_maria_h_antes
    from public.time_log_lines l join public.time_logs t on t.id = l.log_id
   where t.user_id = v_user;
  select count(*), coalesce(sum(l.hours), 0) into v_otros_n_antes, v_otros_h_antes
    from public.time_log_lines l join public.time_logs t on t.id = l.log_id
   where t.user_id <> v_user and l.department = 'Prospección';

  -- Foto del "antes" de cada registro afectado, para la auditoría.
  select jsonb_object_agg(id, public.audit_snapshot_lineas(id)) into v_antes
    from unnest(v_logs) as id;

  -- 1) Fusión: horas de Prospección sumadas a la línea de RRHH equivalente.
  with p as (
    select l.log_id, l.area_id, btrim(l.description) as descr, sum(l.hours) as hours
      from public.time_log_lines l
     where l.log_id = any(v_logs)
       and l.project = 'Departamento' and l.department = 'Prospección'
     group by 1, 2, 3
  )
  update public.time_log_lines r
     set hours = r.hours + p.hours, updated_at = now()
    from p
   where r.log_id = p.log_id
     and r.project = 'Departamento' and r.department = 'RRHH'
     and r.etapa_id = v_etapa_rrhh
     and r.area_id = p.area_id
     and btrim(r.description) = p.descr;

  delete from public.time_log_lines p
   using public.time_log_lines r
   where p.log_id = any(v_logs)
     and p.project = 'Departamento' and p.department = 'Prospección'
     and r.log_id = p.log_id
     and r.project = 'Departamento' and r.department = 'RRHH'
     and r.etapa_id = v_etapa_rrhh
     and r.area_id = p.area_id
     and btrim(r.description) = btrim(p.description);
  get diagnostics v_fusionadas = row_count;

  -- 2) El resto se mueve tal cual: departamento y etapa.
  update public.time_log_lines
     set department = 'RRHH', etapa_id = v_etapa_rrhh, updated_at = now()
   where log_id = any(v_logs)
     and project = 'Departamento' and department = 'Prospección';
  get diagnostics v_movidas = row_count;

  -- 3) Asiento de auditoría por registro tocado.
  insert into public.time_log_audit(log_id, action, actor_id, actor_name, subject_name, entry_date, total_hours, lines_before, lines_after)
  select t.id, 'editar', null, 'Migración 0045 (sistema)', v_user_name,
         t.entry_date, t.total_hours, v_antes -> t.id::text, public.audit_snapshot_lineas(t.id)
    from public.time_logs t
   where t.id = any(v_logs);
  get diagnostics v_asientos = row_count;

  -- 4) Comprobaciones: cualquier fallo revierte todo el bloque.
  if exists (
    select 1 from public.time_log_lines l join public.time_logs t on t.id = l.log_id
     where t.user_id = v_user and l.department = 'Prospección'
  ) then
    raise exception '0045: quedan líneas de Prospección de Maria Ruiz';
  end if;

  if (select sum(l.hours) from public.time_log_lines l join public.time_logs t on t.id = l.log_id
       where t.user_id = v_user) <> v_maria_h_antes then
    raise exception '0045: cambió el total de horas de Maria Ruiz';
  end if;

  if (select count(*) from public.time_log_lines l join public.time_logs t on t.id = l.log_id
       where t.user_id <> v_user and l.department = 'Prospección') <> v_otros_n_antes
     or (select coalesce(sum(l.hours), 0) from public.time_log_lines l join public.time_logs t on t.id = l.log_id
          where t.user_id <> v_user and l.department = 'Prospección') <> v_otros_h_antes then
    raise exception '0045: se tocaron líneas de Prospección de otras personas';
  end if;

  if exists (
    select 1 from public.time_logs t
     where t.id = any(v_logs)
       and t.total_hours <> (select sum(l.hours) from public.time_log_lines l where l.log_id = t.id)
  ) then
    raise exception '0045: total_hours ya no cuadra con la suma de líneas';
  end if;

  if exists (
    select 1 from public.time_log_lines l join public.time_logs t on t.id = l.log_id
     where l.log_id = any(v_logs)
     group by t.entry_date, l.log_id, l.project, l.area_id, l.department, l.etapa_id, btrim(l.description)
    having count(*) > 1
  ) then
    raise exception '0045: quedaron líneas duplicadas';
  end if;

  if v_fusionadas + v_movidas <> v_lineas or v_asientos <> cardinality(v_logs) then
    raise exception '0045: conteos inesperados (líneas %, fusionadas %, movidas %, asientos %)',
      v_lineas, v_fusionadas, v_movidas, v_asientos;
  end if;

  raise notice '0045: % líneas (% h) en % registros: % fusionadas, % movidas, % asientos',
    v_lineas, v_horas, cardinality(v_logs), v_fusionadas, v_movidas, v_asientos;
end $$;
