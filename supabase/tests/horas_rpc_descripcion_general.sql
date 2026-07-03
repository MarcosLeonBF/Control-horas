-- Descripción general del proyecto "Departamento" (0027). La descripción debe estar en la
-- lista general de descripciones ACTIVAS (compartida por todos los departamentos); no
-- depende del departamento. En proyecto cliente sigue siendo texto libre.
-- DESTRUCTIVO sobre time_logs (crea/borra registros de prueba). Correr en DB de prueba.
do $$
declare
  v_admin      uuid := '1de8f167-ca74-49eb-a2b7-3273b63e8c2b';
  v_intern     uuid;
  v_dep_name   text;
  v_etapa      uuid;
  v_desc_name  text := '__desc_general_test__';
  v_desc_id    uuid;
  v_log        uuid;
  ok           bool;
begin
  select id into v_intern from public.areas where is_internal = true;
  select dep.name into v_dep_name
    from public.position_departamentos pd join public.departamentos dep on dep.id = pd.departamento_id
    where pd.position_id = (select position_id from public.profiles where id = v_admin) limit 1;
  select pe.etapa_id into v_etapa from public.position_etapas pe
    where pe.position_id = (select position_id from public.profiles where id = v_admin) limit 1;
  if v_intern is null or v_dep_name is null then raise exception 'precondición: falta interna o departamento del admin'; end if;

  -- Sembrar una descripción general ACTIVA (sin ligarla a ningún departamento).
  insert into public.descripciones(name, active) values (v_desc_name, true) on conflict (name) do update set active = true;
  select id into v_desc_id from public.descripciones where name = v_desc_name;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);
  delete from public.time_logs where user_id = v_admin and entry_date = current_date;

  -- Departamento con una descripción de la lista general → OK (para cualquier departamento)
  v_log := public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date',current_date,'project','Departamento','area_id',v_intern,'department',v_dep_name,'etapa_id',v_etapa,'hours',1,'description',v_desc_name)));
  if v_log is null then raise exception 'Departamento con descripción general debería aceptarse'; end if;
  delete from public.time_logs where id = v_log;

  -- Departamento con descripción inexistente → rechazada
  ok := true;
  begin perform public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date',current_date,'project','Departamento','area_id',v_intern,'department',v_dep_name,'etapa_id',v_etapa,'hours',1,'description','__no_existe_general__')
  )); ok := false; exception when others then null; end;
  if not ok then raise exception 'Departamento con descripción inexistente no fue rechazada'; end if;

  delete from public.descripciones where id = v_desc_id;
  raise notice 'OK descripción general (Departamento)';
end $$;
