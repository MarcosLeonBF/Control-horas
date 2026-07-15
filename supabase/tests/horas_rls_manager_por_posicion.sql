-- 0036: el manager ve a su equipo por la POSICIÓN de los miembros.
-- Impersona a un manager (request.jwt.claims), le asigna temporalmente un área de
-- visibilidad y comprueba manager_sees_user en ambos sentidos. Limpieza inline.
do $$
declare
  v_manager uuid; v_operativo uuid; v_area uuid; v_fuera uuid; v_insertada boolean := false;
begin
  select id into v_manager from public.profiles where role = 'manager' limit 1;
  select p.id, pa.area_id into v_operativo, v_area
    from public.profiles p
    join public.position_areas pa on pa.position_id = p.position_id
    where p.role = 'operativo'
    limit 1;
  if v_manager is null or v_operativo is null then raise exception 'faltan manager/operativo con posición para el test'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_manager)::text, true);

  if not exists (select 1 from public.user_areas where user_id = v_manager and area_id = v_area) then
    insert into public.user_areas(user_id, area_id) values (v_manager, v_area);
    v_insertada := true;
  end if;

  if not public.manager_sees_user(v_operativo) then
    raise exception 'FALLO: manager con el área de la posición del operativo no lo ve';
  end if;

  -- Operativo cuya posición no comparte ningún área con el manager (si existe).
  select p.id into v_fuera
    from public.profiles p
    where p.role = 'operativo' and p.position_id is not null
      and not exists (
        select 1 from public.position_areas pa
        where pa.position_id = p.position_id
          and pa.area_id in (select area_id from public.user_areas where user_id = v_manager)
      )
    limit 1;
  if v_fuera is not null and public.manager_sees_user(v_fuera) then
    raise exception 'FALLO: manager ve a un operativo fuera de sus áreas';
  end if;

  if v_insertada then
    delete from public.user_areas where user_id = v_manager and area_id = v_area;
  end if;
  raise notice 'OK manager_sees_user por posición';
end $$;
