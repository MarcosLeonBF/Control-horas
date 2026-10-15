-- 0062: ampliaciones por posición. ampliar_horas solo la ejecuta el servidor (service_role)
-- y revalida actor, posición, horas, motivo y fecha; anular: el admin, cualquiera; el
-- manager, solo las suyas. Impersona con request.jwt.claims. Limpia lo que crea.
do $$
declare
  v_admin uuid; v_manager uuid; v_operativo uuid; v_pos text;
  v_de_admin uuid; v_del_manager uuid;
  c_firma constant text := 'public.ampliar_horas(uuid, text, text, numeric, text, date)';
  c_proyecto constant text := 'ZZ test 0062';
begin
  select id into v_admin from public.profiles where role = 'admin' and status = 'activo' limit 1;
  select id into v_manager from public.profiles where role = 'manager' and status = 'activo' limit 1;
  select id into v_operativo from public.profiles where role = 'operativo' and status = 'activo' limit 1;
  select name into v_pos from public.positions where active limit 1;
  if v_admin is null or v_manager is null or v_operativo is null or v_pos is null then
    raise exception 'faltan admin/manager/operativo/posición para el test';
  end if;

  -- Quién puede ejecutar qué.
  if has_function_privilege('authenticated', c_firma, 'execute') then raise exception 'FALLO: authenticated ejecuta ampliar_horas'; end if;
  if has_function_privilege('anon', c_firma, 'execute') then raise exception 'FALLO: anon ejecuta ampliar_horas'; end if;
  if not has_function_privilege('service_role', c_firma, 'execute') then raise exception 'FALLO: service_role no ejecuta ampliar_horas'; end if;
  if not has_function_privilege('authenticated', 'public.anular_ampliacion_horas(uuid)', 'execute') then raise exception 'FALLO: authenticated no ejecuta anular'; end if;
  if has_function_privilege('anon', 'public.anular_ampliacion_horas(uuid)', 'execute') then raise exception 'FALLO: anon ejecuta anular'; end if;

  -- ampliar_horas revalida lo que la base sabe.
  begin
    perform public.ampliar_horas(v_operativo, c_proyecto, v_pos, 1, 'x', current_date);
    raise exception 'FALLO: un operativo amplió';
  exception when others then if sqlerrm not like 'no autorizado: solo admin o manager%' then raise; end if;
  end;
  begin
    perform public.ampliar_horas(v_manager, c_proyecto, 'Posición que no existe 0062', 1, 'x', current_date);
    raise exception 'FALLO: aceptó una posición inexistente';
  exception when others then if sqlerrm not like 'posición inválida%' then raise; end if;
  end;
  begin
    perform public.ampliar_horas(v_manager, c_proyecto, v_pos, 1, 'x', current_date + 1);
    raise exception 'FALLO: aceptó una fecha futura';
  exception when others then if sqlerrm not like 'fecha inválida%' then raise; end if;
  end;

  v_de_admin := public.ampliar_horas(v_admin, c_proyecto, v_pos, 2, 'test 0062 admin', current_date);
  v_del_manager := public.ampliar_horas(v_manager, c_proyecto, ' ' || v_pos || ' ', 3, 'test 0062 manager', current_date);
  if (select position from public.horas_ampliaciones where id = v_del_manager) <> v_pos then
    raise exception 'FALLO: la posición no quedó guardada (recortada)';
  end if;
  if (select created_by from public.horas_ampliaciones where id = v_del_manager) <> v_manager then
    raise exception 'FALLO: created_by no es quien amplió';
  end if;

  -- El manager no anula la del admin, pero sí las suyas.
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager)::text, true);
  begin
    perform public.anular_ampliacion_horas(v_de_admin);
    raise exception 'FALLO: el manager anuló una ampliación ajena';
  exception when others then if sqlerrm not like 'no autorizado%' then raise; end if;
  end;
  perform public.anular_ampliacion_horas(v_del_manager);
  if (select active from public.horas_ampliaciones where id = v_del_manager) then
    raise exception 'FALLO: el manager no pudo anular la suya';
  end if;

  -- El admin anula cualquiera.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  perform public.anular_ampliacion_horas(v_de_admin);
  if (select active from public.horas_ampliaciones where id = v_de_admin) then
    raise exception 'FALLO: el admin no pudo anular';
  end if;

  delete from public.horas_ampliaciones where project = c_proyecto;
  raise notice 'OK ampliaciones por posición (0062)';
end $$;
