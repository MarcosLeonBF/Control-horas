-- Impersona a un operativo y prueba guardar (fecha por línea) + validaciones + área
-- Las descripciones deben pertenecer a la posición del dueño (0024), así que se toma
-- una descripción válida de la posición del operativo (v_desc_op) y del admin
-- (v_desc_admin) en vez de texto libre.
do $$
declare
  v_op          uuid;
  v_admin       uuid := '1de8f167-ca74-49eb-a2b7-3273b63e8c2b';
  v_area        uuid;
  v_seo         uuid;
  v_intern      uuid;
  v_etapa       uuid;
  v_desc_op     text;   -- descripción válida para la posición del operativo
  v_desc_admin  text;   -- descripción válida para la posición del admin
  v_log         uuid;
  v_log2        uuid;
  v_lines       jsonb;
  ok            bool;
  n             int;
begin
  -- Operativo bien configurado para este test: con área CRM, sin SEO (para el caso
  -- "área no asignada"), y cuya posición tenga la etapa 'Setup' y descripciones.
  select p.id into v_op
  from public.profiles p
  join public.user_areas ua on ua.user_id = p.id
  join public.areas a on a.id = ua.area_id and a.name = 'CRM'
  where p.role = 'operativo' and p.status = 'activo'
    and not exists (select 1 from public.user_areas u2 join public.areas a2 on a2.id = u2.area_id
                    where u2.user_id = p.id and a2.name = 'SEO')
    and exists (select 1 from public.position_etapas pe join public.etapas e on e.id = pe.etapa_id
                where pe.position_id = p.position_id and e.name = 'Setup')
    and exists (select 1 from public.position_descripciones pd where pd.position_id = p.position_id)
  limit 1;
  if v_op is null then raise notice 'SKIP: no hay operativo con CRM/Setup/descripciones configurado'; return; end if;
  select id into v_area from public.areas where name='CRM';
  select id into v_seo  from public.areas where name='SEO';
  select id into v_intern from public.areas where is_internal = true;
  select id into v_etapa from public.etapas where name='Setup';
  -- Precondiciones: el test de "área no asignada" sería vacío si faltara SEO.
  if v_area is null or v_seo is null or v_intern is null or v_etapa is null then
    raise exception 'precondición del test: faltan áreas/etapa semilla (CRM/SEO/interna/Setup)';
  end if;
  -- Descripciones válidas por posición (0024).
  select d.name into v_desc_op
  from public.position_descripciones pd join public.descripciones d on d.id=pd.descripcion_id
  where pd.position_id = (select position_id from public.profiles where id=v_op) limit 1;
  select d.name into v_desc_admin
  from public.position_descripciones pd join public.descripciones d on d.id=pd.descripcion_id
  where pd.position_id = (select position_id from public.profiles where id=v_admin) limit 1;
  if v_desc_op is null or v_desc_admin is null then
    raise exception 'precondición del test: falta descripción en la posición del operativo o del admin';
  end if;

  -- Idempotencia: limpiar logs del operativo en las fechas que usa el test.
  delete from public.time_logs where user_id=v_op
    and entry_date in (current_date, current_date-1, current_date-2, current_date-3);

  perform set_config('request.jwt.claims', json_build_object('sub', v_op::text, 'role','authenticated')::text, true);

  -- ALTA MULTIFECHA: 2 líneas de hoy + 1 de hace 3 días → 2 logs diarios.
  v_lines := jsonb_build_array(
    jsonb_build_object('entry_date', current_date,     'project','Cliente A','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',2,  'description',v_desc_op),
    jsonb_build_object('entry_date', current_date,     'project','Cliente B','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1.5,'description',v_desc_op),
    jsonb_build_object('entry_date', current_date - 3, 'project','Cliente C','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,  'description',v_desc_op)
  );
  perform public.guardar_registro(null, v_lines);

  select count(*) into n from public.time_logs where user_id=v_op and entry_date in (current_date, current_date-3);
  if n <> 2 then raise exception 'esperaba 2 logs (uno por fecha), hubo %', n; end if;
  if (select total_hours from public.time_logs where user_id=v_op and entry_date=current_date) <> 3.5 then
    raise exception 'total de hoy esperado 3.5';
  end if;
  if (select total_hours from public.time_logs where user_id=v_op and entry_date=current_date-3) <> 1 then
    raise exception 'total de hace 3 días esperado 1';
  end if;
  delete from public.time_logs where user_id=v_op and entry_date in (current_date, current_date-3);

  -- FECHA FUTURA (por línea) rechazada
  ok := true;
  begin perform public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date', current_date + 1, 'project','X','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description',v_desc_op))); ok := false;
  exception when others then null; end;
  if not ok then raise exception 'fecha futura no fue rechazada'; end if;

  -- FECHA > 7 DÍAS (por línea) rechazada para operativo; una línea fuera de rango aborta todo el envío
  ok := true;
  begin perform public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date', current_date,      'project','X','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description',v_desc_op),
    jsonb_build_object('entry_date', current_date - 10, 'project','Y','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description',v_desc_op))); ok := false;
  exception when others then null; end;
  if not ok then raise exception 'línea con fecha vieja no fue rechazada para operativo'; end if;

  -- DUPLICADOS misma fecha rechazados
  ok := true;
  begin perform public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date', current_date, 'project','D','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description',v_desc_op),
    jsonb_build_object('entry_date', current_date, 'project','D','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description',v_desc_op)
  )); ok := false;
  exception when others then null; end;
  if not ok then raise exception 'duplicados (misma fecha) no rechazados'; end if;

  -- Misma combinación pero DISTINTA fecha → permitido (2 logs)
  perform public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date', current_date,     'project','D','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description',v_desc_op),
    jsonb_build_object('entry_date', current_date - 1, 'project','D','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description',v_desc_op)
  ));
  select count(*) into n from public.time_logs where user_id=v_op and entry_date in (current_date, current_date-1);
  if n <> 2 then raise exception 'misma combinación en días distintos debería permitirse'; end if;
  delete from public.time_logs where user_id=v_op and entry_date in (current_date, current_date-1);

  -- EDICIÓN CON DIVISIÓN: 1 línea hoy → editar a 2 líneas (hoy + hace 2 días)
  v_log := public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date', current_date, 'project','Cliente A','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',2,'description',v_desc_op)));
  perform public.guardar_registro(v_log, jsonb_build_array(
    jsonb_build_object('entry_date', current_date,     'project','Cliente A','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',2,'description',v_desc_op),
    jsonb_build_object('entry_date', current_date - 2, 'project','Cliente B','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',3,'description',v_desc_op)));
  -- el ancla se reutiliza para hoy (su fecha original); se crea un log nuevo para hace 2 días
  if (select status from public.time_logs where id=v_log) <> 'editado' then raise exception 'ancla no marcada como editada'; end if;
  if (select total_hours from public.time_logs where id=v_log) <> 2 then raise exception 'ancla debería quedar con 2h (hoy)'; end if;
  select count(*) into n from public.time_logs where user_id=v_op and entry_date=current_date-2 and id<>v_log;
  if n <> 1 then raise exception 'la división debería crear un log nuevo para hace 2 días'; end if;
  if (select total_hours from public.time_logs where user_id=v_op and entry_date=current_date-2 and id<>v_log) <> 3 then
    raise exception 'el log dividido debería tener 3h';
  end if;
  delete from public.time_logs where user_id=v_op and entry_date in (current_date, current_date-2);

  -- área no asignada al usuario rechazada (operativo tiene CRM, no SEO)
  ok := true;
  begin perform public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date', current_date, 'project','Cliente X','area_id',v_seo,'department','Clientes','etapa_id',v_etapa,'hours',1,'description',v_desc_op)
  )); ok := false;
  exception when others then null; end;
  if not ok then raise exception 'área no asignada no fue rechazada'; end if;

  -- admin supera la ventana de 7 días con proyecto Departamento + área interna
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);
  v_log := public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date', current_date - 10, 'project','Departamento','area_id',v_intern,'department','Todos','etapa_id',v_etapa,'hours',2,'description',v_desc_admin)
  ));
  if v_log is null then raise exception 'admin debería poder guardar con fecha antigua'; end if;
  delete from public.time_logs where id = v_log;

  -- cross-user edit rechazado: admin crea log, operativo intenta editarlo
  v_log2 := public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date', current_date, 'project','Departamento','area_id',v_intern,'department','Todos','etapa_id',v_etapa,'hours',1,'description',v_desc_admin)
  ));
  perform set_config('request.jwt.claims', json_build_object('sub', v_op::text, 'role','authenticated')::text, true);
  ok := true;
  begin perform public.guardar_registro(v_log2, jsonb_build_array(
    jsonb_build_object('entry_date', current_date, 'project','Cliente A','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description',v_desc_op)
  )); ok := false;
  exception when others then null; end;
  if not ok then raise exception 'edición cross-user no fue rechazada'; end if;
  delete from public.time_logs where id = v_log2;

  raise notice 'OK rpc guardar (multifecha)';
end $$;
