-- Alcance por posición (área/etapa/departamento) + descripción general (0028).
-- El área, la etapa y el departamento salen de la POSICIÓN del dueño (todos los roles);
-- en "Departamento" la descripción ∈ la lista general de descripciones activas.
-- DESTRUCTIVO sobre time_logs; siembra/limpia una descripción centinela. DB de prueba.
do $$
declare
  v_op             uuid;
  v_admin          uuid := '1de8f167-ca74-49eb-a2b7-3273b63e8c2b';
  v_intern         uuid;
  v_op_area        uuid;   -- un área de la posición del operativo
  v_etapa_ok       uuid;
  v_etapa_bad      uuid;
  v_dep_ok         text;
  v_dep_bad        text;
  v_area_not_admin uuid;   -- un área que NO está en la posición del admin (si existe)
  v_desc_id        uuid;
  v_desc_name      text := '__desc_test_campos__';
  v_log            uuid;
  ok               bool;
begin
  select p.id into v_op
  from public.profiles p
  where p.role='operativo' and p.status='activo'
    and exists (select 1 from public.position_areas pa where pa.position_id = p.position_id)
    and exists (select 1 from public.position_etapas pe where pe.position_id = p.position_id)
  limit 1;
  if v_op is null then raise notice 'SKIP: no hay operativo configurado (área/etapa de posición)'; return; end if;
  select id into v_intern from public.areas where is_internal = true;
  select pa.area_id into v_op_area from public.position_areas pa
    join public.profiles pr on pr.position_id = pa.position_id where pr.id = v_op limit 1;
  select pe.etapa_id into v_etapa_ok from public.position_etapas pe
    join public.profiles pr on pr.position_id = pe.position_id where pr.id = v_op limit 1;
  select e.id into v_etapa_bad from public.etapas e
    where e.active and not exists (
      select 1 from public.position_etapas pe join public.profiles pr on pr.position_id = pe.position_id
      where pr.id = v_op and pe.etapa_id = e.id) limit 1;
  select dep.name into v_dep_ok
    from public.position_departamentos pd join public.departamentos dep on dep.id = pd.departamento_id
    join public.profiles pr on pr.position_id = pd.position_id where pr.id = v_admin limit 1;
  select dep.name into v_dep_bad from public.departamentos dep
    where dep.active and not exists (
      select 1 from public.position_departamentos pd join public.profiles pr on pr.position_id = pd.position_id
      where pr.id = v_admin and pd.departamento_id = dep.id) limit 1;
  select a.id into v_area_not_admin from public.areas a
    where not a.is_internal and a.active and not exists (
      select 1 from public.position_areas pa join public.profiles pr on pr.position_id = pa.position_id
      where pr.id = v_admin and pa.area_id = a.id) limit 1;
  if v_intern is null or v_op_area is null or v_etapa_ok is null then
    raise exception 'precondición: faltan asignaciones (interna/área op/etapa)';
  end if;

  insert into public.descripciones(name, active) values (v_desc_name, true) on conflict (name) do update set active = true;
  select id into v_desc_id from public.descripciones where name = v_desc_name;

  delete from public.time_logs where user_id in (v_op, v_admin) and entry_date = current_date;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);

  -- Departamento fuera de su posición → rechazado
  if v_dep_bad is not null then
    ok := true;
    begin perform public.guardar_registro(null, jsonb_build_array(
      jsonb_build_object('entry_date',current_date,'project','Departamento','area_id',v_intern,'department',v_dep_bad,'etapa_id',v_etapa_ok,'hours',1,'description',v_desc_name)
    )); ok := false; exception when others then null; end;
    if not ok then raise exception 'admin: departamento fuera de su posición no fue rechazado'; end if;
  end if;

  -- Casos que necesitan un departamento de la posición del admin (si tiene alguno).
  if v_dep_ok is not null then
    -- Descripción fuera de la lista general → rechazada
    ok := true;
    begin perform public.guardar_registro(null, jsonb_build_array(
      jsonb_build_object('entry_date',current_date,'project','Departamento','area_id',v_intern,'department',v_dep_ok,'etapa_id',v_etapa_ok,'hours',1,'description','__fuera_de_lista__')
    )); ok := false; exception when others then null; end;
    if not ok then raise exception 'admin: descripción fuera de la lista general no fue rechazada'; end if;

    -- Caso válido: Departamento de su posición + descripción general → aceptado
    v_log := public.guardar_registro(null, jsonb_build_array(
      jsonb_build_object('entry_date',current_date,'project','Departamento','area_id',v_intern,'department',v_dep_ok,'etapa_id',v_etapa_ok,'hours',1,'description',v_desc_name)
    ));
    if v_log is null then raise exception 'admin: caso válido debería aceptarse'; end if;
    delete from public.time_logs where id = v_log;
  end if;

  -- Área fuera de la posición del admin (proyecto cliente) → rechazada
  if v_area_not_admin is not null then
    ok := true;
    begin perform public.guardar_registro(null, jsonb_build_array(
      jsonb_build_object('entry_date',current_date,'project','Cliente Z','area_id',v_area_not_admin,'department','Clientes','etapa_id',v_etapa_ok,'hours',1,'description','trabajo libre')
    )); ok := false; exception when others then null; end;
    if not ok then raise exception 'admin: área fuera de su posición no fue rechazada'; end if;
  end if;

  -- Operativo: etapa fuera de su posición (cliente, descripción libre) → rechazada
  if v_etapa_bad is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_op::text, 'role','authenticated')::text, true);
    ok := true;
    begin perform public.guardar_registro(null, jsonb_build_array(
      jsonb_build_object('entry_date',current_date,'project','Cliente Z','area_id',v_op_area,'department','Clientes','etapa_id',v_etapa_bad,'hours',1,'description','trabajo libre')
    )); ok := false; exception when others then null; end;
    if not ok then raise exception 'operativo: etapa fuera de su posición no fue rechazada'; end if;
  end if;

  delete from public.descripciones where id = v_desc_id;
  raise notice 'OK rpc campos por posición (0028)';
end $$;
