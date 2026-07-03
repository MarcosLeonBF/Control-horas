-- Alcance por posición en guardar_registro (0024), para TODOS los roles incluido el admin.
-- Verifica que Descripción, Departamento, Área y Etapa fuera del alcance del dueño se
-- rechacen, y que un caso válido se acepte.
--
-- NOTA: correr DESPUÉS de aplicar la migración 0024 en local/tras la demo (no está aplicada
-- a producción a propósito). Usa asignaciones reales; si falta alguna, hace SKIP o precondición.
do $$
declare
  v_op          uuid;
  v_admin       uuid := '1de8f167-ca74-49eb-a2b7-3273b63e8c2b';
  v_intern      uuid;
  v_op_area     uuid;    -- un área asignada al operativo
  v_etapa_ok    uuid;    -- una etapa en la posición del operativo
  v_etapa_bad   uuid;    -- una etapa FUERA de la posición del operativo (si existe)
  v_desc_op     text;    -- descripción válida para la posición del operativo
  v_desc_admin  text;    -- descripción válida para la posición del admin
  v_dep_ok      text;    -- departamento en la posición del admin
  v_dep_bad     text;    -- departamento FUERA de la posición del admin (si existe)
  v_log         uuid;
  ok            bool;
begin
  -- Operativo bien configurado: con al menos un área, y cuya posición tenga etapas y
  -- descripciones (si no, el test no puede armar líneas válidas).
  select p.id into v_op
  from public.profiles p
  where p.role = 'operativo' and p.status = 'activo'
    and exists (select 1 from public.user_areas ua where ua.user_id = p.id)
    and exists (select 1 from public.position_etapas pe where pe.position_id = p.position_id)
    and exists (select 1 from public.position_descripciones pd where pd.position_id = p.position_id)
  limit 1;
  if v_op is null then raise notice 'SKIP: no hay operativo configurado (área/etapa/descripción)'; return; end if;
  select id into v_intern from public.areas where is_internal = true;

  select ua.area_id into v_op_area from public.user_areas ua where ua.user_id = v_op limit 1;

  select pe.etapa_id into v_etapa_ok
    from public.position_etapas pe join public.profiles pr on pr.position_id = pe.position_id
    where pr.id = v_op limit 1;
  select e.id into v_etapa_bad from public.etapas e
    where e.active and not exists (
      select 1 from public.position_etapas pe join public.profiles pr on pr.position_id = pe.position_id
      where pr.id = v_op and pe.etapa_id = e.id) limit 1;

  select d.name into v_desc_op
    from public.position_descripciones pd
    join public.descripciones d on d.id = pd.descripcion_id
    join public.profiles pr on pr.position_id = pd.position_id
    where pr.id = v_op limit 1;
  select d.name into v_desc_admin
    from public.position_descripciones pd
    join public.descripciones d on d.id = pd.descripcion_id
    join public.profiles pr on pr.position_id = pd.position_id
    where pr.id = v_admin limit 1;

  select dep.name into v_dep_ok
    from public.position_departamentos pd
    join public.departamentos dep on dep.id = pd.departamento_id
    join public.profiles pr on pr.position_id = pd.position_id
    where pr.id = v_admin limit 1;
  select dep.name into v_dep_bad from public.departamentos dep
    where dep.active and not exists (
      select 1 from public.position_departamentos pd
      join public.profiles pr on pr.position_id = pd.position_id
      where pr.id = v_admin and pd.departamento_id = dep.id) limit 1;

  if v_intern is null or v_op_area is null or v_etapa_ok is null
     or v_desc_op is null or v_desc_admin is null or v_dep_ok is null then
    raise exception 'precondición: faltan asignaciones (interna/área operativo/etapa/descrip/depto admin)';
  end if;

  delete from public.time_logs where user_id in (v_op, v_admin) and entry_date = current_date;

  -- ===== ADMIN =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);

  -- Descripción fuera de su posición → rechazada
  ok := true;
  begin perform public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date',current_date,'project','Departamento','area_id',v_intern,'department',v_dep_ok,'etapa_id',v_etapa_ok,'hours',1,'description','__descripcion_inexistente__')
  )); ok := false; exception when others then null; end;
  if not ok then raise exception 'admin: descripción fuera de su posición no fue rechazada'; end if;

  -- Departamento fuera de su posición → rechazado (si hay uno fuera)
  if v_dep_bad is not null then
    ok := true;
    begin perform public.guardar_registro(null, jsonb_build_array(
      jsonb_build_object('entry_date',current_date,'project','Departamento','area_id',v_intern,'department',v_dep_bad,'etapa_id',v_etapa_ok,'hours',1,'description',v_desc_admin)
    )); ok := false; exception when others then null; end;
    if not ok then raise exception 'admin: departamento fuera de su posición no fue rechazado'; end if;
  end if;

  -- Área en proyecto cliente → rechazada si el admin no tiene áreas asignadas
  if not exists (select 1 from public.user_areas where user_id = v_admin) then
    ok := true;
    begin perform public.guardar_registro(null, jsonb_build_array(
      jsonb_build_object('entry_date',current_date,'project','Cliente Z','area_id',v_op_area,'department','Clientes','etapa_id',v_etapa_ok,'hours',1,'description',v_desc_admin)
    )); ok := false; exception when others then null; end;
    if not ok then raise exception 'admin: área no asignada (proyecto cliente) no fue rechazada'; end if;
  end if;

  -- Caso válido (Departamento con depto y descripción de su posición) → aceptado
  v_log := public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date',current_date,'project','Departamento','area_id',v_intern,'department',v_dep_ok,'etapa_id',v_etapa_ok,'hours',1,'description',v_desc_admin)
  ));
  if v_log is null then raise exception 'admin: caso válido debería aceptarse'; end if;
  delete from public.time_logs where id = v_log;

  -- ===== OPERATIVO: etapa fuera de su posición (proyecto cliente) → rechazada =====
  if v_etapa_bad is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_op::text, 'role','authenticated')::text, true);
    ok := true;
    begin perform public.guardar_registro(null, jsonb_build_array(
      jsonb_build_object('entry_date',current_date,'project','Cliente Z','area_id',v_op_area,'department','Clientes','etapa_id',v_etapa_bad,'hours',1,'description',v_desc_op)
    )); ok := false; exception when others then null; end;
    if not ok then raise exception 'operativo: etapa fuera de su posición no fue rechazada'; end if;
  end if;

  raise notice 'OK rpc campos por posición';
end $$;
