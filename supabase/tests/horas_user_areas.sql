-- Inserta un área a un usuario admin existente y valida unicidad
do $$
declare v_admin uuid; v_area uuid; n int;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  select id into v_area  from public.areas where name = 'CRM';
  if v_admin is null then raise exception 'no hay admin para el test'; end if;
  insert into public.user_areas(user_id, area_id) values (v_admin, v_area)
    on conflict do nothing;
  select count(*) into n from public.user_areas where user_id = v_admin and area_id = v_area;
  if n <> 1 then raise exception 'esperaba 1 fila user_areas (n=%)', n; end if;
  -- limpieza
  delete from public.user_areas where user_id = v_admin and area_id = v_area;
  raise notice 'OK user_areas';
end $$;
