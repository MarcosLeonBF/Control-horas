-- Descripción por departamento (0025). En "Departamento" la descripción debe pertenecer
-- al departamento de la línea; en proyecto cliente es texto libre (solo no-vacía).
do $$
declare
  v_admin      uuid := '1de8f167-ca74-49eb-a2b7-3273b63e8c2b';
  v_intern     uuid;
  v_dep_id     uuid;
  v_dep_name   text;
  v_desc_id    uuid;
  v_desc_name  text := '__desc_test_dep__';
  v_etapa      uuid;
  v_op         uuid;
  v_op_area    uuid;
  v_op_desc    text := '__texto_libre_cliente__';
  v_etapa_op   uuid;
  v_log        uuid;
  ok           bool;
begin
  select id into v_intern from public.areas where is_internal = true;
  select dep.id, dep.name into v_dep_id, v_dep_name
    from public.position_departamentos pd
    join public.departamentos dep on dep.id = pd.departamento_id
    where pd.position_id = (select position_id from public.profiles where id = v_admin)
    limit 1;
  select pe.etapa_id into v_etapa
    from public.position_etapas pe
    where pe.position_id = (select position_id from public.profiles where id = v_admin) limit 1;
  if v_intern is null or v_dep_id is null then
    raise exception 'precondición: falta área interna o departamento en la posición del admin';
  end if;

  -- Sembrar una descripción y ligarla al departamento.
  insert into public.descripciones(name) values (v_desc_name) on conflict (name) do nothing;
  select id into v_desc_id from public.descripciones where name = v_desc_name;
  insert into public.departamento_descripciones(departamento_id, descripcion_id)
    values (v_dep_id, v_desc_id) on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);
  delete from public.time_logs where user_id = v_admin and entry_date = current_date;

  -- Departamento con descripción del departamento → OK
  v_log := public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date',current_date,'project','Departamento','area_id',v_intern,'department',v_dep_name,'etapa_id',v_etapa,'hours',1,'description',v_desc_name)
  ));
  if v_log is null then raise exception 'Departamento con descripción del depto debería aceptarse'; end if;
  delete from public.time_logs where id = v_log;

  -- Departamento con descripción inexistente → rechazada
  ok := true;
  begin perform public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date',current_date,'project','Departamento','area_id',v_intern,'department',v_dep_name,'etapa_id',v_etapa,'hours',1,'description','__no_existe_en_depto__')
  )); ok := false; exception when others then null; end;
  if not ok then raise exception 'Departamento con descripción ajena no fue rechazada'; end if;

  -- Proyecto cliente con texto libre → OK (operativo configurado)
  select p.id into v_op
  from public.profiles p
  join public.user_areas ua on ua.user_id = p.id
  where p.role='operativo' and p.status='activo'
    and exists (select 1 from public.position_etapas pe where pe.position_id = p.position_id)
  limit 1;
  if v_op is not null then
    select ua.area_id into v_op_area from public.user_areas ua
      where ua.user_id = v_op and ua.area_id <> v_intern limit 1;
    select pe.etapa_id into v_etapa_op from public.position_etapas pe
      where pe.position_id = (select position_id from public.profiles where id=v_op) limit 1;
    perform set_config('request.jwt.claims', json_build_object('sub', v_op::text, 'role','authenticated')::text, true);
    delete from public.time_logs where user_id = v_op and entry_date = current_date;
    v_log := public.guardar_registro(null, jsonb_build_array(
      jsonb_build_object('entry_date',current_date,'project','Cliente Z','area_id',v_op_area,'department','Clientes','etapa_id',v_etapa_op,'hours',1,'description',v_op_desc)
    ));
    if v_log is null then raise exception 'cliente con texto libre debería aceptarse'; end if;
    delete from public.time_logs where id = v_log;

    -- descripción vacía → rechazada
    ok := true;
    begin perform public.guardar_registro(null, jsonb_build_array(
      jsonb_build_object('entry_date',current_date,'project','Cliente Z','area_id',v_op_area,'department','Clientes','etapa_id',v_etapa_op,'hours',1,'description','')
    )); ok := false; exception when others then null; end;
    if not ok then raise exception 'descripción vacía no fue rechazada'; end if;
  end if;

  -- limpieza de la siembra
  delete from public.departamento_descripciones where departamento_id = v_dep_id and descripcion_id = v_desc_id;
  delete from public.descripciones where id = v_desc_id;
  raise notice 'OK rpc descripción por departamento';
end $$;
