-- Snapshots antes/después de la auditoría (migración 0041).
-- Sigue el patrón de horas_rpc_anular.sql: se hace pasar por un operativo activo
-- vía request.jwt.claims, opera con los RPC reales y limpia lo que crea.

do $$
declare
  v_op uuid; v_area uuid; v_etapa uuid; v_log uuid;
  v_before jsonb; v_after jsonb;
begin
  select id into v_area from public.areas where name='CRM';
  select id into v_etapa from public.etapas where name='Setup';
  -- Selección determinista: el simple "limit 1" del patrón de horas_rpc_anular.sql
  -- depende de qué operativo devuelva primero el scan, y la mayoría de posiciones
  -- no tienen el área CRM asignada. Se filtra por una posición que sí la tenga.
  select p.id into v_op
    from public.profiles p
    join public.position_areas pa on pa.position_id = p.position_id and pa.area_id = v_area
    where p.role='operativo' and p.status='activo'
    limit 1;
  if v_op is null then raise notice 'SKIP: no hay operativo con área CRM'; return; end if;
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
  select id into v_area from public.areas where name='CRM';
  select id into v_etapa from public.etapas where name='Setup';
  select p.id into v_op
    from public.profiles p
    join public.position_areas pa on pa.position_id = p.position_id and pa.area_id = v_area
    where p.role='operativo' and p.status='activo'
    limit 1;
  if v_op is null then raise notice 'SKIP: no hay operativo con área CRM'; return; end if;
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
