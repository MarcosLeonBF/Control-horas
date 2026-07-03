-- Alcance por posición (área/etapa/departamento) + descripción por departamento (0025).
-- El admin (y todos) se limitan a: área ∈ sus áreas, etapa ∈ su posición, departamento ∈
-- su posición, y en "Departamento" la descripción ∈ descripciones del departamento.
-- DESTRUCTIVO sobre time_logs (crea/borra registros de prueba) y siembra/limpia una
-- descripción centinela. Correr en DB de prueba o sin registros que conservar.
do $$
declare
  v_op          uuid;
  v_admin       uuid := '1de8f167-ca74-49eb-a2b7-3273b63e8c2b';
  v_intern      uuid;
  v_op_area     uuid;
  v_etapa_ok    uuid;
  v_etapa_bad   uuid;
  v_dep_ok      text;
  v_dep_ok_id   uuid;
  v_dep_bad     text;
  v_desc_id     uuid;
  v_desc_name   text := '__desc_test_campos__';
  v_log         uuid;
  ok            bool;
begin
  select p.id into v_op
  from public.profiles p
  where p.role='operativo' and p.status='activo'
    and exists (select 1 from public.user_areas ua where ua.user_id = p.id)
    and exists (select 1 from public.position_etapas pe where pe.position_id = p.position_id)
  limit 1;
  if v_op is null then raise notice 'SKIP: no hay operativo configurado (área/etapa)'; return; end if;
  select id into v_intern from public.areas where is_internal = true;
  select ua.area_id into v_op_area from public.user_areas ua where ua.user_id = v_op limit 1;
  select pe.etapa_id into v_etapa_ok from public.position_etapas pe
    join public.profiles pr on pr.position_id = pe.position_id where pr.id = v_op limit 1;
  select e.id into v_etapa_bad from public.etapas e
    where e.active and not exists (
      select 1 from public.position_etapas pe join public.profiles pr on pr.position_id = pe.position_id
      where pr.id = v_op and pe.etapa_id = e.id) limit 1;
  select dep.name, dep.id into v_dep_ok, v_dep_ok_id
    from public.position_departamentos pd join public.departamentos dep on dep.id = pd.departamento_id
    join public.profiles pr on pr.position_id = pd.position_id where pr.id = v_admin limit 1;
  select dep.name into v_dep_bad from public.departamentos dep
    where dep.active and not exists (
      select 1 from public.position_departamentos pd join public.profiles pr on pr.position_id = pd.position_id
      where pr.id = v_admin and pd.departamento_id = dep.id) limit 1;
  if v_intern is null or v_op_area is null or v_etapa_ok is null or v_dep_ok is null then
    raise exception 'precondición: faltan asignaciones (interna/área op/etapa/depto admin)';
  end if;

  -- Sembrar una descripción para el departamento del admin (para el caso válido).
  insert into public.descripciones(name) values (v_desc_name) on conflict (name) do nothing;
  select id into v_desc_id from public.descripciones where name = v_desc_name;
  insert into public.departamento_descripciones(departamento_id, descripcion_id)
    values (v_dep_ok_id, v_desc_id) on conflict do nothing;

  delete from public.time_logs where user_id in (v_op, v_admin) and entry_date = current_date;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);

  -- Departamento fuera de su posición → rechazado (rechaza antes de mirar descripción)
  if v_dep_bad is not null then
    ok := true;
    begin perform public.guardar_registro(null, jsonb_build_array(
      jsonb_build_object('entry_date',current_date,'project','Departamento','area_id',v_intern,'department',v_dep_bad,'etapa_id',v_etapa_ok,'hours',1,'description',v_desc_name)
    )); ok := false; exception when others then null; end;
    if not ok then raise exception 'admin: departamento fuera de su posición no fue rechazado'; end if;
  end if;

  -- Descripción ajena al departamento → rechazada
  ok := true;
  begin perform public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date',current_date,'project','Departamento','area_id',v_intern,'department',v_dep_ok,'etapa_id',v_etapa_ok,'hours',1,'description','__ajena_al_depto__')
  )); ok := false; exception when others then null; end;
  if not ok then raise exception 'admin: descripción ajena al departamento no fue rechazada'; end if;

  -- Área en proyecto cliente → rechazada si el admin no tiene áreas asignadas
  if not exists (select 1 from public.user_areas where user_id = v_admin) then
    ok := true;
    begin perform public.guardar_registro(null, jsonb_build_array(
      jsonb_build_object('entry_date',current_date,'project','Cliente Z','area_id',v_op_area,'department','Clientes','etapa_id',v_etapa_ok,'hours',1,'description','trabajo libre')
    )); ok := false; exception when others then null; end;
    if not ok then raise exception 'admin: área no asignada (cliente) no fue rechazada'; end if;
  end if;

  -- Caso válido: Departamento de su posición + descripción del departamento → aceptado
  v_log := public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date',current_date,'project','Departamento','area_id',v_intern,'department',v_dep_ok,'etapa_id',v_etapa_ok,'hours',1,'description',v_desc_name)
  ));
  if v_log is null then raise exception 'admin: caso válido debería aceptarse'; end if;
  delete from public.time_logs where id = v_log;

  -- Operativo: etapa fuera de su posición (cliente, descripción libre) → rechazada
  if v_etapa_bad is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_op::text, 'role','authenticated')::text, true);
    ok := true;
    begin perform public.guardar_registro(null, jsonb_build_array(
      jsonb_build_object('entry_date',current_date,'project','Cliente Z','area_id',v_op_area,'department','Clientes','etapa_id',v_etapa_bad,'hours',1,'description','trabajo libre')
    )); ok := false; exception when others then null; end;
    if not ok then raise exception 'operativo: etapa fuera de su posición no fue rechazada'; end if;
  end if;

  -- limpieza de la siembra
  delete from public.departamento_descripciones where departamento_id = v_dep_ok_id and descripcion_id = v_desc_id;
  delete from public.descripciones where id = v_desc_id;
  raise notice 'OK rpc campos por posición (0025)';
end $$;
