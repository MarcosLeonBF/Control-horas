-- Impersona a un operativo y prueba guardar + validaciones de fecha + área
do $$
declare
  v_op      uuid;
  v_admin   uuid := '1de8f167-ca74-49eb-a2b7-3273b63e8c2b';
  v_area    uuid;
  v_seo     uuid;
  v_intern  uuid;
  v_etapa   uuid;
  v_log     uuid;
  v_log2    uuid;
  v_lines   jsonb;
  ok        bool;
begin
  select id into v_op from public.profiles where role='operativo' and status='activo' limit 1;
  if v_op is null then raise notice 'SKIP: no hay operativo activo'; return; end if;
  select id into v_area from public.areas where name='CRM';
  select id into v_seo  from public.areas where name='SEO';
  select id into v_intern from public.areas where is_internal = true;
  select id into v_etapa from public.etapas where name='Setup';
  -- Precondiciones: el test de "área no asignada" sería vacío si faltara SEO.
  if v_area is null or v_seo is null or v_intern is null or v_etapa is null then
    raise exception 'precondición del test: faltan áreas/etapa semilla (CRM/SEO/interna/Setup)';
  end if;

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

  -- área no asignada al usuario rechazada (operativo tiene CRM, no SEO)
  ok := true;
  begin perform public.guardar_registro_diario(null, current_date,
    jsonb_build_array(
      jsonb_build_object('project','Cliente X','area_id',v_seo,'department','Clientes','etapa_id',v_etapa,'hours',1,'description','seo work')
    )); ok := false;
  exception when others then null; end;
  if not ok then raise exception 'área no asignada no fue rechazada'; end if;

  delete from public.time_logs where id = v_log;

  -- admin supera la ventana de 7 días con proyecto Departamento + área interna
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);
  v_log := public.guardar_registro_diario(null, current_date - 10,
    jsonb_build_array(
      jsonb_build_object('project','Departamento','area_id',v_intern,'department','Todos','etapa_id',v_etapa,'hours',2,'description','gestión interna')
    ));
  if v_log is null then raise exception 'admin debería poder guardar con fecha antigua'; end if;
  delete from public.time_logs where id = v_log;

  -- cross-user edit rechazado: admin crea log, operativo intenta editarlo
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);
  v_log2 := public.guardar_registro_diario(null, current_date,
    jsonb_build_array(
      jsonb_build_object('project','Departamento','area_id',v_intern,'department','Todos','etapa_id',v_etapa,'hours',1,'description','log del admin')
    ));

  perform set_config('request.jwt.claims', json_build_object('sub', v_op::text, 'role','authenticated')::text, true);
  ok := true;
  begin perform public.guardar_registro_diario(v_log2, current_date,
    jsonb_build_array(
      jsonb_build_object('project','Cliente A','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description','intento')
    )); ok := false;
  exception when others then null; end;
  if not ok then raise exception 'edición cross-user no fue rechazada'; end if;
  delete from public.time_logs where id = v_log2;

  raise notice 'OK rpc guardar';
end $$;
