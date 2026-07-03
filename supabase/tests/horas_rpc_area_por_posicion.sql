-- Área al registrar por POSICIÓN (0028): el área de cada línea de proyecto cliente debe
-- pertenecer a las áreas de la POSICIÓN del dueño (no a user_areas). Para todos los roles.
-- DESTRUCTIVO sobre time_logs. Correr en DB de prueba o sin registros que conservar.
do $$
declare
  v_op uuid; v_pos uuid; v_area_ok uuid; v_area_bad uuid; v_etapa uuid; v_log uuid; ok bool;
begin
  select p.id, p.position_id into v_op, v_pos from public.profiles p
  where p.role='operativo' and p.status='activo'
    and exists (select 1 from public.position_areas pa where pa.position_id = p.position_id)
    and exists (select 1 from public.position_etapas pe where pe.position_id = p.position_id)
  limit 1;
  if v_op is null then raise notice 'SKIP: no hay operativo con posición con áreas'; return; end if;
  select pa.area_id into v_area_ok from public.position_areas pa where pa.position_id = v_pos limit 1;
  select a.id into v_area_bad from public.areas a
    where not a.is_internal and a.active
      and not exists (select 1 from public.position_areas pa where pa.position_id = v_pos and pa.area_id = a.id)
    limit 1;
  select pe.etapa_id into v_etapa from public.position_etapas pe where pe.position_id = v_pos limit 1;
  if v_area_ok is null or v_etapa is null then raise exception 'precond: falta área/etapa de la posición'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_op::text, 'role','authenticated')::text, true);
  delete from public.time_logs where user_id = v_op and entry_date = current_date;

  -- área de su posición → OK
  v_log := public.guardar_registro(null, jsonb_build_array(
    jsonb_build_object('entry_date',current_date,'project','Cliente Z','area_id',v_area_ok,'department','Clientes','etapa_id',v_etapa,'hours',1,'description','trabajo libre')));
  if v_log is null then raise exception 'área de la posición debería aceptarse'; end if;
  delete from public.time_logs where id = v_log;

  -- área fuera de su posición → rechazada (si existe una)
  if v_area_bad is not null then
    ok := true;
    begin perform public.guardar_registro(null, jsonb_build_array(
      jsonb_build_object('entry_date',current_date,'project','Cliente Z','area_id',v_area_bad,'department','Clientes','etapa_id',v_etapa,'hours',1,'description','trabajo libre')
    )); ok := false; exception when others then null; end;
    if not ok then raise exception 'área fuera de la posición no fue rechazada'; end if;
  end if;

  raise notice 'OK área por posición';
end $$;
