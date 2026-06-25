-- Impersona a un operativo y prueba guardar + validaciones de fecha
do $$
declare v_op uuid; v_area uuid; v_etapa uuid; v_log uuid; v_lines jsonb; ok bool;
begin
  select id into v_op from public.profiles where role='operativo' and status='activo' limit 1;
  if v_op is null then raise notice 'SKIP: no hay operativo activo'; return; end if;
  select id into v_area from public.areas where name='CRM';
  select id into v_etapa from public.etapas where name='Setup';

  perform set_config('request.jwt.claims', json_build_object('sub', v_op::text, 'role','authenticated')::text, true);

  v_lines := jsonb_build_array(
    jsonb_build_object('project','Cliente A','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',2,'description','flujo CRM'),
    jsonb_build_object('project','Cliente B','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1.5,'description','reunión')
  );
  v_log := public.guardar_registro_diario(null, current_date, v_lines);

  if (select total_hours from public.time_logs where id=v_log) <> 3.5 then
    raise exception 'total esperado 3.5';
  end if;
  if (select count(*) from public.time_log_lines where log_id=v_log) <> 2 then
    raise exception 'esperaba 2 líneas';
  end if;

  -- fecha futura rechazada
  ok := true;
  begin perform public.guardar_registro_diario(null, current_date + 1, v_lines); ok := false;
  exception when others then null; end;
  if not ok then raise exception 'fecha futura no fue rechazada'; end if;

  -- fecha > 7 días atrás rechazada para operativo
  ok := true;
  begin perform public.guardar_registro_diario(null, current_date - 10, v_lines); ok := false;
  exception when others then null; end;
  if not ok then raise exception 'fecha vieja no fue rechazada para operativo'; end if;

  -- edición: reemplaza líneas y recalcula total
  perform public.guardar_registro_diario(v_log, current_date,
    jsonb_build_array(jsonb_build_object('project','Cliente A','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',4,'description','corregido')));
  if (select total_hours from public.time_logs where id=v_log) <> 4 then raise exception 'edición no recalculó total'; end if;
  if (select status from public.time_logs where id=v_log) <> 'editado' then raise exception 'edición no marcó estado'; end if;

  -- líneas duplicadas rechazadas
  ok := true;
  begin perform public.guardar_registro_diario(null, current_date,
    jsonb_build_array(
      jsonb_build_object('project','D','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description','x'),
      jsonb_build_object('project','D','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description','y')
    )); ok := false;
  exception when others then null; end;
  if not ok then raise exception 'duplicados no rechazados'; end if;

  delete from public.time_logs where id = v_log;
  raise notice 'OK rpc guardar';
end $$;
